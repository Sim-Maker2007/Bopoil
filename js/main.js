/* ============================================
   BOPOIL Toilettage & Boutique
   Main JavaScript
   ============================================ */

document.addEventListener('DOMContentLoaded', () => {

  // ---------- Hero Slideshow ----------
  const slides = document.querySelectorAll('.hero-slide');
  const dots = document.querySelectorAll('.hero-dot');
  const prevBtn = document.querySelector('.hero-arrow.prev');
  const nextBtn = document.querySelector('.hero-arrow.next');
  let currentSlide = 0;
  let slideInterval;

  function goToSlide(index) {
    if (slides.length === 0) return;
    slides[currentSlide].classList.remove('active');
    if (dots[currentSlide]) dots[currentSlide].classList.remove('active');
    currentSlide = (index + slides.length) % slides.length;
    slides[currentSlide].classList.add('active');
    if (dots[currentSlide]) dots[currentSlide].classList.add('active');
  }

  function nextSlide() {
    goToSlide(currentSlide + 1);
  }

  function prevSlide() {
    goToSlide(currentSlide - 1);
  }

  function startAutoplay() {
    slideInterval = setInterval(nextSlide, 5000);
  }

  function resetAutoplay() {
    clearInterval(slideInterval);
    startAutoplay();
  }

  if (slides.length > 0) {
    startAutoplay();

    if (nextBtn) {
      nextBtn.addEventListener('click', () => {
        nextSlide();
        resetAutoplay();
      });
    }

    if (prevBtn) {
      prevBtn.addEventListener('click', () => {
        prevSlide();
        resetAutoplay();
      });
    }

    dots.forEach((dot) => {
      dot.addEventListener('click', () => {
        goToSlide(parseInt(dot.dataset.slide, 10));
        resetAutoplay();
      });
    });
  }

  // ---------- Mobile Menu Toggle ----------
  const menuToggle = document.querySelector('.menu-toggle');
  const navLinks = document.querySelector('.nav-links');

  if (menuToggle && navLinks) {
    menuToggle.addEventListener('click', () => {
      navLinks.classList.toggle('open');
      menuToggle.classList.toggle('active');
    });

    // Close menu when a link is clicked
    navLinks.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        navLinks.classList.remove('open');
        menuToggle.classList.remove('active');
      });
    });
  }

  // ---------- Header scroll effect ----------
  const header = document.querySelector('.header');

  if (header) {
    window.addEventListener('scroll', () => {
      if (window.scrollY > 50) {
        header.style.background = 'rgba(17, 17, 17, 0.95)';
        header.style.backdropFilter = 'blur(10px)';
      } else {
        header.style.background = 'var(--bg-dark)';
        header.style.backdropFilter = 'none';
      }
    });
  }

  // ---------- Services nav active state ----------
  const servicesNavLinks = document.querySelectorAll('.services-nav a');

  if (servicesNavLinks.length > 0) {
    servicesNavLinks.forEach(link => {
      link.addEventListener('click', (e) => {
        servicesNavLinks.forEach(l => l.classList.remove('active'));
        link.classList.add('active');
      });
    });
  }

  // ---------- Contact form handling ----------
  const contactForm = document.getElementById('contact-form');

  if (contactForm) {
    contactForm.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = document.getElementById('name').value;
      const email = document.getElementById('email').value;
      const message = document.getElementById('message').value;

      // For now, show a confirmation. Replace with actual form submission later.
      const btn = contactForm.querySelector('.btn-submit');
      btn.textContent = 'Envoyé!';
      btn.style.background = '#4a9e4a';
      btn.style.borderColor = '#4a9e4a';
      btn.style.color = '#fff';

      setTimeout(() => {
        btn.textContent = 'Soumettre';
        btn.style.background = '';
        btn.style.borderColor = '';
        btn.style.color = '';
        contactForm.reset();
      }, 3000);
    });
  }

  // ---------- Smooth scroll for anchor links ----------
  document.querySelectorAll('a[href^="#"]').forEach(anchor => {
    anchor.addEventListener('click', (e) => {
      const targetId = anchor.getAttribute('href');
      if (targetId === '#') return;
      const target = document.querySelector(targetId);
      if (target) {
        e.preventDefault();
        const headerHeight = document.querySelector('.header').offsetHeight;
        const targetPosition = target.getBoundingClientRect().top + window.scrollY - headerHeight;
        window.scrollTo({ top: targetPosition, behavior: 'smooth' });
      }
    });
  });

});
