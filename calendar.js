// Booking calendar — talks to /api/availability and /api/book (Cloudflare
// Worker + D1, see worker.js). The customer picks a service first (each
// service has a different appointment length), then a month grid renders:
// green = open day for that service's length, red = fully booked, gray =
// closed/past. Clicking a green day shows the open time windows; clicking
// one fills the hidden fields in #bookingForm.
(function () {
  const grid = document.getElementById('calendarGrid');
  if (!grid) return; // calendar isn't on this page

  const serviceSelect = document.getElementById('serviceSelect');
  const calendarBody = document.getElementById('calendarBody');
  const chooseServiceHint = document.getElementById('chooseServiceHint');

  const monthLabel = document.getElementById('calMonthLabel');
  const prevBtn = document.getElementById('calPrev');
  const nextBtn = document.getElementById('calNext');
  const statusEl = document.getElementById('calendarStatus');
  const slotPicker = document.getElementById('slotPicker');
  const slotPickerLabel = document.getElementById('slotPickerLabel');
  const slotButtons = document.getElementById('slotButtons');

  const dateInput = document.getElementById('bookingDate');
  const slotInput = document.getElementById('bookingTimeSlot');
  const serviceInput = document.getElementById('bookingService');
  const selectedSlotBox = document.getElementById('selectedSlot');
  const selectedSlotText = document.getElementById('selectedSlotText');
  const noSlotHint = document.getElementById('noSlotHint');
  const changeSlotBtn = document.getElementById('changeSlot');
  const submitBtn = document.getElementById('bookingSubmit');

  const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

  const today = new Date();
  let viewYear = today.getFullYear();
  let viewMonth = today.getMonth() + 1; // 1-12
  let monthData = null;
  let selectedDate = null;

  const minYear = today.getFullYear();
  const minMonth = today.getMonth() + 1;

  function clearSelection() {
    selectedDate = null;
    dateInput.value = '';
    slotInput.value = '';
    selectedSlotBox.hidden = true;
    noSlotHint.hidden = false;
    slotPicker.hidden = true;
    if (submitBtn) {
      submitBtn.disabled = true;
      submitBtn.textContent = 'Select a Time to Book';
    }
  }

  async function loadMonth(year, month) {
    if (!serviceInput.value) return;
    statusEl.textContent = 'Loading availability…';
    try {
      const res = await fetch(`/api/availability?year=${year}&month=${month}&service=${encodeURIComponent(serviceInput.value)}`);
      if (!res.ok) throw new Error('bad response');
      const data = await res.json();
      monthData = data;
      renderGrid(year, month, data.days || {});
      statusEl.textContent = '';
    } catch (err) {
      statusEl.textContent = 'Could not load the calendar right now — call/text us to book instead.';
    }
  }

  function renderGrid(year, month, days) {
    monthLabel.textContent = `${MONTH_NAMES[month - 1]} ${year}`;
    prevBtn.disabled = year === minYear && month === minMonth;

    grid.innerHTML = '';
    const firstWeekday = new Date(year, month - 1, 1).getDay();
    const daysInMonth = new Date(year, month, 0).getDate();

    for (let i = 0; i < firstWeekday; i++) {
      const empty = document.createElement('div');
      empty.className = 'cal-day cal-empty';
      grid.appendChild(empty);
    }

    for (let d = 1; d <= daysInMonth; d++) {
      const mm = String(month).padStart(2, '0');
      const dd = String(d).padStart(2, '0');
      const dateStr = `${year}-${mm}-${dd}`;
      const info = days[dateStr] || { open: false };

      const cell = document.createElement('button');
      cell.type = 'button';
      cell.textContent = String(d);
      cell.className = 'cal-day';

      if (info.past) {
        cell.classList.add('cal-past');
        cell.disabled = true;
      } else if (!info.open && info.reason) {
        cell.classList.add('cal-closed');
        cell.disabled = true;
        cell.title = info.reason;
      } else if (info.open) {
        cell.classList.add('cal-available');
        cell.title = `${info.slots.length} time${info.slots.length === 1 ? '' : 's'} open`;
        cell.addEventListener('click', () => showSlots(dateStr, info));
      } else {
        cell.classList.add('cal-full');
        cell.disabled = true;
        cell.title = 'Fully booked';
      }

      if (dateStr === selectedDate) cell.classList.add('cal-selected');

      grid.appendChild(cell);
    }
  }

  function showSlots(dateStr, info) {
    selectedDate = dateStr;
    renderGrid(viewYear, viewMonth, monthData.days);

    const dateObj = new Date(dateStr + 'T00:00:00');
    const label = dateObj.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
    slotPickerLabel.textContent = `Available times — ${label}`;
    slotButtons.innerHTML = '';

    info.slots.forEach((slot) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'slot-btn';
      btn.textContent = slot.label;
      btn.addEventListener('click', () => selectSlot(dateStr, slot, btn, label));
      slotButtons.appendChild(btn);
    });

    slotPicker.hidden = false;
    slotPicker.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function selectSlot(dateStr, slot, btnEl, dateLabel) {
    slotButtons.querySelectorAll('.slot-btn').forEach((b) => b.classList.remove('slot-btn-selected'));
    btnEl.classList.add('slot-btn-selected');

    dateInput.value = dateStr;
    slotInput.value = slot.start;

    const serviceText = serviceSelect.options[serviceSelect.selectedIndex].textContent;
    selectedSlotText.textContent = `Selected: ${dateLabel} — ${slot.label} (${serviceText})`;
    selectedSlotBox.hidden = false;
    noSlotHint.hidden = true;

    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.textContent = 'Book This Appointment';
    }
  }

  serviceSelect.addEventListener('change', () => {
    serviceInput.value = serviceSelect.value;
    clearSelection();
    if (serviceSelect.value) {
      calendarBody.hidden = false;
      chooseServiceHint.hidden = true;
      loadMonth(viewYear, viewMonth);
    } else {
      calendarBody.hidden = true;
      chooseServiceHint.hidden = false;
    }
  });

  if (changeSlotBtn) {
    changeSlotBtn.addEventListener('click', () => {
      clearSelection();
      grid.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });
  }

  prevBtn.addEventListener('click', () => {
    viewMonth -= 1;
    if (viewMonth < 1) { viewMonth = 12; viewYear -= 1; }
    clearSelection();
    loadMonth(viewYear, viewMonth);
  });

  nextBtn.addEventListener('click', () => {
    viewMonth += 1;
    if (viewMonth > 12) { viewMonth = 1; viewYear += 1; }
    clearSelection();
    loadMonth(viewYear, viewMonth);
  });

  // Exposed so script.js can refresh the grid after a successful booking
  // (the slot that was just taken should flip to booked/red for everyone else).
  window.BaronaCalendar = {
    refresh() {
      clearSelection();
      loadMonth(viewYear, viewMonth);
    },
  };
})();
