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

    var embed = document.querySelector('[data-booking-embed]');
    var frame = document.querySelector('[data-booking-frame]');
    if (!embed || !frame) return;

    // On ne charge le cadre que si l'URL est configurée. Sinon la page reste
    // propre : la CTA "Réserver sur Square" fait tout le travail.
    var url = bookingUrl('');
    if (!url || url === '#') return;

    var revealed = false;
    // Le cadre reste masqué tant qu'il n'a pas répondu. Si Square refuse
    // l'affichage en cadre (X-Frame-Options), on ne montre jamais un bloc
    // gris vide : le bouton en haut reste la seule voie d'accès.
    frame.addEventListener('load', function () {
      if (revealed) return;
      revealed = true;
      embed.hidden = false;
    });
    frame.src = url;

    // Filet de sécurité : après 8 s sans "load", on renonce et on garde le
    // cadre caché.
    window.setTimeout(function () {
      if (revealed) return;
      frame.removeAttribute('src');
    }, 8000);
  }

  /* ----------------------------------------------------------------------
     Formulaires
     --------------------------------------------------------------------
     Deux voies d'envoi, dans cet ordre :

     1. Si un identifiant Formspree est configuré pour ce formulaire, on
        envoie en arrière-plan (fetch) : le visiteur ne quitte pas la page
        et voit un message de confirmation.
     2. Sinon, on ouvre le client courriel du visiteur avec le message
        déjà rédigé (mailto:). C'est moins élégant qu'un envoi direct
        mais ça FONCTIONNE dès la mise en ligne, sans aucun compte tiers.
     ---------------------------------------------------------------------- */

  var MAILTO_LABEL = {
    contact:    "Formulaire de contact — site bopoil.ca",
    intake:     "Fiche d'informations — nouveau profil client",
    newsletter: "Inscription à l'infolettre"
  };

  var FIELD_LABEL = {
    nom: "Nom complet",
    email: "Adresse courriel",
    message: "Message",
    proprietaire: "Prénom et nom du propriétaire",
    telephone: "Numéro de téléphone",
    nom_animal: "Nom de l'animal",
    anniversaire: "Date d'anniversaire",
    espece: "Type d'animal",
    race: "Race",
    taille: "Taille (poids)",
    sante: "Santé",
    comportement: "Comportement",
    sterilise: "Stérilisé(e)",
    gateries: "Gâteries autorisées",
    photos: "Photos autorisées",
    marketing: "Marketing"
  };

  function buildMailto(form, key) {
    var to = (CONFIG.contact && CONFIG.contact.email) || 'info@bopoil.ca';
    var subject = MAILTO_LABEL[key] || "Message du site bopoil.ca";
    var lines = [];
    var data = new FormData(form);
    var seen = {};
    data.forEach(function (value, name) {
      if (!value || seen[name]) return;
      seen[name] = true;
      var label = FIELD_LABEL[name] || name;
      lines.push(label + " : " + String(value).replace(/\r?\n/g, "\n  "));
    });
    return 'mailto:' + encodeURIComponent(to)
      + '?subject=' + encodeURIComponent(subject)
      + '&body=' + encodeURIComponent(lines.join('\n\n'));
  }

  function initForms() {
    document.querySelectorAll('form[data-formspree]').forEach(function (form) {
      var key = form.getAttribute('data-formspree');
      var id = (CONFIG.formspree || {})[key];
      var coatCare = CONFIG.coatCare || {};
      var crmIntake = key === 'intake' && coatCare.intakeUrl;
      var configured = crmIntake || (id && id.indexOf('VOTRE_') !== 0);
      var status = form.querySelector('.form-status');

      function say(kind, message) {
        if (!status) { window.alert(message); return; }
        status.hidden = false;
        status.className = 'form-status form-status--' + kind;
        status.textContent = message;
        status.setAttribute('role', kind === 'err' ? 'alert' : 'status');
      }

      if (crmIntake) form.action = coatCare.intakeUrl;
      else if (configured) form.action = 'https://formspree.io/f/' + id;

      form.addEventListener('submit', function (e) {
        e.preventDefault();

        // Le HTML impose déjà required, mais on garde une ceinture pour
        // les formulaires longs (fiche d'informations).
        if (!form.reportValidity()) return;

        if (!configured) {
          // Voie de repli : on ouvre le client courriel prérempli. Le
          // visiteur n'a plus qu'à appuyer sur "Envoyer".
          window.location.href = buildMailto(form, key);
          say('ok', "Votre client courriel s'ouvre avec le message prérempli. " +
            "Il ne reste qu'à appuyer sur « Envoyer ». Vous pouvez aussi nous " +
            "écrire directement à " +
            ((CONFIG.contact && CONFIG.contact.email) || 'info@bopoil.ca') + '.');
          return;
        }

        var submit = form.querySelector('[type="submit"]');
        var original = submit ? submit.textContent : '';
        if (submit) { submit.disabled = true; submit.textContent = 'Envoi…'; }

        var request;
        if (crmIntake) {
          var values = {};
          new FormData(form).forEach(function (value, name) {
            values[name] = String(value);
          });
          values.marketing = values.marketing === 'oui';
          values.salonSlug = coatCare.salonSlug || '';
          values.locationSlug = coatCare.locationSlug || '';
          values.submissionId = window.crypto && window.crypto.randomUUID
            ? window.crypto.randomUUID()
            : String(Date.now()) + '-' + Math.random().toString(36).slice(2);
          request = fetch(coatCare.intakeUrl, {
            method: 'POST',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
            body: JSON.stringify(values)
          });
        } else {
          request = fetch('https://formspree.io/f/' + id, {
            method: 'POST',
            headers: { Accept: 'application/json' },
            body: new FormData(form)
          });
        }

        request.then(function (res) {
          return res.json().catch(function () { return {}; }).then(function (result) {
            if (!res.ok) throw new Error(result.error || 'HTTP ' + res.status);
          });
        }).then(function () {
          form.reset();
          say('ok', form.getAttribute('data-success') ||
            'Merci! Votre message a bien été envoyé. Nous vous répondrons sous peu.');
        }).catch(function (error) {
          if (crmIntake) {
            say('err', error && error.message
              ? error.message
              : "La fiche n'a pas pu être enregistrée. Vos réponses sont toujours dans le formulaire; veuillez réessayer ou nous appeler.");
            return;
          }
          // L'envoi direct a échoué (réseau, quota, autre) : on bascule
          // sur le mailto pour ne pas perdre le message.
          window.location.href = buildMailto(form, key);
          say('err', "L'envoi direct a échoué. Nous avons ouvert votre client " +
            "courriel avec le message prérempli à la place.");
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
    var shopUrl = CONFIG.square && CONFIG.square.shopUrl;
    document.querySelectorAll('[data-shop-link]').forEach(function (el) {
      if (shopUrl) el.href = shopUrl;
    });
    // Le lien "Boutique" reste masqué tant qu'aucune URL n'est configurée,
    // pour ne pas offrir un lien mort aux visiteurs.
    document.querySelectorAll('[data-shop-item]').forEach(function (el) {
      if (shopUrl) el.hidden = false;
    });
    document.querySelectorAll('[data-instagram-link]').forEach(function (el) {
      if (c.instagram) el.href = c.instagram;
    });
  }

  /* ----------------------------------------------------------------------
     Instagram — remplace la grille par le vrai fil si un widget est
     configuré (LightWidget ou autre embed en iframe).
     ---------------------------------------------------------------------- */

  function initInstagram() {
    var url = CONFIG.instagram && CONFIG.instagram.embedUrl;
    if (!url) return;
    var grid = document.querySelector('[data-instagram-grid]');
    if (!grid) return;
    var frame = document.createElement('iframe');
    frame.src = url;
    frame.loading = 'lazy';
    frame.title = 'Fil Instagram — @bopoil.toilettageboutique';
    frame.scrolling = 'no';
    frame.allowTransparency = true;
    frame.className = 'instagram__frame';
    grid.replaceWith(frame);
  }

  function init() {
    initNav();
    initCarousel();
    initMarquee();
    initBooking();
    initForms();
    initMisc();
    initInstagram();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
