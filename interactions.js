// Barona Mobile Detailing — visual polish
// Two independent, non-essential enhancements: a subtle header elevation
// change on scroll, and a fade-in-on-scroll reveal for content blocks.
// Neither is required for the site to function — if this file fails to
// load, everything just renders in its final state immediately (see the
// .reveal CSS rule in style.css, which only hides content once this script
// actually runs and adds the class).
(function () {
  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // --- Header elevation on scroll -------------------------------------
  const header = document.querySelector('.site-header');
  if (header) {
    const setHeaderState = () => {
      header.classList.toggle('is-scrolled', window.scrollY > 12);
    };
    setHeaderState();
    window.addEventListener('scroll', setHeaderState, { passive: true });
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

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-visible');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.12, rootMargin: '0px 0px -40px 0px' }
  );

  document.querySelectorAll('.reveal').forEach((el) => observer.observe(el));
})();
