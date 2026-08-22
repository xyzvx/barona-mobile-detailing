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
  unsure: 'Not sure',
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

async function apiFetch(path, options) {
  const res = await fetch(path, {
    ...options,
    headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options && options.headers) },
  });
  let data = null;
  try { data = await res.json(); } catch { /* ignore */ }
  if (!res.ok) {
    const err = new Error((data && data.error) || `request_failed_${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

// --- Bookings table ------------------------------------------------------
const bookingsBody = document.getElementById('bookingsBody');
const bookingsStatus = document.getElementById('bookingsStatus');
const showPastToggle = document.getElementById('showPastToggle');

async function loadBookings() {
  bookingsStatus.textContent = 'Loading…';
  try {
    const from = showPastToggle.checked ? '2000-01-01' : todayStr();
    const data = await apiFetch(`/api/admin/bookings?from=${from}`);
    renderBookings(data.bookings || []);
    bookingsStatus.textContent = data.bookings.length ? '' : 'No bookings in this range.';
  } catch (err) {
    bookingsStatus.textContent = 'Could not load bookings. Try refreshing.';
    bookingsStatus.style.color = '#c0392b';
  }
}

function renderBookings(bookings) {
  bookingsBody.innerHTML = '';
  bookings.forEach((b) => {
    const tr = document.createElement('tr');
    if (b.status === 'cancelled') tr.className = 'is-cancelled';

    const cancelCell = b.status === 'confirmed'
      ? `<button type="button" class="admin-cancel-btn" data-id="${b.id}">Cancel</button>`
      : '';

    tr.innerHTML = `
      <td>${b.date}</td>
      <td>${fmt12(b.time_slot)} – ${fmt12(b.end_time)}</td>
      <td>${SERVICE_LABELS[b.service] || b.service || ''}</td>
      <td>${escapeHtml(b.name)}<br><span class="admin-dim">${escapeHtml(b.phone || '')}</span></td>
      <td>${escapeHtml(b.vehicle || '')}</td>
      <td>${escapeHtml(b.location || '')}</td>
      <td>${escapeHtml(b.message || '')}</td>
      <td>${b.status}</td>
      <td>${cancelCell}</td>
    `;
    bookingsBody.appendChild(tr);
  });
}

function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str == null ? '' : String(str);
  return div.innerHTML;
}

bookingsBody.addEventListener('click', async (e) => {
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
    alert('Could not cancel — please try again.');
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
  addBookingStatus.style.color = '';
  try {
    await apiFetch('/api/admin/bookings', { method: 'POST', body: JSON.stringify(payload) });
    addBookingStatus.textContent = 'Booked!';
    addBookingStatus.style.color = '#3c8a5c';
    addBookingForm.reset();
    loadBookings();
  } catch (err) {
    if (err.message === 'slot_taken') {
      addBookingStatus.textContent = 'That time overlaps another booking (or is within the 1-hr travel buffer). Pick another time.';
    } else {
      addBookingStatus.textContent = 'Something went wrong — please try again.';
    }
    addBookingStatus.style.color = '#c0392b';
  }
});

// --- Closed days ------------------------------------------------------------
const closedDaysList = document.getElementById('closedDaysList');
const addClosedDayForm = document.getElementById('addClosedDayForm');
const addClosedDayStatus = document.getElementById('addClosedDayStatus');

async function loadClosedDays() {
  try {
    const data = await apiFetch('/api/admin/closed-days');
    renderClosedDays(data.closedDays || []);
  } catch (err) {
    closedDaysList.innerHTML = '<li class="admin-dim">Could not load blocked days.</li>';
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
    alert('Could not remove — please try again.');
  }
});

addClosedDayForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const fd = new FormData(addClosedDayForm);
  const payload = Object.fromEntries(fd.entries());
  addClosedDayStatus.textContent = 'Saving…';
  addClosedDayStatus.style.color = '';
  try {
    await apiFetch('/api/admin/closed-days', { method: 'POST', body: JSON.stringify(payload) });
    addClosedDayStatus.textContent = 'Blocked!';
    addClosedDayStatus.style.color = '#3c8a5c';
    addClosedDayForm.reset();
    loadClosedDays();
  } catch (err) {
    addClosedDayStatus.textContent = 'Something went wrong — please try again.';
    addClosedDayStatus.style.color = '#c0392b';
  }
});

// --- init ------------------------------------------------------------------
loadBookings();
loadClosedDays();
