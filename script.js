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

// Booking form -> Web3Forms (free, no backend needed)
// Get your free access key at https://web3forms.com and paste it into the
// hidden "access_key" input in index.html before you go live.
const form = document.getElementById('bookingForm');
const status = document.getElementById('formStatus');

if (form) {
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    const submitBtn = form.querySelector('button[type="submit"]');
    submitBtn.disabled = true;
    status.textContent = 'Sending...';
    status.style.color = '';

    const formData = new FormData(form);

    try {
      const response = await fetch('https://api.web3forms.com/submit', {
        method: 'POST',
        headers: { Accept: 'application/json' },
        body: formData,
      });
      const result = await response.json();

      if (result.success) {
        status.textContent = "Thanks! We'll be in touch shortly to confirm your appointment.";
        status.style.color = '#0f8fbb';
        form.reset();
      } else {
        status.textContent = 'Something went wrong. Please call/text us instead.';
        status.style.color = '#c0392b';
      }
    } catch (err) {
      status.textContent = 'Network error. Please call/text us instead.';
      status.style.color = '#c0392b';
    } finally {
      submitBtn.disabled = false;
    }
  });
}
