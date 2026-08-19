/* ==========================================================================
   BOPOIL — comportements du site
   Aucune dépendance externe. Voir js/config.js pour la configuration.
   ========================================================================== */

(function () {
  'use strict';

  var CONFIG = window.BOPOIL_CONFIG || {};
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ----------------------------------------------------------------------
     Navigation — panneau mobile + sous-menus
     ---------------------------------------------------------------------- */

  function initNav() {
    var toggle = document.querySelector('.nav-toggle');
    var nav = document.getElementById('site-nav');
    if (!toggle || !nav) return;

    toggle.addEventListener('click', function () {
      var open = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!open));
      nav.setAttribute('data-open', String(!open));
      document.body.setAttribute('data-nav-open', String(!open));
    });

    // Sous-menus : clic sur mobile, survol géré en CSS sur grand écran.
    nav.querySelectorAll('.nav-link[aria-haspopup="true"]').forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        if (window.innerWidth >= 1024) return;
        e.preventDefault();
        var item = btn.closest('.nav-item');
        var open = item.getAttribute('data-open') === 'true';
        item.setAttribute('data-open', String(!open));
        btn.setAttribute('aria-expanded', String(!open));
      });
    });

    document.addEventListener('keydown', function (e) {
      if (e.key !== 'Escape') return;
      toggle.setAttribute('aria-expanded', 'false');
      nav.setAttribute('data-open', 'false');
      document.body.setAttribute('data-nav-open', 'false');
    });
  }

  /* ----------------------------------------------------------------------
     Carrousel de la page d'accueil
     ---------------------------------------------------------------------- */

  function initCarousel() {
    var hero = document.querySelector('[data-carousel]');
    if (!hero) return;

    var slides = Array.prototype.slice.call(hero.querySelectorAll('.hero-slide'));
    var dots = Array.prototype.slice.call(hero.querySelectorAll('.hero-dot'));
    if (slides.length < 2) return;

    var index = 0;
    var timer = null;
    var DELAY = 7000;

    function show(next) {
      index = (next + slides.length) % slides.length;
      slides.forEach(function (slide, i) {
        var active = i === index;
        slide.setAttribute('data-active', String(active));
        slide.setAttribute('aria-hidden', String(!active));
        var video = slide.querySelector('video');
        if (video) { active ? video.play().catch(function () {}) : video.pause(); }
      });
      dots.forEach(function (dot, i) {
        dot.setAttribute('aria-selected', String(i === index));
      });
    }

    function start() {
      if (reduceMotion) return;
      stop();
      timer = window.setInterval(function () { show(index + 1); }, DELAY);
    }
    function stop() { if (timer) { window.clearInterval(timer); timer = null; } }

    hero.querySelectorAll('[data-carousel-prev]').forEach(function (b) {
      b.addEventListener('click', function () { show(index - 1); start(); });
    });
    hero.querySelectorAll('[data-carousel-next]').forEach(function (b) {
      b.addEventListener('click', function () { show(index + 1); start(); });
    });
    dots.forEach(function (dot, i) {
      dot.addEventListener('click', function () { show(i); start(); });
    });

    hero.addEventListener('mouseenter', stop);
    hero.addEventListener('mouseleave', start);
    hero.addEventListener('focusin', stop);

    // Glissement tactile
    var startX = null;
    hero.addEventListener('touchstart', function (e) { startX = e.touches[0].clientX; }, { passive: true });
    hero.addEventListener('touchend', function (e) {
      if (startX === null) return;
      var dx = e.changedTouches[0].clientX - startX;
      if (Math.abs(dx) > 50) { show(index + (dx < 0 ? 1 : -1)); start(); }
      startX = null;
    });

    show(0);
    start();
  }

  /* ----------------------------------------------------------------------
     Marquee — duplique le contenu pour une boucle continue
     ---------------------------------------------------------------------- */

  function initMarquee() {
    document.querySelectorAll('.marquee__track').forEach(function (track) {
      if (track.dataset.cloned === 'true') return;
      track.innerHTML += track.innerHTML;
      track.dataset.cloned = 'true';
    });
  }

  /* ----------------------------------------------------------------------
     Réservation Square — remplit les liens et gère le repli
     ---------------------------------------------------------------------- */

  function bookingUrl(category) {
    var sq = CONFIG.square || {};
    var byCat = (sq.categories || {})[category];
    return byCat || sq.bookingUrl || '#';
  }

  function initBooking() {
    document.querySelectorAll('[data-booking-link]').forEach(function (el) {
      el.href = bookingUrl(el.getAttribute('data-booking-link') || '');
    });

    var frame = document.querySelector('[data-booking-frame]');
    if (!frame) return;

    var fallback = document.querySelector('[data-booking-fallback]');
    var loaded = false;

    frame.addEventListener('load', function () { loaded = true; });
    frame.src = bookingUrl('');

    // Square peut refuser l'affichage en cadre (X-Frame-Options). Si rien
    // n'a chargé après 6 s, on montre le lien direct à la place.
    window.setTimeout(function () {
      if (loaded || !fallback) return;
      fallback.hidden = false;
      frame.hidden = true;
    }, 6000);
  }

  /* ----------------------------------------------------------------------
     Formulaires — envoi via Formspree sans quitter la page
     ---------------------------------------------------------------------- */

  function initForms() {
    document.querySelectorAll('form[data-formspree]').forEach(function (form) {
      var key = form.getAttribute('data-formspree');
      var id = (CONFIG.formspree || {})[key];
      var status = form.querySelector('.form-status');

      function say(kind, message) {
        if (!status) { window.alert(message); return; }
        status.hidden = false;
        status.className = 'form-status form-status--' + kind;
        status.textContent = message;
        status.setAttribute('role', kind === 'err' ? 'alert' : 'status');
      }

      if (id && id.indexOf('VOTRE_') !== 0) {
        form.action = 'https://formspree.io/f/' + id;
      }

      form.addEventListener('submit', function (e) {
        e.preventDefault();

        if (!id || id.indexOf('VOTRE_') === 0) {
          say('err', "Le formulaire n'est pas encore relié. Écrivez-nous à " +
            (CONFIG.contact ? CONFIG.contact.email : 'info@bopoil.ca') + '.');
          return;
        }

        var submit = form.querySelector('[type="submit"]');
        var original = submit ? submit.textContent : '';
        if (submit) { submit.disabled = true; submit.textContent = 'Envoi…'; }

        fetch('https://formspree.io/f/' + id, {
          method: 'POST',
          headers: { Accept: 'application/json' },
          body: new FormData(form)
        }).then(function (res) {
          if (!res.ok) throw new Error('HTTP ' + res.status);
          form.reset();
          say('ok', form.getAttribute('data-success') ||
            'Merci! Votre message a bien été envoyé. Nous vous répondrons sous peu.');
        }).catch(function () {
          say('err', "L'envoi a échoué. Écrivez-nous directement à " +
            (CONFIG.contact ? CONFIG.contact.email : 'info@bopoil.ca') + '.');
        }).then(function () {
          if (submit) { submit.disabled = false; submit.textContent = original; }
        });
      });
    });
  }

  /* ----------------------------------------------------------------------
     Divers
     ---------------------------------------------------------------------- */

  function initMisc() {
    var year = String(new Date().getFullYear());
    document.querySelectorAll('[data-year]').forEach(function (el) { el.textContent = year; });

    var c = CONFIG.contact || {};
    document.querySelectorAll('[data-shop-link]').forEach(function (el) {
      if (CONFIG.square && CONFIG.square.shopUrl) el.href = CONFIG.square.shopUrl;
    });
    document.querySelectorAll('[data-instagram-link]').forEach(function (el) {
      if (c.instagram) el.href = c.instagram;
    });
  }

  function init() {
    initNav();
    initCarousel();
    initMarquee();
    initBooking();
    initForms();
    initMisc();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
