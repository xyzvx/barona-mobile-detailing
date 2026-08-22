// Barona Mobile Detailing — admin dashboard
// Talks to /api/admin/* on the same Worker used by the public site. This
// page itself is meant to be gated by Cloudflare Access at the edge —
// nothing here does its own login check, since that's not this script's
// job to enforce (see worker.js for the server-side allowlist check that
// backs this up).

const SERVICE_LABELS = {
  exterior: 'Exterior Detail',
  interior: 'Interior Detail',
  full: 'Full Detail',
  unsure: 'Not Sure',
};
const SERVICE_CLASS = {
  exterior: 'svc-exterior',
  interior: 'svc-interior',
  full: 'svc-full',
  unsure: 'svc-unsure',
};

function fmt12(hhmm) {
  if (!hhmm) return '';
  let [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  h = h % 12;
  if (h === 0) h = 12;
  return `${h}:${String(m).padStart(2, '0')} ${ampm}`;
}

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fmtDayHeader(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const label = d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' });
  if (dateStr === today) return `Today — ${label}`;
  if (dateStr === tomorrow) return `Tomorrow — ${label}`;
  return label;
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

// A single place that turns a failed request into a message someone can
// actually act on, instead of a generic "try refreshing" — this is the
// difference between a 403 (Cloudflare Access / email allowlist problem),
// a 5xx (something broke server-side), and a network failure.
function describeError(err) {
  if (err.status === 403) {
    return "Forbidden (403) — Cloudflare Access let you into this page, but the Worker doesn't recognize your login email as an admin. Double-check the email you signed in with matches exactly what's in ADMIN_EMAILS in worker.js (case and all).";
  }
  if (err.status === 404) {
    return "Not found (404) — the admin API routes aren't live yet. Make sure the latest worker.js (with the /api/admin/* routes) was actually uploaded and deployed.";
  }
  if (err.status >= 500) {
    return `Server error (${err.status}) — something broke in the Worker itself. Check the Cloudflare dashboard's Worker logs for the actual error.`;
  }
  if (err.status) {
    return `Request failed (${err.status}: ${err.message}).`;
  }
  return "Network error — couldn't reach the server at all. Check your connection, or that the domain/Worker is actually live.";
}

async function apiFetch(path, options) {
  let res;
  try {
    res = await fetch(path, {
      ...options,
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options && options.headers) },
    });
  } catch (networkErr) {
    const err = new Error('network_error');
    throw err;
  }
  let data = null;
  try { data = await res.json(); } catch { /* ignore — some errors aren't JSON */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `http_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// --- Calendar ----------------------------------------------------------------
// Reuses whatever's already been fetched for the bookings list (which has no
// upper date bound — it's "everything from today forward") rather than
// making a separate request, so browsing months ahead is instant.
const calGrid = document.getElementById('calGrid');
const calLabel = document.getElementById('calLabel');
const calPrevBtn = document.getElementById('calPrev');
const calNextBtn = document.getElementById('calNext');
const calTodayBtn = document.getElementById('calToday');

let latestBookings = [];
let closedDaySet = new Set();
let calCursor = new Date(todayStr() + 'T00:00:00Z');
calCursor.setUTCDate(1);

function toDateStr(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function renderCalendar() {
  const year = calCursor.getUTCFullYear();
  const month = calCursor.getUTCMonth();
  calLabel.textContent = calCursor.toLocaleDateString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const countsByDate = {};
  latestBookings.forEach((b) => {
    if (b.status !== 'confirmed') return;
    countsByDate[b.date] = (countsByDate[b.date] || 0) + 1;
  });

  const startWeekday = new Date(Date.UTC(year, month, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const today = todayStr();
  const totalCells = Math.ceil((startWeekday + daysInMonth) / 7) * 7;

  calGrid.innerHTML = '';
  for (let i = 0; i < totalCells; i++) {
    const dayNum = i - startWeekday + 1;
    const cell = document.createElement('div');

    if (dayNum < 1 || dayNum > daysInMonth) {
      cell.className = 'admin-cal-cell is-outside';
      calGrid.appendChild(cell);
      continue;
    }

    const dateStr = toDateStr(year, month, dayNum);
    const count = countsByDate[dateStr] || 0;
    const isClosed = closedDaySet.has(dateStr);
    const isToday = dateStr === today;
    const isPast = dateStr < today;

    cell.className = 'admin-cal-cell'
      + (isToday ? ' is-today' : '')
      + (isClosed ? ' is-closed' : '')
      + (isPast ? ' is-past' : '')
      + (count > 0 ? ' has-bookings' : '');
    cell.innerHTML = `
      <span class="admin-cal-daynum">${dayNum}</span>
      ${isClosed ? '<span class="admin-cal-flag">Closed</span>' : ''}
      ${count > 0 ? `<span class="admin-cal-count">${count} booking${count === 1 ? '' : 's'}</span>` : ''}
    `;

    if (count > 0) {
      cell.setAttribute('role', 'button');
      cell.tabIndex = 0;
      cell.addEventListener('click', () => jumpToDay(dateStr));
      cell.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); jumpToDay(dateStr); }
      });
    }

    calGrid.appendChild(cell);
  }
}

function jumpToDay(dateStr) {
  const target = bookingsList.querySelector(`[data-day-group="${dateStr}"]`);
  if (target) {
    target.scrollIntoView({ behavior: 'smooth', block: 'start' });
    target.classList.add('is-flash');
    setTimeout(() => target.classList.remove('is-flash'), 1200);
    return;
  }
  // The day has bookings (per the calendar count) but isn't in the currently
  // rendered list — that only happens for a past date while "show past" is
  // off. Flip it on and retry once the list re-renders.
  if (dateStr < todayStr() && showPastToggle && !showPastToggle.checked) {
    showPastToggle.checked = true;
    loadBookings().then(() => jumpToDay(dateStr));
  }
}

calPrevBtn.addEventListener('click', () => {
  calCursor.setUTCMonth(calCursor.getUTCMonth() - 1);
  renderCalendar();
});
calNextBtn.addEventListener('click', () => {
  calCursor.setUTCMonth(calCursor.getUTCMonth() + 1);
  renderCalendar();
});
calTodayBtn.addEventListener('click', () => {
  calCursor = new Date(todayStr() + 'T00:00:00Z');
  calCursor.setUTCDate(1);
  renderCalendar();
});

// --- Bookings list ---------------------------------------------------------
const bookingsList = document.getElementById('bookingsList');
const bookingsSkeleton = document.getElementById('bookingsSkeleton');
const bookingsMessage = document.getElementById('bookingsMessage');
const showPastToggle = document.getElementById('showPastToggle');
const statToday = document.getElementById('statToday');
const statWeek = document.getElementById('statWeek');
const statUpcoming = document.getElementById('statUpcoming');
const statBlocked = document.getElementById('statBlocked');

function showBookingsMessage(text, isError) {
  bookingsMessage.textContent = text;
  bookingsMessage.hidden = !text;
  bookingsMessage.className = 'admin-message' + (isError ? ' is-error' : '');
}

let allUpcomingCount = 0;

async function loadBookings() {
  bookingsSkeleton.hidden = false;
  bookingsList.hidden = true;
  showBookingsMessage('', false);

  try {
    const from = showPastToggle.checked ? '2000-01-01' : todayStr();
    const data = await apiFetch(`/api/admin/bookings?from=${from}`);
    const bookings = data.bookings || [];
    renderBookings(bookings);
    updateStats(bookings, showPastToggle.checked);
    latestBookings = bookings;
    renderCalendar();

    if (!bookings.length) showBookingsMessage('No bookings in this range.', false);
  } catch (err) {
    showBookingsMessage(describeError(err), true);
  } finally {
    bookingsSkeleton.hidden = true;
  }
}

function updateStats(bookingsFromToday, includesPast) {
  // If "show past" is on, the fetched list includes old bookings too —
  // stats should still only ever count today-forward, so re-derive from
  // the full list rather than trusting the fetch range.
  const today = todayStr();
  const weekOut = addDays(today, 7);
  const confirmed = bookingsFromToday.filter((b) => b.status === 'confirmed' && b.date >= today);

  statToday.textContent = confirmed.filter((b) => b.date === today).length;
  statWeek.textContent = confirmed.filter((b) => b.date < weekOut).length;
  statUpcoming.textContent = confirmed.length;
  allUpcomingCount = confirmed.length;
}

function renderBookings(bookings) {
  bookingsList.innerHTML = '';
  bookingsList.hidden = bookings.length === 0;

  // Group by date, preserving the date-ascending order the API already
  // returns them in.
  const groups = [];
  let currentGroup = null;
  bookings.forEach((b) => {
    if (!currentGroup || currentGroup.date !== b.date) {
      currentGroup = { date: b.date, items: [] };
      groups.push(currentGroup);
    }
    currentGroup.items.push(b);
  });

  groups.forEach((group) => {
    const groupEl = document.createElement('div');
    groupEl.className = 'admin-day-group';
    const confirmedCount = group.items.filter((b) => b.status === 'confirmed').length;
    groupEl.dataset.dayGroup = group.date;
    groupEl.innerHTML = `
      <div class="admin-day-header">
        <span class="admin-day-date">${fmtDayHeader(group.date)}</span>
        <span class="admin-day-count">${confirmedCount} booking${confirmedCount === 1 ? '' : 's'}</span>
      </div>
      <div class="admin-day-bookings"></div>
    `;
    const bookingsWrap = groupEl.querySelector('.admin-day-bookings');

    group.items.forEach((b) => {
      const card = document.createElement('div');
      card.className = 'admin-booking-card' + (b.status === 'cancelled' ? ' is-cancelled' : '');
      const svcClass = SERVICE_CLASS[b.service] || '';
      const cancelBtn = b.status === 'confirmed'
        ? `<button type="button" class="admin-cancel-btn" data-id="${b.id}">Cancel</button>`
        : `<span class="admin-cancelled-pill">Cancelled</span>`;

      card.innerHTML = `
        <div class="admin-booking-time">${fmt12(b.time_slot)} – ${fmt12(b.end_time)}</div>
        <div class="admin-booking-main">
          <span class="admin-svc-badge ${svcClass}">${SERVICE_LABELS[b.service] || b.service || ''}</span>
          <span class="admin-booking-name">${escapeHtml(b.name)}</span>
          <span class="admin-booking-phone">${escapeHtml(b.phone || '')}</span>
        </div>
        <div class="admin-booking-meta">
          ${b.vehicle ? escapeHtml(b.vehicle) : ''}${b.vehicle && b.location ? ' · ' : ''}${b.location ? escapeHtml(b.location) : ''}
          ${b.message ? `<div class="admin-booking-note">"${escapeHtml(b.message)}"</div>` : ''}
        </div>
        <div class="admin-booking-action">${cancelBtn}</div>
      `;
      bookingsWrap.appendChild(card);
    });

    bookingsList.appendChild(groupEl);
  });
}

bookingsList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.admin-cancel-btn');
  if (!btn) return;
  if (!window.confirm('Cancel this booking? This frees up the time slot again.')) return;
  btn.disabled = true;
  btn.textContent = 'Cancelling…';
  try {
    await apiFetch(`/api/admin/bookings/${btn.dataset.id}/cancel`, { method: 'POST' });
    loadBookings();
  } catch (err) {
    btn.disabled = false;
    btn.textContent = 'Cancel';
    alert(describeError(err));
  }
});

showPastToggle.addEventListener('change', loadBookings);

// --- Add booking form ------------------------------------------------------
const addBookingForm = document.getElementById('addBookingForm');
const addBookingStatus = document.getElementById('addBookingStatus');

addBookingForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(addBookingForm);
  const payload = Object.fromEntries(fd.entries());

  addBookingStatus.textContent = 'Adding…';
  addBookingStatus.className = 'admin-status';
  try {
    await apiFetch('/api/admin/bookings', { method: 'POST', body: JSON.stringify(payload) });
    addBookingStatus.textContent = 'Booked!';
    addBookingStatus.className = 'admin-status is-success';
    addBookingForm.reset();
    loadBookings();
  } catch (err) {
    addBookingStatus.textContent = err.message === 'slot_taken'
      ? 'That time overlaps another booking (or is within the 1-hr travel buffer). Pick another time.'
      : describeError(err);
    addBookingStatus.className = 'admin-status is-error';
  }
});

// --- Closed days ------------------------------------------------------------
const closedDaysList = document.getElementById('closedDaysList');
const addClosedDayForm = document.getElementById('addClosedDayForm');
const addClosedDayStatus = document.getElementById('addClosedDayStatus');

async function loadClosedDays() {
  try {
    const data = await apiFetch('/api/admin/closed-days');
    const days = data.closedDays || [];
    renderClosedDays(days);
    statBlocked.textContent = days.length;
    closedDaySet = new Set(days.map((d) => d.date));
    renderCalendar();
  } catch (err) {
    closedDaysList.innerHTML = `<li class="admin-dim">${escapeHtml(describeError(err))}</li>`;
    statBlocked.textContent = '—';
  }
}

function renderClosedDays(days) {
  closedDaysList.innerHTML = '';
  if (!days.length) {
    closedDaysList.innerHTML = '<li class="admin-dim">No blocked days.</li>';
    return;
  }
  days.forEach((d) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span>${d.date}${d.reason ? ' — ' + escapeHtml(d.reason) : ''}</span>
      <button type="button" class="admin-remove-btn" data-date="${d.date}">Remove</button>
    `;
    closedDaysList.appendChild(li);
  });
}

closedDaysList.addEventListener('click', async (e) => {
  const btn = e.target.closest('.admin-remove-btn');
  if (!btn) return;
  btn.disabled = true;
  try {
    await apiFetch(`/api/admin/closed-days/${btn.dataset.date}`, { method: 'DELETE' });
    loadClosedDays();
  } catch (err) {
    btn.disabled = false;
    alert(describeError(err));
  }
});

addClosedDayForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(addClosedDayForm);
  const payload = Object.fromEntries(fd.entries());
  addClosedDayStatus.textContent = 'Saving…';
  addClosedDayStatus.className = 'admin-status';
  try {
    await apiFetch('/api/admin/closed-days', { method: 'POST', body: JSON.stringify(payload) });
    addClosedDayStatus.textContent = 'Blocked!';
    addClosedDayStatus.className = 'admin-status is-success';
    addClosedDayForm.reset();
    loadClosedDays();
  } catch (err) {
    addClosedDayStatus.textContent = describeError(err);
    addClosedDayStatus.className = 'admin-status is-error';
  }
});

// --- init ------------------------------------------------------------------
renderCalendar();
loadBookings();
loadClosedDays();
