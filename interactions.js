// Barona Mobile Detailing — visual polish + booking-conversion helpers
// Three independent, non-essential enhancements. None of these are required
// for the site to function — if this file fails to load, the header stays
// static, the floating "Book Now" button never appears (but the header and
// nav still link straight to #contact the old-fashioned way), and content
// just renders in its final state immediately (see the .reveal CSS rule,
// which only hides content once this script actually runs and adds it).
(function () {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Header elevation + floating "Book Now" CTA -----------------------
  // One scroll handler drives both: the header picks up a shadow once
  // you've scrolled a little, and the floating CTA appears once you've
  // scrolled past the hero — then hides again once the booking section (or
  // the footer, past it) is actually in view, so it never sits on top of
  // the thing it's supposed to help you reach.
  const header = document.querySelector('.site-header');
  const hero = document.querySelector('.hero');
  const contact = document.getElementById('contact');
  const footer = document.querySelector('.site-footer');
  const floatCta = document.getElementById('floatBookCta');

  let ticking = false;
  function updateOnScroll() {
    ticking = false;
    if (header) header.classList.toggle('is-scrolled', window.scrollY > 12);

    if (floatCta && hero && contact && footer) {
      const heroBottom = hero.getBoundingClientRect().bottom;
      const contactRect = contact.getBoundingClientRect();
      const footerRect = footer.getBoundingClientRect();
      const viewportH = window.innerHeight;

      const pastHero = heroBottom < 80;
      const contactInView = contactRect.top < viewportH * 0.75 && contactRect.bottom > 0;
      const footerInView = footerRect.top < viewportH;

      floatCta.classList.toggle('is-visible', pastHero && !contactInView && !footerInView);
    }
  }
  function onScroll() {
    if (!ticking) {
      ticking = true;
      requestAnimationFrame(updateOnScroll);
    }
  }
  updateOnScroll();
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onScroll);

  // --- Jump-to-booking: land ready to pick a service ---------------------
  // Every link that jumps to #contact (hero button, header, nav, VIP CTA,
  // announcement bar, the floating button) also focuses the service
  // dropdown once the smooth-scroll settles, so the very next thing
  // someone does is start booking instead of having to find the dropdown.
  const serviceSelect = document.getElementById('serviceSelect');
  if (serviceSelect) {
    document.querySelectorAll('a[href="#contact"]').forEach((link) => {
      link.addEventListener('click', () => {
        window.setTimeout(() => {
          serviceSelect.focus({ preventScroll: true });
        }, 550);
      });
    });
  }

  if (prefersReducedMotion || typeof IntersectionObserver === 'undefined') return;

  // --- Scroll-reveal ----------------------------------------------------
  // Whole sections rise/fade in as they enter view; cards, review cards,
  // gallery photos, and VIP plan cards additionally stagger within their
  // own grid so a whole row doesn't just snap in at once.
  const sectionTargets = document.querySelectorAll('main > section');
  const groupSelectors = ['.card-grid > *', '.plans-grid > *', '.reviews-grid > *', '.gallery-grid > *', '.feature-grid > *'];

  sectionTargets.forEach((el) => el.classList.add('reveal'));

  groupSelectors.forEach((sel) => {
    document.querySelectorAll(sel).forEach((el, i) => {
      el.classList.add('reveal');
      el.style.setProperty('--reveal-i', Math.min(i, 6));
    });
  });

  const revealObserver = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          revealObserver.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.reveal').forEach((el) => revealObserver.observe(el));
})();
