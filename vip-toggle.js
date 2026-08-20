// Barona Mobile Detailing — VIP pricing toggle
// Swaps the VIP frequency cards between Full Detail pricing and
// Interior/Exterior-only pricing using the data-full-*/data-io-* attributes
// already sitting on each .plan-card in index.html. No page reload, no
// network request — just a plain attribute swap.
(function () {
  const toggleButtons = document.querySelectorAll('.plans-toggle-btn');
  const cards = document.querySelectorAll('.plan-card');
  const highlight = document.querySelector('.plans-highlight');

  if (!toggleButtons.length || !cards.length) return;

  function applyView(view) {
    cards.forEach((card) => {
      const priceEl = card.querySelector('[data-price-el]');
      const unitEl = card.querySelector('[data-unit-el]');
      const saveEl = card.querySelector('[data-save-el]');
      const visitsEl = card.querySelector('[data-visits-el]');
      const annualEl = card.querySelector('[data-annual-el]');
      const onetimeEl = card.querySelector('[data-onetime-el]');

      const price = card.dataset[view + 'Price'];
      const unit = card.dataset[view + 'Unit'];
      const save = card.dataset[view + 'Save'];
      const visits = card.dataset[view + 'Visits'];
      const annual = card.dataset[view + 'Annual'];
      const onetime = card.dataset[view + 'Onetime'];

      // priceEl's first child is the text node holding the dollar amount;
      // the nested <span data-unit-el> holds the "/mo" or "/visit" part.
      if (priceEl && priceEl.firstChild) priceEl.firstChild.textContent = price;
      if (unitEl) unitEl.textContent = unit;
      if (saveEl) saveEl.textContent = save;
      if (visitsEl) visitsEl.textContent = visits;
      if (annualEl) annualEl.textContent = annual;
      if (onetimeEl) onetimeEl.textContent = onetime;
    });

    if (highlight) {
      const key = view === 'full' ? 'fullHighlight' : 'ioHighlight';
      const text = highlight.dataset[key];
      if (text) highlight.textContent = text;
    }
  }

  toggleButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      toggleButtons.forEach((b) => {
        b.classList.remove('is-active');
        b.setAttribute('aria-selected', 'false');
      });
      btn.classList.add('is-active');
      btn.setAttribute('aria-selected', 'true');
      applyView(btn.dataset.planView);
    });
  });
})();
