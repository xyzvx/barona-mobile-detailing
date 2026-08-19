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

const SERVICE_META = {
  exterior: { label: 'Exterior Detail — $150', minutes: 180 },
  interior: { label: 'Interior Detail — $150', minutes: 180 },
  full: { label: 'Full Detail — $300', minutes: 360 },
  // "Not sure" defaults to the longest job (6 hrs) — safer to hold too much
  // time than to double-book a slot that turns out to need more of it.
  unsure: { label: 'Not sure — recommend something', minutes: 360 },
};

// Same free Web3Forms key already used for the site — kept server-side now,
// so it's no longer visible in the page source like it was before.
const WEB3FORMS_ACCESS_KEY = '96792ed9-7011-46d2-b993-9a942cf62d43';

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/availability' && request.method === 'GET') {
      return handleAvailability(env, url);
    }
    if (url.pathname === '/api/book' && request.method === 'POST') {
      return handleBook(request, env);
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
        return !existing.some((b) => overlaps(start, end, b.start, b.end));
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

  // Notify the owner by email (server-side, reuses the free Web3Forms key —
  // this never touches the browser, so the key isn't exposed in page source).
  try {
    await fetch('https://api.web3forms.com/submit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        access_key: WEB3FORMS_ACCESS_KEY,
        subject: `New confirmed booking — ${date} ${label}`,
        name,
        phone,
        vehicle,
        service: service.label,
        location,
        message,
        date,
        time: label,
      }),
    });
  } catch {
    // The booking is already saved even if the notification email fails.
  }

  return json({ success: true, date, time_slot, end_time, label, service: service.label });
}
