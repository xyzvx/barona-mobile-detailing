// Mobile nav toggle
const navToggle = document.getElementById('navToggle');
const nav = document.getElementById('nav');

if (navToggle && nav) {
  navToggle.addEventListener('click', () => {
    const isOpen = nav.classList.toggle('open');
    navToggle.setAttribute('aria-expanded', String(isOpen));
  });

  // Close mobile menu after tapping a link
  nav.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => {
      nav.classList.remove('open');
      navToggle.setAttribute('aria-expanded', 'false');
    });
  });
}

// Footer year
const yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Booking form -> our own /api/book endpoint (Cloudflare Worker + D1).
// The calendar (calendar.js) fills the hidden #bookingDate / #bookingTimeSlot
// fields when someone picks an open day + time. The Worker checks the slot
// is still free, saves it, and emails the owner (via Web3Forms, server-side)
// — see worker.js.
const form = document.getElementById('bookingForm');
const status = document.getElementById('formStatus');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    const dateVal = document.getElementById('bookingDate').value;
    const slotVal = document.getElementById('bookingTimeSlot').value;

    if (!dateVal || !slotVal) {
      status.textContent = 'Please pick an available day and time above first.';
      status.style.color = '#c0392b';
      return;
    }

    submitBtn.disabled = true;
    status.textContent = 'Booking...';
    status.style.color = '';

    const payload = {
      date: dateVal,
      time_slot: slotVal,
      name: form.name.value,
      phone: form.phone.value,
      vehicle: form.vehicle.value,
      service: form.service.value,
      location: form.location.value,
      message: form.message.value,
    };

    try {
      const response = await fetch('/api/book', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = await response.json();

      if (response.ok && result.success) {
        status.textContent = `You're booked for ${result.label} — we'll see you then! A confirmation was just sent to us.`;
        status.style.color = '#0f8fbb';
        form.reset();
        // form.reset() also clears the hidden #bookingService field — put the
        // still-selected service back so the next booking keeps working.
        const serviceSelectEl = document.getElementById('serviceSelect');
        if (serviceSelectEl) document.getElementById('bookingService').value = serviceSelectEl.value;
        if (window.BaronaCalendar) window.BaronaCalendar.refresh();
      } else if (result.error === 'slot_taken') {
        status.textContent = 'Sorry — that time was just booked by someone else. Please pick another.';
        status.style.color = '#c0392b';
        if (window.BaronaCalendar) window.BaronaCalendar.refresh();
      } else {
        status.textContent = 'Something went wrong. Please call/text us instead.';
        status.style.color = '#c0392b';
      }
    } catch (err) {
      status.textContent = 'Network error. Please call/text us instead.';
      status.style.color = '#c0392b';
    } finally {
      submitBtn.disabled = !document.getElementById('bookingTimeSlot').value;
    }
  });
}
