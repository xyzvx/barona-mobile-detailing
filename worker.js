// Barona Mobile Detailing — Cloudflare Worker
// Serves the static site (index.html, css, js, images — via the ASSETS
// binding) and a small JSON booking API backed by D1, so the site can show
// a live calendar of real availability instead of a plain request form.
//
// Routes:
//   GET  /api/availability?year=YYYY&month=M&service=KEY  -> open days/times
//   POST /api/book                                        -> lock in an appointment
//   *    everything else                                  -> served from static assets
//
// Business hours: Mon–Sat, 9am–5pm. Appointment length depends on the
// service (interior/exterior detail = 3 hrs, full detail = 6 hrs) — change
// SERVICE_META below if pricing/timing changes. Start times are offered on
// the hour (STEP_MIN); the last possible start is whatever leaves enough
// time to finish by CLOSE_MIN.

const OPEN_MIN = 9 * 60;    // 9:00 AM
const CLOSE_MIN = 17 * 60;  // 5:00 PM
const STEP_MIN = 60;        // offer start times on the hour
const CLOSED_WEEKDAY = 0;   // Sunday (0 = Sunday in JS Date)
const TRAVEL_BUFFER_MIN = 60; // required gap between any two bookings, for driving between jobs

// Admin dashboard (/admin.html + /api/admin/*) is gated at the Cloudflare
// edge by Cloudflare Access, which only lets these two people log in at
// all. This list is a second, defense-in-depth check inside the Worker
// itself: Access injects the authenticated user's email into every request
// it lets through, and we double-check it's actually one of these two
// before touching any admin data. Replace with your real emails before
// deploying, and make sure they match exactly what you set up in the
// Cloudflare Access policy.
const ADMIN_EMAILS = [
  'edgarbaronaofficial@gmail.com',
  'newnewdu@proton.me',
];

const SERVICE_META = {
  exterior: { label: 'Exterior Detail — $200', minutes: 180 },
  interior: { label: 'Interior Detail — $200', minutes: 180 },
  full: { label: 'Full Detail — $400', minutes: 360 },
  // "Not sure" defaults to the longest job (6 hrs) — safer to hold too much
  // time than to double-book a slot that turns out to need more of it.
  unsure: { label: 'Not sure — recommend something', minutes: 360 },
};

// Free Web3Forms access keys — one per inbox that should get a booking
// notification. Kept server-side (not in page source, unlike before). Each
// key comes from verifying an email at web3forms.com; add/remove entries
// here to change who gets notified — no other code changes needed.
const WEB3FORMS_ACCESS_KEYS = [
  '96792ed9-7011-46d2-b993-9a942cf62d43',
  'ed1da520-2d26-4ef9-8693-0090eb09035f',
];

// Unified social inbox (Facebook + Instagram DMs/comments -> admin
// dashboard, with Claude drafting suggested replies). Unlike the constants
// above, these are genuine secrets and must NOT be hardcoded here — set
// them as Worker secrets instead (Cloudflare dashboard -> Workers & Pages ->
// your worker -> Settings -> Variables and Secrets -> "Add" with type
// "Secret", or `wrangler secret put NAME`). This file only ever reads them
// off `env`:
//   ANTHROPIC_API_KEY        - from console.anthropic.com, pays for reply drafting
//   META_APP_SECRET          - from your Meta Developer app's Basic Settings,
//                               used to verify incoming webhook requests are
//                               really from Meta (HMAC signature check)
//   META_PAGE_ACCESS_TOKEN   - Page access token, lets the Worker send Messenger replies
//   META_IG_ACCESS_TOKEN     - Instagram-connected token, lets it send IG DM replies
//   META_WEBHOOK_VERIFY_TOKEN - any string you make up yourself; Meta echoes it
//                               back during webhook setup so you both confirm
//                               you're pointing at the right endpoint
const ANTHROPIC_MODEL = 'claude-sonnet-4-5';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/availability' && request.method === 'GET') {
      return handleAvailability(env, url);
    }
    if (url.pathname === '/api/book' && request.method === 'POST') {
      return handleBook(request, env);
    }

    if (url.pathname === '/api/webhooks/meta' && request.method === 'GET') {
      return handleMetaWebhookVerify(url, env);
    }
    if (url.pathname === '/api/webhooks/meta' && request.method === 'POST') {
      return handleMetaWebhookEvent(request, env);
    }

    if (url.pathname.startsWith('/api/admin/')) {
      // Cloudflare Access should already be blocking anyone but the two of
      // you from reaching this far — this is the second check behind it.
      const adminEmail = request.headers.get('Cf-Access-Authenticated-User-Email');
      if (!adminEmail || !ADMIN_EMAILS.includes(adminEmail.toLowerCase())) {
        return json({ error: 'forbidden' }, 403);
      }
      return handleAdmin(request, env, url, adminEmail);
    }

    if (url.pathname.startsWith('/api/')) {
      return json({ error: 'not_found' }, 404);
    }

    return env.ASSETS.fetch(request);
  },
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function isValidDateStr(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d.getTime());
}

function hhmmToMinutes(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
}

function minutesToHHMM(total) {
  const hh = Math.floor(total / 60);
  const mm = total % 60;
  return `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function fmt12(hhmm) {
  let [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function overlaps(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

// All possible on-the-hour start times (as "HH:MM") that leave enough room
// to finish a job of `durationMinutes` before closing.
function candidateStarts(durationMinutes) {
  const starts = [];
  for (let t = OPEN_MIN; t + durationMinutes <= CLOSE_MIN; t += STEP_MIN) {
    starts.push(minutesToHHMM(t));
  }
  return starts;
}

async function handleAvailability(env, url) {
  const now = new Date();
  const year = parseInt(url.searchParams.get('year') || String(now.getUTCFullYear()), 10);
  const month = parseInt(url.searchParams.get('month') || String(now.getUTCMonth() + 1), 10); // 1-12
  const serviceKey = url.searchParams.get('service') || '';
  const service = SERVICE_META[serviceKey];

  if (!year || !month || month < 1 || month > 12) {
    return json({ error: 'invalid_month' }, 400);
  }
  if (!service) {
    return json({ error: 'invalid_service' }, 400);
  }
  const duration = service.minutes;

  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const mm = String(month).padStart(2, '0');
  const from = `${year}-${mm}-01`;
  const to = `${year}-${mm}-${String(daysInMonth).padStart(2, '0')}`;

  const [bookingsRes, closedRes] = await Promise.all([
    env.DB.prepare(
      `SELECT date, time_slot, end_time FROM bookings WHERE status = 'confirmed' AND date BETWEEN ?1 AND ?2`
    ).bind(from, to).all(),
    env.DB.prepare(
      `SELECT date, reason FROM closed_days WHERE date BETWEEN ?1 AND ?2`
    ).bind(from, to).all(),
  ]);

  const bookedBy = {};
  for (const row of bookingsRes.results) {
    (bookedBy[row.date] ||= []).push({ start: row.time_slot, end: row.end_time });
  }
  const closedBy = {};
  for (const row of closedRes.results) {
    closedBy[row.date] = row.reason || 'Closed';
  }

  const today = todayStr();
  const allStarts = candidateStarts(duration);
  const days = {};
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${mm}-${String(d).padStart(2, '0')}`;
    const weekday = new Date(Date.UTC(year, month - 1, d)).getUTCDay();
    const isPast = date < today;
    const closedReason = closedBy[date] || (weekday === CLOSED_WEEKDAY ? 'Closed Sundays' : null);

    if (isPast || closedReason) {
      days[date] = { open: false, past: isPast, reason: isPast ? undefined : closedReason };
      continue;
    }

    const existing = bookedBy[date] || [];
    const openSlots = allStarts
      .filter((start) => {
        const end = minutesToHHMM(hhmmToMinutes(start) + duration);
        // Buffer each existing booking by TRAVEL_BUFFER_MIN on both sides —
        // leaves enough driving time whether the new job would come right
        // before or right after an existing one.
        return !existing.some((b) => {
          const bStart = minutesToHHMM(hhmmToMinutes(b.start) - TRAVEL_BUFFER_MIN);
          const bEnd = minutesToHHMM(hhmmToMinutes(b.end) + TRAVEL_BUFFER_MIN);
          return overlaps(start, end, bStart, bEnd);
        });
      })
      .map((start) => {
        const end = minutesToHHMM(hhmmToMinutes(start) + duration);
        return { start, end, label: `${fmt12(start)} – ${fmt12(end)}` };
      });

    days[date] = { open: openSlots.length > 0, slots: openSlots };
  }

  return json({ year, month, service: serviceKey, durationMinutes: duration, days });
}

async function handleBook(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const date = String(body.date || '').trim();
  const time_slot = String(body.time_slot || '').trim();
  const serviceKey = String(body.service || '').trim();
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const vehicle = String(body.vehicle || '').trim();
  const location = String(body.location || '').trim();
  const message = String(body.message || '').trim();

  const service = SERVICE_META[serviceKey];

  if (!name || !phone || !date || !time_slot || !service) {
    return json({ error: 'missing_fields' }, 400);
  }
  if (!isValidDateStr(date)) {
    return json({ error: 'invalid_date' }, 400);
  }
  if (date < todayStr()) {
    return json({ error: 'date_in_past' }, 400);
  }
  const weekday = new Date(date + 'T00:00:00Z').getUTCDay();
  if (weekday === CLOSED_WEEKDAY) {
    return json({ error: 'closed' }, 400);
  }
  const closedCheck = await env.DB.prepare(`SELECT 1 FROM closed_days WHERE date = ?1`).bind(date).first();
  if (closedCheck) {
    return json({ error: 'closed' }, 400);
  }

  const duration = service.minutes;
  // Re-derive valid start times server-side rather than trusting the
  // client — makes sure the submitted time is actually hour-aligned and
  // leaves enough room in the day for this service's length.
  if (!candidateStarts(duration).includes(time_slot)) {
    return json({ error: 'invalid_slot' }, 400);
  }
  const end_time = minutesToHHMM(hhmmToMinutes(time_slot) + duration);

  try {
    await env.DB.prepare(
      `INSERT INTO bookings (date, time_slot, end_time, duration_minutes, service, name, phone, vehicle, location, message)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    ).bind(date, time_slot, end_time, duration, serviceKey, name, phone, vehicle, location, message).run();
  } catch (err) {
    // The database trigger blocked this — its time range overlaps a booking
    // someone else just confirmed a moment earlier.
    return json({ error: 'slot_taken' }, 409);
  }

  const label = `${fmt12(time_slot)} – ${fmt12(end_time)}`;

  // Notify the owner(s) by email — fires one request per access key above,
  // in parallel. Server-side, so none of these keys are exposed in page
  // source. A failed/slow email never blocks or fails the booking itself.
  const notifyPayload = {
    subject: `New confirmed booking — ${date} ${label}`,
    name,
    phone,
    vehicle,
    service: service.label,
    location,
    message,
    date,
    time: label,
  };
  await Promise.allSettled(
    WEB3FORMS_ACCESS_KEYS.map((access_key) =>
      fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ access_key, ...notifyPayload }),
      })
    )
  );

  return json({ success: true, date, time_slot, end_time, label, service: service.label });
}

// ---------------------------------------------------------------------
// Admin dashboard API — everything under /api/admin/*. Cloudflare Access
// gates this at the edge (only the two allowed emails can even reach the
// Worker), and the ADMIN_EMAILS check in the router above double-checks
// that. These handlers intentionally skip some of the customer-facing
// guardrails (hour-grid time slots, closed-day/Sunday blocks) — this is a
// trusted internal tool for the two of you to override the calendar when
// needed (a phone-in booking at an odd time, a one-off exception on a
// closed day, etc). The overlap + travel-buffer protection still applies
// either way, since it lives in the database trigger itself.
async function handleAdmin(request, env, url) {
  const sub = url.pathname.split('/').filter(Boolean).slice(2); // drop 'api','admin'

  if (sub[0] === 'bookings' && sub.length === 1 && request.method === 'GET') {
    return adminListBookings(env, url);
  }
  if (sub[0] === 'bookings' && sub.length === 1 && request.method === 'POST') {
    return adminCreateBooking(request, env);
  }
  if (sub[0] === 'bookings' && sub.length === 3 && sub[2] === 'cancel' && request.method === 'POST') {
    return adminCancelBooking(env, sub[1]);
  }
  if (sub[0] === 'bookings' && sub.length === 3 && sub[2] === 'edit' && request.method === 'POST') {
    return adminEditBooking(request, env, sub[1]);
  }
  if (sub[0] === 'closed-days' && sub.length === 1 && request.method === 'GET') {
    return adminListClosedDays(env);
  }
  if (sub[0] === 'closed-days' && sub.length === 1 && request.method === 'POST') {
    return adminAddClosedDay(request, env);
  }
  if (sub[0] === 'closed-days' && sub.length === 2 && request.method === 'DELETE') {
    return adminDeleteClosedDay(env, decodeURIComponent(sub[1]));
  }
  if (sub[0] === 'conversations' && sub.length === 1 && request.method === 'GET') {
    return adminListConversations(env);
  }
  if (sub[0] === 'conversations' && sub.length === 3 && sub[2] === 'messages' && request.method === 'GET') {
    return adminGetMessages(env, sub[1]);
  }
  if (sub[0] === 'conversations' && sub.length === 3 && sub[2] === 'reply' && request.method === 'POST') {
    return adminReplyToConversation(request, env, sub[1]);
  }
  if (sub[0] === 'messages' && sub.length === 3 && sub[2] === 'discard' && request.method === 'POST') {
    return adminDiscardDraft(env, sub[1]);
  }
  if (sub[0] === 'settings' && sub.length === 1 && request.method === 'GET') {
    return adminGetSettings(env);
  }
  if (sub[0] === 'settings' && sub.length === 1 && request.method === 'POST') {
    return adminSetSettings(request, env);
  }

  return json({ error: 'not_found' }, 404);
}

async function adminListBookings(env, url) {
  // Defaults to everything from today onward; ?from=YYYY-MM-DD&to=YYYY-MM-DD
  // widens the range (useful for looking back at past jobs).
  const from = url.searchParams.get('from') || '2000-01-01';
  const to = url.searchParams.get('to') || '2999-12-31';
  const res = await env.DB.prepare(
    `SELECT id, date, time_slot, end_time, duration_minutes, service, name, phone, vehicle, location, message, status, created_at
     FROM bookings
     WHERE date BETWEEN ?1 AND ?2
     ORDER BY date ASC, time_slot ASC`
  ).bind(from, to).all();
  return json({ bookings: res.results });
}

async function adminCancelBooking(env, idStr) {
  const id = parseInt(idStr, 10);
  if (!id) return json({ error: 'invalid_id' }, 400);
  await env.DB.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?1`).bind(id).run();
  return json({ success: true });
}

async function adminCreateBooking(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const date = String(body.date || '').trim();
  const time_slot = String(body.time_slot || '').trim();
  const serviceKey = String(body.service || '').trim();
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const vehicle = String(body.vehicle || '').trim();
  const location = String(body.location || '').trim();
  const message = String(body.message || '').trim();

  const service = SERVICE_META[serviceKey];
  if (!name || !phone || !date || !time_slot || !service) {
    return json({ error: 'missing_fields' }, 400);
  }
  if (!isValidDateStr(date)) return json({ error: 'invalid_date' }, 400);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time_slot)) return json({ error: 'invalid_slot' }, 400);

  const duration = service.minutes;
  const end_time = minutesToHHMM(hhmmToMinutes(time_slot) + duration);

  try {
    const result = await env.DB.prepare(
      `INSERT INTO bookings (date, time_slot, end_time, duration_minutes, service, name, phone, vehicle, location, message)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
    ).bind(date, time_slot, end_time, duration, serviceKey, name, phone, vehicle, location, message).run();
    return json({ success: true, id: result.meta.last_row_id, end_time });
  } catch (err) {
    // Same trigger the customer-facing booking flow hits — this time range
    // (including the travel buffer) overlaps an existing confirmed booking.
    return json({ error: 'slot_taken' }, 409);
  }
}

// Editing is implemented as "cancel the old row, insert a new one" inside a
// single D1 batch (D1 batches are real SQL transactions — if either
// statement fails, both roll back) rather than an in-place UPDATE. That way
// an edit goes through the exact same overlap + travel-buffer trigger the
// create flow already uses, instead of needing a second BEFORE UPDATE
// trigger that duplicates the same rule. Cancelling first also means the
// trigger's overlap check naturally ignores this booking's own old time
// slot when the replacement row is inserted, so editing a booking without
// changing its time doesn't collide with itself.
async function adminEditBooking(request, env, idStr) {
  const id = parseInt(idStr, 10);
  if (!id) return json({ error: 'invalid_id' }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const date = String(body.date || '').trim();
  const time_slot = String(body.time_slot || '').trim();
  const serviceKey = String(body.service || '').trim();
  const name = String(body.name || '').trim();
  const phone = String(body.phone || '').trim();
  const vehicle = String(body.vehicle || '').trim();
  const location = String(body.location || '').trim();
  const message = String(body.message || '').trim();

  const service = SERVICE_META[serviceKey];
  if (!name || !phone || !date || !time_slot || !service) {
    return json({ error: 'missing_fields' }, 400);
  }
  if (!isValidDateStr(date)) return json({ error: 'invalid_date' }, 400);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time_slot)) return json({ error: 'invalid_slot' }, 400);

  const existing = await env.DB.prepare(`SELECT id, status FROM bookings WHERE id = ?1`).bind(id).first();
  if (!existing) return json({ error: 'not_found' }, 404);
  if (existing.status !== 'confirmed') return json({ error: 'not_editable' }, 400);

  const duration = service.minutes;
  const end_time = minutesToHHMM(hhmmToMinutes(time_slot) + duration);

  try {
    const results = await env.DB.batch([
      env.DB.prepare(`UPDATE bookings SET status = 'cancelled' WHERE id = ?1`).bind(id),
      env.DB.prepare(
        `INSERT INTO bookings (date, time_slot, end_time, duration_minutes, service, name, phone, vehicle, location, message)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)`
      ).bind(date, time_slot, end_time, duration, serviceKey, name, phone, vehicle, location, message),
    ]);
    const insertResult = results[1];
    return json({ success: true, id: insertResult.meta.last_row_id, end_time });
  } catch (err) {
    // Trigger blocked the insert (overlap/buffer) — the whole batch rolled
    // back, so the original booking is still confirmed and untouched.
    return json({ error: 'slot_taken' }, 409);
  }
}

async function adminListClosedDays(env) {
  const res = await env.DB.prepare(`SELECT date, reason FROM closed_days ORDER BY date ASC`).all();
  return json({ closedDays: res.results });
}

async function adminAddClosedDay(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const date = String(body.date || '').trim();
  const reason = String(body.reason || '').trim();
  if (!isValidDateStr(date)) return json({ error: 'invalid_date' }, 400);

  await env.DB.prepare(
    `INSERT INTO closed_days (date, reason) VALUES (?1, ?2)
     ON CONFLICT(date) DO UPDATE SET reason = excluded.reason`
  ).bind(date, reason || null).run();
  return json({ success: true });
}

async function adminDeleteClosedDay(env, date) {
  if (!isValidDateStr(date)) return json({ error: 'invalid_date' }, 400);
  await env.DB.prepare(`DELETE FROM closed_days WHERE date = ?1`).bind(date).run();
  return json({ success: true });
}

// ---------------------------------------------------------------------
// Unified social inbox — Facebook + Instagram comments/DMs flow in through
// the webhook below, Claude drafts a suggested reply, and it waits in the
// dashboard for a human to approve (or gets auto-sent, once the
// auto_send_replies setting is switched on).

async function handleMetaWebhookVerify(url, env) {
  const mode = url.searchParams.get('hub.mode');
  const token = url.searchParams.get('hub.verify_token');
  const challenge = url.searchParams.get('hub.challenge') || '';
  if (mode === 'subscribe' && env.META_WEBHOOK_VERIFY_TOKEN && token === env.META_WEBHOOK_VERIFY_TOKEN) {
    return new Response(challenge, { status: 200 });
  }
  return new Response('forbidden', { status: 403 });
}

// This endpoint has to be reachable by Meta's servers, so it sits outside
// Cloudflare Access (which only gates /admin.html and /api/admin/*) — the
// HMAC signature check here is what stands in for that, confirming a
// request actually came from Meta and not just anyone who found the URL.
async function verifyMetaSignature(request, env, rawBody) {
  const signature = request.headers.get('X-Hub-Signature-256') || '';
  if (!signature.startsWith('sha256=') || !env.META_APP_SECRET) return false;
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(env.META_APP_SECRET),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const mac = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(rawBody));
  const macHex = [...new Uint8Array(mac)].map((b) => b.toString(16).padStart(2, '0')).join('');
  const given = signature.slice('sha256='.length);
  if (macHex.length !== given.length) return false;
  let diff = 0;
  for (let i = 0; i < macHex.length; i++) diff |= macHex.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function handleMetaWebhookEvent(request, env) {
  const rawBody = await request.text();
  if (!(await verifyMetaSignature(request, env, rawBody))) {
    return json({ error: 'bad_signature' }, 403);
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }

  const platform = body.object === 'instagram' ? 'instagram' : 'facebook';

  for (const entry of body.entry || []) {
    for (const event of entry.messaging || []) {
      const text = event.message && event.message.text;
      const senderId = event.sender && event.sender.id;
      // Skip delivery/read receipts and echoes of messages we sent ourselves.
      if (!text || !senderId || (event.message && event.message.is_echo)) continue;

      const conversationId = await upsertConversation(env, platform, senderId, text);
      await env.DB.prepare(
        `INSERT INTO messages (conversation_id, direction, sender, body, status) VALUES (?1, 'inbound', 'customer', ?2, 'sent')`
      ).bind(conversationId, text).run();

      let draftText;
      try {
        draftText = await draftAiReply(env, conversationId);
      } catch (err) {
        // Drafting failed (missing/bad API key, rate limit, etc.) — the
        // inbound message is still saved either way; it just sits with no
        // suggested reply until you write one by hand.
        continue;
      }

      const autoSend = (await getSetting(env, 'auto_send_replies')) === 'true';
      if (autoSend) {
        try {
          const platformMessageId = await sendMetaMessage(platform, senderId, draftText, env);
          await env.DB.prepare(
            `INSERT INTO messages (conversation_id, direction, sender, body, status, platform_message_id)
             VALUES (?1, 'outbound', 'ai', ?2, 'sent', ?3)`
          ).bind(conversationId, draftText, platformMessageId).run();
          await touchConversation(env, conversationId, draftText, false);
          continue;
        } catch (err) {
          // Fall through — queue it for approval instead of losing the draft.
        }
      }

      await env.DB.prepare(
        `INSERT INTO messages (conversation_id, direction, sender, body, status) VALUES (?1, 'outbound', 'ai', ?2, 'pending_approval')`
      ).bind(conversationId, draftText).run();
      await touchConversation(env, conversationId, text, true);
    }
  }

  return json({ received: true });
}

async function upsertConversation(env, platform, threadId, latestText) {
  const existing = await env.DB.prepare(
    `SELECT id FROM conversations WHERE platform = ?1 AND platform_thread_id = ?2`
  ).bind(platform, threadId).first();
  if (existing) return existing.id;
  const result = await env.DB.prepare(
    `INSERT INTO conversations (platform, platform_thread_id, last_message_preview) VALUES (?1, ?2, ?3)`
  ).bind(platform, threadId, latestText.slice(0, 140)).run();
  return result.meta.last_row_id;
}

async function touchConversation(env, conversationId, previewText, unread) {
  await env.DB.prepare(
    `UPDATE conversations SET last_message_at = datetime('now'), last_message_preview = ?1, unread = ?2 WHERE id = ?3`
  ).bind(previewText.slice(0, 140), unread ? 1 : 0, conversationId).run();
}

async function getSetting(env, key) {
  const row = await env.DB.prepare(`SELECT value FROM settings WHERE key = ?1`).bind(key).first();
  return row ? row.value : null;
}

function buildBusinessSystemPrompt() {
  const services = Object.entries(SERVICE_META)
    .filter(([key]) => key !== 'unsure')
    .map(([, s]) => `- ${s.label}`)
    .join('\n');
  return `You are replying, as Barona Mobile Detailing, to a customer's comment or direct message on Facebook or Instagram. Keep replies short (1-3 sentences), warm, and specific to what they actually asked. Never invent details you don't know — exact same-day availability, a price not listed below, or a confirmed appointment time — instead point them to the online booking calendar on the website, or ask what day/service they want so a human can confirm.

Services and starting prices:
${services}

Business hours: Monday-Saturday, 9am-5pm. Closed Sundays.

Write like a real person texting back, not a formal email — no signature block, no "Dear customer."`;
}

async function draftAiReply(env, conversationId) {
  if (!env.ANTHROPIC_API_KEY) throw new Error('missing_anthropic_key');

  const history = await env.DB.prepare(
    `SELECT direction, body FROM messages WHERE conversation_id = ?1 ORDER BY created_at DESC LIMIT 10`
  ).bind(conversationId).all();
  const recent = history.results.slice().reverse();

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: ANTHROPIC_MODEL,
      max_tokens: 300,
      system: buildBusinessSystemPrompt(),
      messages: recent.map((m) => ({
        role: m.direction === 'inbound' ? 'user' : 'assistant',
        content: m.body,
      })),
    }),
  });
  if (!res.ok) throw new Error(`anthropic_error_${res.status}`);
  const data = await res.json();
  const text = (data.content || []).map((block) => block.text || '').join('').trim();
  return text || "Thanks for reaching out — we'll get back to you shortly!";
}

// Meta unified the Messenger and Instagram DM Send APIs under the same
// /me/messages Graph API endpoint for Page-linked accounts; which access
// token you pass is what determines which inbox it actually sends through.
async function sendMetaMessage(platform, recipientId, text, env) {
  const token = platform === 'instagram' ? env.META_IG_ACCESS_TOKEN : env.META_PAGE_ACCESS_TOKEN;
  if (!token) throw new Error('missing_access_token');
  const res = await fetch(`https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text } }),
  });
  if (!res.ok) throw new Error(`meta_send_failed_${res.status}`);
  const data = await res.json();
  return data.message_id || null;
}

async function adminListConversations(env) {
  const res = await env.DB.prepare(
    `SELECT id, platform, platform_thread_id, customer_name, last_message_at, last_message_preview, unread
     FROM conversations ORDER BY last_message_at DESC LIMIT 200`
  ).all();
  return json({ conversations: res.results });
}

async function adminGetMessages(env, idStr) {
  const id = parseInt(idStr, 10);
  if (!id) return json({ error: 'invalid_id' }, 400);
  await env.DB.prepare(`UPDATE conversations SET unread = 0 WHERE id = ?1`).bind(id).run();
  const res = await env.DB.prepare(
    `SELECT id, direction, sender, body, status, created_at FROM messages WHERE conversation_id = ?1 ORDER BY created_at ASC`
  ).bind(id).all();
  return json({ messages: res.results });
}

// Sends a reply right now — either a fresh message, or approving (as-is or
// edited) a pending AI draft by passing its id as draft_message_id.
async function adminReplyToConversation(request, env, idStr) {
  const id = parseInt(idStr, 10);
  if (!id) return json({ error: 'invalid_id' }, 400);

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const text = String(body.text || '').trim();
  const draftMessageId = body.draft_message_id ? parseInt(body.draft_message_id, 10) : null;
  if (!text) return json({ error: 'missing_text' }, 400);

  const convo = await env.DB.prepare(
    `SELECT id, platform, platform_thread_id FROM conversations WHERE id = ?1`
  ).bind(id).first();
  if (!convo) return json({ error: 'not_found' }, 404);

  let platformMessageId;
  try {
    platformMessageId = await sendMetaMessage(convo.platform, convo.platform_thread_id, text, env);
  } catch (err) {
    return json({ error: 'send_failed' }, 502);
  }

  if (draftMessageId) {
    await env.DB.prepare(
      `UPDATE messages SET body = ?1, status = 'sent', sender = 'admin', platform_message_id = ?2 WHERE id = ?3`
    ).bind(text, platformMessageId, draftMessageId).run();
  } else {
    await env.DB.prepare(
      `INSERT INTO messages (conversation_id, direction, sender, body, status, platform_message_id)
       VALUES (?1, 'outbound', 'admin', ?2, 'sent', ?3)`
    ).bind(id, text, platformMessageId).run();
  }
  await touchConversation(env, id, text, false);

  return json({ success: true });
}

async function adminDiscardDraft(env, idStr) {
  const id = parseInt(idStr, 10);
  if (!id) return json({ error: 'invalid_id' }, 400);
  await env.DB.prepare(
    `UPDATE messages SET status = 'discarded' WHERE id = ?1 AND status = 'pending_approval'`
  ).bind(id).run();
  return json({ success: true });
}

async function adminGetSettings(env) {
  const value = await getSetting(env, 'auto_send_replies');
  return json({ auto_send_replies: value === 'true' });
}

async function adminSetSettings(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_json' }, 400);
  }
  const value = body.auto_send_replies ? 'true' : 'false';
  await env.DB.prepare(
    `INSERT INTO settings (key, value) VALUES ('auto_send_replies', ?1) ON CONFLICT(key) DO UPDATE SET value = excluded.value`
  ).bind(value).run();
  return json({ success: true, auto_send_replies: value === 'true' });
}
