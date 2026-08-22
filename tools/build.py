#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
BOPOIL Toilettage & Boutique — générateur de pages statiques.

Ce script produit les fichiers .html à la racine du dépôt. Le site livré est
du HTML statique pur : aucun outil n'est requis pour le déployer. Ce script
n'est nécessaire que pour REGÉNÉRER les pages après une modification du
contenu ou de l'en-tête/pied de page partagés.

    python3 tools/build.py

Modifier le contenu : éditez les données ci-dessous, puis relancez le script.
Modifier la configuration (Square, Formspree, coordonnées) : js/config.js.
"""

import html as _html
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SITE_NAME = "BOPOIL Toilettage & Boutique"
SITE_NAME_ESC = "BOPOIL Toilettage &amp; Boutique"
SITE_URL = "https://www.bopoil.ca"
PHONE = "(819) 968-2827"
PHONE_TEL = "+18199682827"
EMAIL = "info@bopoil.ca"
ADDRESS = "38 Av Gatineau, Gatineau, Québec J8T 4J1"
INSTAGRAM = "https://www.instagram.com/bopoil.toilettageboutique/"
NB = " "  # espace insécable

# ---------------------------------------------------------------------------
# HEURES D'OUVERTURE — source unique de vérité
# ---------------------------------------------------------------------------
# L'ancien site se contredisait : la carte de l'accueil indiquait lundi et
# samedi « sur rendez-vous », la page contact affichait lundi 9-16 et samedi
# 9-14. Version retenue : celle de la carte de l'accueil.
HOURS = [
    ("Lundi",    "Sur rendez-vous"),
    ("Mardi",    f"9{NB}h à 16{NB}h"),
    ("Mercredi", f"9{NB}h à 16{NB}h"),
    ("Jeudi",    f"9{NB}h à 16{NB}h"),
    ("Vendredi", f"9{NB}h à 16{NB}h"),
    ("Samedi",   "Sur rendez-vous"),
    ("Dimanche", "Fermé"),
]

# Équivalent schema.org pour le JSON-LD (les jours « sur rendez-vous » ne sont
# pas déclarés comme heures d'ouverture fixes).
HOURS_SCHEMA = [
    ("Tuesday", "09:00", "16:00"),
    ("Wednesday", "09:00", "16:00"),
    ("Thursday", "09:00", "16:00"),
    ("Friday", "09:00", "16:00"),
]

# ---------------------------------------------------------------------------
# NAVIGATION
# ---------------------------------------------------------------------------
NAV = [
    {"label": "À propos", "href": "a-propos.html"},
    {"label": "Services", "href": "nos-services.html", "children": [
        {"label": "Chiens", "href": "chiens.html"},
        {"label": "Chats", "href": "chats.html"},
        {"label": "Petits animaux", "href": "petits-animaux.html"},
        {"label": "Votre guide toilettage", "href": "guide.html"},
    ]},
    {"label": "Politique", "href": "politique.html"},
    {"label": "Contactez-nous", "href": "contactez-nous.html", "children": [
        {"label": "Fiche d'informations - Profil client", "href": "fiche-informations.html"},
    ]},
]

FOOTER_LINKS = [
    ("Accueil", "index.html"),
    ("À propos", "a-propos.html"),
    ("Notre approche", "nos-services.html"),
    ("Chiens", "chiens.html"),
    ("Chats", "chats.html"),
    ("Petits animaux", "petits-animaux.html"),
    ("Guide toilettage", "guide.html"),
    ("Politique", "politique.html"),
    ("Réserver", "rendez-vous.html"),
    ("Boutique", "#boutique", {"shop": True}),  # remplacé par js si shopUrl configuré
    ("Contactez-nous", "contactez-nous.html"),
    ("Fiche d'informations", "fiche-informations.html"),
]

PAYMENTS = ["Square", "Apple Pay", "Google Pay", "Visa", "Mastercard",
            "Amex", "Discover", "JCB", "Interac"]


# ---------------------------------------------------------------------------
# Aides
# ---------------------------------------------------------------------------

def img(slug, alt, small, large, cls="", loading="lazy", sizes=None, extra=""):
    """<img> avec srcset sur les deux largeurs générées."""
    sizes = sizes or "100vw"
    cls = f' class="{cls}"' if cls else ""
    return (
        f'<img src="images/{slug}-{large}.jpg" '
        f'srcset="images/{slug}-{small}.jpg {small}w, images/{slug}-{large}.jpg {large}w" '
        f'sizes="{sizes}" alt="{alt}" loading="{loading}" decoding="async"{cls}{extra}>'
    )


def wide(slug, alt, **kw):
    return img(slug, alt, 800, 1600, **kw)


def thumb(slug, alt, **kw):
    return img(slug, alt, 480, 900, **kw)


def nav_html(current):
    out = []
    for item in NAV:
        active = ' aria-current="page"' if item["href"] == current else ""
        if item.get("children"):
            sub = "".join(
                f'<li><a class="nav-link" href="{c["href"]}">{c["label"]}</a></li>'
                for c in item["children"]
            )
            out.append(
                f'<li class="nav-item">'
                f'<a class="nav-link" href="{item["href"]}" aria-haspopup="true" aria-expanded="false"{active}>'
                f'{item["label"]}<span class="nav-caret" aria-hidden="true"></span></a>'
                f'<ul class="nav-submenu">{sub}</ul></li>'
            )
        else:
            out.append(
                f'<li class="nav-item">'
                f'<a class="nav-link" href="{item["href"]}"{active}>{item["label"]}</a></li>'
            )
    return "".join(out)


def header_html(current):
    return f"""  <header class="site-header profile-primary-bold">
    <div class="container">
      <a class="site-logo" href="index.html" aria-label="{SITE_NAME_ESC} — accueil">
        <img src="images/logo-bopoil-blanc-720.png" width="230" height="103"
             alt="{SITE_NAME_ESC}" fetchpriority="high">
      </a>
      <button class="nav-toggle" type="button" aria-expanded="false"
              aria-controls="site-nav" aria-label="Ouvrir le menu">
        <span></span><span></span><span></span>
      </button>
      <nav class="nav" id="site-nav" aria-label="Navigation principale">
        <ul class="nav-list">
{indent(nav_html(current), 10)}
        </ul>
        <div class="nav-cta">
          <a class="btn btn--filled btn--small" href="rendez-vous.html">Réserver</a>
        </div>
      </nav>
    </div>
  </header>"""


def footer_html():
    parts = []
    for entry in FOOTER_LINKS:
        label, href, *rest = entry
        opts = rest[0] if rest else {}
        if opts.get("shop"):
            parts.append(
                f'<li class="footer-nav__shop" hidden data-shop-item>'
                f'<a data-shop-link target="_blank" rel="noopener" href="{href}">{label}</a></li>'
            )
        else:
            parts.append(f'<li><a href="{href}">{label}</a></li>')
    links = "".join(parts)
    pays = "".join(f"<span>{p}</span>" for p in PAYMENTS)
    return f"""  <footer class="site-footer profile-primary-bold">
    <div class="container">
      <div class="site-footer__logo">
        <img src="images/logo-bopoil-blanc-720.png" width="230" height="103"
             alt="{SITE_NAME_ESC}" loading="lazy">
      </div>
      <hr class="site-footer__rule">
      <div class="site-footer__body">
        <div>
          <form class="newsletter" data-formspree="newsletter"
                data-success="Merci! Vous êtes inscrit à notre infolettre.">
            <p class="newsletter__prompt">
              Vous souhaitez être informé en priorité des nouveaux produits et services?<br>
              Inscrivez-vous à notre infolettre
            </p>
            <label class="visually-hidden" for="newsletter-email">Adresse courriel</label>
            <div class="newsletter__row">
              <input class="field" id="newsletter-email" type="email" name="email"
                     placeholder="Adresse courriel" autocomplete="email" required>
              <button class="btn btn--filled" type="submit">S'inscrire</button>
            </div>
            <p class="form-status" hidden></p>
          </form>
          <ul class="footer-nav">{links}</ul>
        </div>
        <div class="payments" aria-label="Modes de paiement acceptés">{pays}</div>
      </div>
      <div class="site-footer__meta">
        <p class="mb-0">
          <a href="tel:{PHONE_TEL}">{PHONE}</a> &nbsp;·&nbsp;
          <a href="mailto:{EMAIL}">{EMAIL}</a> &nbsp;·&nbsp;
          {ADDRESS} &nbsp;·&nbsp;
          <a href="{INSTAGRAM}" target="_blank" rel="noopener" data-instagram-link>@bopoil.toilettageboutique</a>
        </p>
        <p class="mb-0">&copy; <span data-year>2026</span> {SITE_NAME_ESC}</p>
      </div>
    </div>
  </footer>"""


SMS_PILL = f"""  <a class="sms-pill" href="sms:{PHONE_TEL}">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.4 8.4 0 0 1-9 8.4 9 9 0 0 1-3.9-.9L3 21l1.9-4.1A8.4 8.4 0 0 1 12 3a8.4 8.4 0 0 1 9 8.5Z"/>
    </svg>
    Contactez-nous par texto
  </a>"""


def indent(html, spaces):
    pad = " " * spaces
    return "\n".join(pad + line for line in html.split("\n"))


def jsonld(page):
    if page != "index.html":
        return ""
    spec = ",".join(
        '{"@type":"OpeningHoursSpecification","dayOfWeek":"%s",'
        '"opens":"%s","closes":"%s"}' % d for d in HOURS_SCHEMA
    )
    return f"""
  <script type="application/ld+json">
  {{
    "@context": "https://schema.org",
    "@type": "PetGroomer",
    "name": "{SITE_NAME}",
    "url": "{SITE_URL}/",
    "image": "{SITE_URL}/images/salon-photo-1-1600.jpg",
    "telephone": "{PHONE_TEL}",
    "email": "{EMAIL}",
    "priceRange": "$$",
    "address": {{
      "@type": "PostalAddress",
      "streetAddress": "38 Av Gatineau",
      "addressLocality": "Gatineau",
      "addressRegion": "QC",
      "postalCode": "J8T 4J1",
      "addressCountry": "CA"
    }},
    "sameAs": ["{INSTAGRAM}"],
    "openingHoursSpecification": [{spec}]
  }}
  </script>"""


def page(filename, title, description, body, og_image="salon-photo-1-1600.jpg",
         extra_head=""):
    """Assemble une page complète."""
    canonical = f"{SITE_URL}/" if filename == "index.html" else f"{SITE_URL}/{filename}"
    title = _html.escape(title, quote=True)
    description = _html.escape(description, quote=True)
    html = f"""<!DOCTYPE html>
<html lang="fr-CA">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{title}</title>
  <meta name="description" content="{description}">
  <link rel="canonical" href="{canonical}">
  <meta name="theme-color" content="#000000">

  <meta property="og:site_name" content="{SITE_NAME_ESC}">
  <meta property="og:type" content="website">
  <meta property="og:locale" content="fr_CA">
  <meta property="og:title" content="{title}">
  <meta property="og:description" content="{description}">
  <meta property="og:url" content="{canonical}">
  <meta property="og:image" content="{SITE_URL}/images/{og_image}">
  <meta name="twitter:card" content="summary_large_image">

  <link rel="icon" href="favicon.ico" sizes="any">
  <link rel="apple-touch-icon" href="apple-touch-icon.png">
  <link rel="manifest" href="site.webmanifest">

  <link rel="preload" href="fonts/playfair-display-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="preload" href="fonts/libre-franklin-latin-400-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="css/fonts.css">
  <link rel="stylesheet" href="css/tokens.css">
  <link rel="stylesheet" href="css/style.css">{extra_head}{jsonld(filename)}
</head>
<body>
  <a class="skip-link" href="#contenu">Passer au contenu principal</a>

{header_html(filename)}

  <main id="contenu">
{body.rstrip()}
  </main>

{footer_html()}

{SMS_PILL}

  <script src="js/config.js"></script>
  <script src="js/main.js" defer></script>
</body>
</html>
"""
    with open(os.path.join(ROOT, filename), "w", encoding="utf-8") as fh:
        fh.write(html)
    return filename


# ===========================================================================
# CONTENU DES PAGES
# ===========================================================================

MAP_EMBED = ("https://www.google.com/maps?q=38+Av+Gatineau,+Gatineau,+QC+J8T+4J1"
             "&hl=fr&z=16&output=embed")
DIRECTIONS = ("https://www.google.com/maps/dir/?api=1&destination="
              "38+Av+Gatineau,+Gatineau,+QC+J8T+4J1")

RECAPTCHA_NOTE = (
    '<p class="form-note">Vos données ne servent qu\'à vous répondre. '
    'Consultez notre <a href="politique.html">politique</a>.</p>'
)


def hours_list_html():
    return "".join(f"<li>{d} – {h}</li>" for d, h in HOURS)


def hours_dl_html():
    return "".join(
        f"<dt>{d.lower()}</dt><dd>{h}</dd>" for d, h in HOURS
    )


# ---------------------------------------------------------------------------
# ACCUEIL
# ---------------------------------------------------------------------------

HERO_SLIDES = [
    {
        "slug": "hero-printemps",
        "alt": "Un chien et un chat blottis l'un contre l'autre dans un champ au soleil couchant",
        "scrim": "0.4",
        "label": "Bienvenue chez BOPOIL",
        "title": "Plus qu'un toilettage,<br>une expérience douce et rassurante.",
        "body": ("Salon de toilettage et boutique au cœur de Touraine, à Gatineau. "
                 "Des soins adaptés au rythme de chaque animal, dans un espace calme, "
                 "propre et à aire ouverte."),
        "buttons": [
            ('<a class="btn btn--filled" href="rendez-vous.html">Réserver en ligne</a>'),
            ('<a class="btn btn--outline" href="contactez-nous.html">Écrivez-nous!</a>'),
        ],
        "eager": True,
    },
    {
        "slug": "hero-chiens",
        "alt": "Chien qui s'ébroue joyeusement après son bain",
        "scrim": "0.35",
        "focal": "0.33",
        "title": "Services pour chiens",
        "caps": True,
        "body": ("Nous offrons des services de toilettage pour chiens de petite, moyenne "
                 "et grande taille à Gatineau. Il est important pour nous de bien comprendre "
                 "les besoins spécifiques de votre compagnon et de déterminer les soins les "
                 "mieux adaptés à sa condition et à son tempérament."),
        "buttons": [
            ('<a class="btn btn--filled" href="rendez-vous.html">Réserver</a>'),
            ('<a class="btn btn--outline" href="chiens.html">Voir les services</a>'),
        ],
    },
    {
        "slug": "hero-chats",
        "alt": "Chat noir et blanc étendu, détendu, sur le plancher du salon",
        "scrim": "0.49",
        "title": "Services pour chats",
        "caps": True,
        "plum": True,
        "body": ("Un toilettage sans eau, tout en douceur, pensé pour le rythme et la "
                 "sensibilité des chats. Shampooing sec, démêlage, griffes et soins des "
                 "oreilles dans un environnement calme et sécurisé."),
        "buttons": [
            ('<a class="btn btn--filled" href="rendez-vous.html">Réserver</a>'),
            ('<a class="btn btn--outline" href="chats.html">Voir les services</a>'),
        ],
    },
    {
        "slug": "hero-petits-animaux",
        "alt": "Lapin couché sur une couverture",
        "scrim": "0.35",
        "title": "Services pour petits animaux",
        "caps": True,
        "body": ("Nouveauté en Outaouais : lapins, furets, cochons d'Inde et autres petits "
                 "compagnons ont eux aussi droit à un toilettage tout en douceur."),
        "buttons": [
            ('<a class="btn btn--filled" href="rendez-vous.html">Réserver</a>'),
            ('<a class="btn btn--outline" href="petits-animaux.html">Voir les services</a>'),
        ],
    },
]


def hero_html():
    slides, dots = [], []
    for i, s in enumerate(HERO_SLIDES):
        active = "true" if i == 0 else "false"
        focal = f' data-focal-y="{s["focal"]}"' if s.get("focal") else ""
        title_cls = "hero-title"
        if s.get("caps"):
            title_cls += " hero-title--caps"
        if s.get("plum"):
            title_cls += " hero-title--plum"
        label = f'<p class="hero-label">{s["label"]}</p>' if s.get("label") else ""
        picture = wide(
            s["slug"], s["alt"],
            loading="eager" if s.get("eager") else "lazy",
            sizes="100vw",
        )
        if s.get("eager"):
            picture = picture.replace('loading="eager"', 'loading="eager" fetchpriority="high"')
        slides.append(f"""      <div class="hero-slide" data-active="{active}" aria-hidden="{'false' if i == 0 else 'true'}"
           role="group" aria-roledescription="diapositive" aria-label="{i + 1} de {len(HERO_SLIDES)}">
        <div class="hero-media" style="--scrim-opacity: {s['scrim']};"{focal}>
          {picture}
        </div>
        <div class="hero-content">
          <div class="hero-copy">
            {label}
            <h{2 if i else 1} class="{title_cls}">{s['title']}</h{2 if i else 1}>
            <p class="hero-body">{s['body']}</p>
            <div class="btn-row">{''.join(s['buttons'])}</div>
          </div>
        </div>
      </div>""")
        dots.append(
            f'<button class="hero-dot" type="button" role="tab" '
            f'aria-selected="{active}" aria-label="Diapositive {i + 1}"></button>'
        )
    return f"""    <section class="hero" data-carousel aria-roledescription="carrousel" aria-label="Nos services">
{chr(10).join(slides)}
      <button class="hero-arrow hero-arrow--prev" type="button" data-carousel-prev
              aria-label="Diapositive précédente">&#8249;</button>
      <button class="hero-arrow hero-arrow--next" type="button" data-carousel-next
              aria-label="Diapositive suivante">&#8250;</button>
      <div class="hero-dots" role="tablist" aria-label="Choisir une diapositive">
        {''.join(dots)}
      </div>
    </section>"""


INDEX_BODY = f"""{hero_html()}

    <section class="testimonial profile-primary-bold">
      <div class="container">
        <figure class="mb-0">
          <blockquote>« AAA+ Excellent service, une place de confiance, je recommande
            à 110{NB}%, toujours satisfait de la coupe de mon pitou. Merci encore une fois
            pour le service hors pair{NB}!!! »</blockquote>
          <figcaption>L.G. nous a recommandé en mars 2026</figcaption>
        </figure>
      </div>
    </section>

    <section class="overlap profile-primary-dark-bold" aria-labelledby="heures-titre">
      <div class="overlap__media">
        {wide('chiots-endormis', "Trois chiots endormis côte à côte sur un lit", sizes='(max-width: 1023px) 100vw, 50vw')}
      </div>
      <div class="overlap__field" aria-hidden="true"></div>
      <div class="overlap__card">
        <p class="overlap__callout" id="heures-titre">Heures d'ouverture</p>
        <ul class="hours-list">{hours_list_html()}</ul>
        <p class="overlap__note"><strong>Notre salon est situé au 38 avenue Gatineau,
          au cœur de l'Outaouais</strong> et à moins de 5 minutes d'Ottawa.</p>
        <div class="btn-row">
          <a class="btn btn--filled" href="rendez-vous.html">Prendre rendez-vous</a>
        </div>
      </div>
    </section>

    <section class="instagram section" data-instagram>
      <div class="container">
        <div class="instagram__head">
          <h2 class="instagram__label">Notre salon en images</h2>
          <a class="instagram__handle" href="{INSTAGRAM}" target="_blank"
             rel="noopener" data-instagram-link>Suivez-nous · @bopoil.toilettageboutique</a>
        </div>
        <div class="instagram__grid" data-instagram-grid>
          <a href="{INSTAGRAM}" target="_blank" rel="noopener" data-instagram-link>
            {wide('salon-photo-1', "Chat tigré sur la table de toilettage", sizes='(max-width: 767px) 50vw, 33vw')}
          </a>
          <a href="{INSTAGRAM}" target="_blank" rel="noopener" data-instagram-link>
            {wide('salon-photo-2', "Deux petits compagnons au salon BOPOIL", sizes='(max-width: 767px) 50vw, 33vw')}
          </a>
          <a href="{INSTAGRAM}" target="_blank" rel="noopener" data-instagram-link>
            {wide('salon-photo-3', "Chat câliné après son toilettage", sizes='(max-width: 767px) 50vw, 33vw')}
          </a>
        </div>
      </div>
    </section>"""


# ---------------------------------------------------------------------------
# À PROPOS
# ---------------------------------------------------------------------------

APROPOS_PARAS = [
    "Depuis 2022, dans le beau quartier de Touraine, ce salon de toilettage met sa "
    "passion au service de vos compagnons, en leur offrant des soins tout en douceur "
    "et avec attention. D'abord établi dans l'ancien local de Josée Pizza, il déménage "
    "à l'automne 2024, au 38 avenue Gatineau, toujours au cœur du quartier.",

    "En mai 2025, une nouvelle propriétaire prend la relève et marque le début d'un "
    "renouveau. Tout en continuant d'offrir des services de toilettage de qualité, nous "
    "élargissons notre offre avec l'ouverture d'une boutique. Vous y trouverez une "
    "sélection de produits soigneusement choisis pour la santé, le bonheur… et le petit "
    "bedon de vos animaux, notamment la gamme Dogmâ. Les produits de cette gamme, d'une "
    "qualité exceptionnelle, performants et biologiques, proviennent d'une entreprise de "
    "chez nous.",

    "Nous vous accueillons dans un espace calme, propre et à aire ouverte, pensé pour le "
    "confort de vos animaux. Chaque séance est adaptée au rythme et à la sensibilité de "
    "votre compagnon, dans une atmosphère apaisante et rassurante.",

    "Animés par une véritable passion pour les animaux, nous avons à cœur de bâtir un "
    "lien de confiance avec vous et votre compagnon. Notre mission : vous offrir la "
    "tranquillité d'esprit grâce à des soins attentionnés et des produits adaptés. Chez "
    "nous, chaque toilettage et chaque visite en boutique deviennent un moment de "
    "bien-être, de complicité et de tendresse.",
]

APROPOS_BODY = f"""    <section class="split-hero">
      <div class="split-hero__media">
        {wide('boutique-interieur', "Rayons de la boutique BOPOIL garnis de produits pour animaux", loading='eager', sizes='(max-width: 1023px) 100vw, 50vw')}
      </div>
      <div class="split-hero__body">
        <h1 class="split-hero__title">À propos de BOPOIL</h1>
        <div class="stack">
          {''.join(f'<p>{p}</p>' for p in APROPOS_PARAS)}
        </div>
        <div class="btn-row">
          <a class="btn btn--filled" href="rendez-vous.html">Prendre rendez-vous</a>
          <a class="btn btn--outline" href="nos-services.html">Notre approche</a>
        </div>
      </div>
    </section>"""


# ---------------------------------------------------------------------------
# NOTRE APPROCHE
# ---------------------------------------------------------------------------

APPROCHE_PARAS = [
    "Le domaine animalier en Outaouais fait face à des besoins criants : la demande pour "
    "des services de qualité, respectueux et adaptés à chaque animal ne cesse de croître. "
    "L'offre reste souvent limitée ou standardisée et manque parfois de transparence. Les "
    "conditions d'hygiène et de bien-être ne sont pas toujours à la hauteur des attentes "
    "des propriétaires soucieux de la sécurité et du confort de leur compagnon.",

    "Conscientes de cette réalité, nous avons choisi de proposer une expérience différente, "
    "claire et honnête, centrée sur le rythme et les besoins de chaque animal. Chez nous, "
    "transparence et rigueur sont des éléments clés pour offrir un environnement sain, "
    "sécuritaire et chaleureux.",

    "Notre approche est bien simple : offrir aux chiens, aux chats et petits compagnons ce "
    "qu'ils méritent vraiment! Parce qu'ils occupent une place précieuse dans nos vies, nos "
    "animaux méritent une attention à la hauteur de l'amour qu'ils nous portent!",
]

PRINCE_PARAS = [
    "Cette citation du célèbre livre <em>Le Petit Prince</em> d'Antoine de Saint-Exupéry "
    "nous sensibilise sur le fait que les choses les plus précieuses sont très souvent "
    "invisibles. Elle nous rappelle que chaque animal possède une personnalité unique, des "
    "émotions et un monde que l'on ne peut deviner d'un simple regard. C'est pourquoi chaque "
    "soin doit être adapté avec attention pour son bien-être.",

    "En partageant notre passion et en restant attentifs aux besoins de chaque animal, nous "
    "recevons le plus beau des cadeaux soit leur confiance! Pour honorer ce lien précieux, "
    "nous leur offrons un environnement agréable, sécuritaire et sans oublier de l'affection "
    "à profusion.",

    "Nous nous engageons à offrir à nos clients un lieu où vous pouvez laisser votre "
    "compagnon en toute tranquillité, dans un environnement de transparence, d'honnêteté et "
    "de respect. Après chaque rendez-vous, nous vous informerons du déroulement du "
    "rendez-vous et nos recommandations, si nécessaire. Enfin, en cas de question ou de "
    "situation particulière, nous vous contacterons sans délai.",

    "Au plaisir de vous rencontrer!",
]

MARQUEE_ITEMS = ["Bien-être + Respect", "Passion + Écoute", "Transparence + Rigueur"]

APPROCHE_BODY = f"""    <section class="overlap overlap--approach profile-primary-light-neutral"
             aria-labelledby="approche-titre">
      <div class="overlap__media">
        {wide('approche-chat-chien', "Un chat bengal et un yorkshire côte à côte", loading='eager', sizes='(max-width: 1023px) 100vw, 55vw')}
      </div>
      <div class="overlap__field" aria-hidden="true"></div>
      <div class="overlap__card">
        <h1 class="section-title" id="approche-titre">Notre approche</h1>
        <p class="overlap__callout">Et le pourquoi?</p>
        {''.join(f'<p>{p}</p>' for p in APPROCHE_PARAS)}
      </div>
    </section>

    <section class="marquee profile-primary-bold" aria-label="Nos valeurs">
      <div class="marquee__track">
        {''.join(f'<span class="marquee__item">{i}</span>' for i in MARQUEE_ITEMS)}
      </div>
    </section>

    <section class="section prose-centered">
      <div class="container">
        <p class="prose-centered__quote">« On ne voit bien qu'avec le cœur.
          L'essentiel est invisible pour les yeux. »</p>
        <div class="stack">
          {''.join(f'<p>{p}</p>' for p in PRINCE_PARAS)}
        </div>
        <div class="btn-row" style="justify-content: center;">
          <a class="btn btn--filled" href="rendez-vous.html">Prendre rendez-vous</a>
        </div>
      </div>
    </section>

    <section class="gallery profile-primary-muted-bold" style="--scrim-opacity: .45;"
             aria-label="Photos du salon">
      <div class="gallery__bg">
        {wide('galerie-fond-corgi', "", sizes='100vw')}
      </div>
      <div class="container">
        <div class="gallery__track">
          {wide('salon-photo-1', "Chat tigré sur la table de toilettage", sizes='(max-width: 767px) 82vw, 33vw')}
          {wide('salon-photo-2', "Deux petits compagnons dans notre espace", sizes='(max-width: 767px) 82vw, 33vw')}
          {wide('salon-photo-4', "Chat blanc sur la table de toilettage", sizes='(max-width: 767px) 82vw, 33vw')}
        </div>
      </div>
    </section>"""


# ---------------------------------------------------------------------------
# SERVICES CHIENS / CHATS  (lignes image + texte)
# ---------------------------------------------------------------------------

CHIENS_SERVICES = [
    {
        "slug": "chien-toilettage-complet",
        "alt": "Toilettage complet d'un yorkshire aux ciseaux",
        "title": f"Toilettage complet – 70 à 180{NB}$",
        "intro": ["Remerciez votre loyal compagnon! Offrez-lui un soin de toilettage complet "
                  "dans un environnement doux et adapté, entre les mains de professionnels "
                  "passionnés.",
                  "Le toilettage comprend :"],
        "includes": ["Bain avec shampoing et produits adaptés", "Séchage",
                     "Brossage et démêlage complet", "Tonte et/ou taille aux ciseaux",
                     "Coupe des griffes", "Nettoyage des oreilles et des yeux",
                     "Eau de toilette au choix"],
        "duration": "<strong>Durée variée</strong> selon la taille du chien, la densité du "
                    "poil et sa coopération",
    },
    {
        "slug": "chien-traitement-mue",
        "alt": "Golden retriever après un traitement de la mue",
        "title": f"Traitement de la mue – 55 à 155{NB}$",
        "intro": ["Offrez à votre chien un soin complet pendant la période de mue! Notre "
                  "traitement spécial mue aide à éliminer l'excès de poils et à garder la "
                  "peau saine et le pelage léger.",
                  "Le traitement de la mue comprend :"],
        "includes": ["Bain avec traitement de la mue et produits adaptés", "Séchage",
                     "Brossage et démêlage complet", "Coupe des griffes",
                     "Nettoyage des oreilles et des yeux", "Eau de toilette au choix"],
        "duration": "<strong>Durée variée</strong> selon la taille du chien, la densité du "
                    "poil et sa coopération",
    },
    {
        "slug": "chien-toilettage-base",
        "alt": "Petit chien au bain pendant un toilettage de base",
        "title": f"Toilettage de base – 50 à 120{NB}$",
        "intro": ["Un toilettage de qualité, dans le respect du bien-être de votre chien. "
                  "Confiez votre compagnon à des passionnés, dans un cadre sécurisé et "
                  "apaisant.",
                  "Ce que comprend le toilettage :"],
        "includes": ["Bain avec shampoing", "Séchage", "Brossage et démêlage complet",
                     "Coupe des griffes", "Eau de toilette sur demande seulement"],
        "duration": "<strong>Durée variée</strong> selon la taille du chien, la densité du "
                    "poil et sa coopération",
    },
    {
        "slug": "chien-brossage",
        "alt": "Brossage d'un cocker spaniel",
        "title": f"Brossage – 40{NB}$",
        "intro": ["Votre chien mérite un pelage propre, soyeux et sans nœuds! Notre service "
                  "de brossage est spécialement conçu pour les chiens à poils courts, "
                  "mi-longs ou longs.",
                  "Le brossage pour chien comprend :"],
        "includes": ["Brossage et démêlage complet",
                     "Élimination des poils morts pour un pelage sain",
                     "Eau de toilette sur demande seulement"],
        "duration": "<strong>Durée variée</strong> selon la taille du chien, la densité du "
                    "poil et sa coopération",
    },
    {
        "slug": "chien-taille-griffes",
        "alt": "Taille des griffes d'un chien",
        "title": f"Taille de griffes – 10{NB}$",
        "intro": ["Notre service de taille de griffes est rapide, sécuritaire et réalisé par "
                  "des professionnels expérimentés.",
                  "<strong>Ce service est offert sans rendez-vous.</strong> À noter qu'il "
                  "pourrait cependant y avoir de l'attente selon notre horaire. Un "
                  "rendez-vous est donc recommandé.",
                  "Dans les deux cas, nous serons ravis de prendre soin des pattes de votre "
                  "fidèle ami!"],
        "includes": [],
        "duration": "<strong>Durée variée</strong> selon la coopération de votre chien.",
    },
]

CHATS_SERVICES = [
    {
        "slug": "chat-toilettage-complet",
        "alt": "Toilettage complet d'un chat au salon",
        "title": f"Toilettage complet – 70{NB}$",
        "intro": ["Votre chat mérite le meilleur! Offrez-lui un soin complet dans un "
                  "environnement calme, adapté et sécurisé, par des professionnels "
                  "passionnés.",
                  "Le toilettage comprend :"],
        "includes": ["Shampooing sec sans rinçage", "Brossage et démêlage complet",
                     "Tonte et/ou taille aux ciseaux", "Coupe des griffes",
                     "Nettoyage des oreilles et des yeux"],
        "duration": f"<strong>Durée{NB}: 40 à 50 minutes</strong> selon le type de poil et la "
                    "coopération du chat",
    },
    {
        "slug": "chat-toilettage-base",
        "alt": "Shampooing sec et brossage d'un chat",
        "title": f"Toilettage de base – 40{NB}$",
        "intro": ["Un soin respectueux du rythme de votre chat. Dans un environnement calme "
                  "et sécurisé, nos professionnels veillent à son bien-être.",
                  "Le toilettage comprend :"],
        "includes": ["Shampooing sec sans rinçage", "Brossage et démêlage complet",
                     "Coupe des griffes", "Nettoyage des oreilles et des yeux"],
        "duration": f"<strong>Durée{NB}: 20 à 30 minutes</strong> selon le type de poil et la "
                    "coopération du chat",
    },
    {
        "slug": "chat-brossage",
        "alt": "Brossage et démêlage d'un chat à poil long",
        "title": f"Brossage – 20{NB}$",
        "intro": ["Votre chat mérite un pelage soyeux et sans nœuds!",
                  "Notre service de brossage est spécialement conçu pour tous les types de "
                  "chats : poils courts, mi-longs ou longs.",
                  "Ce service consiste à offrir à votre chat un brossage et démêlage pour une "
                  "durée variant entre 15 à 20 minutes. La durée peut varier selon la "
                  "coopération du chat.",
                  "À noter qu'en présence de nœuds sévères, il est possible qu'un toilettage "
                  "complet soit recommandé et/ou nécessaire."],
        "includes": [],
        "duration": "",
    },
    {
        "slug": "chat-cache-griffes",
        "alt": "Cache-griffes colorés posés sur la patte d'un chat",
        "title": f"Pose de cache-griffes – 25{NB}$ (4 pattes) · 20{NB}$ (2 pattes)",
        "intro": ["Pose, cache-griffes et coupe de griffes inclus."],
        "includes": [],
        "duration": f"<strong>Durée{NB}: 20 à 30 minutes</strong> selon la coopération du chat",
    },
    {
        "slug": "chat-taille-griffes",
        "alt": "Griffes d'un chat tenues délicatement avant la taille",
        "title": f"Taille de griffes – 10{NB}$",
        "intro": ["Notre service de taille de griffes est rapide, sécuritaire et réalisé par "
                  "des professionnels expérimentés.",
                  "<strong>Ce service est offert sans rendez-vous.</strong> À noter qu'il "
                  "pourrait cependant y avoir de l'attente selon notre horaire. Un "
                  "rendez-vous est donc recommandé.",
                  "Dans les deux cas, nous serons ravis de prendre soin des pattes de votre "
                  "fidèle ami!"],
        "includes": [],
        "duration": f"<strong>Durée{NB}: 5 à 10 minutes</strong> selon la coopération du chat",
    },
]


def service_rows_html(services):
    rows = []
    for s in services:
        includes = ""
        if s["includes"]:
            items = "".join(f"<li>{i}</li>" for i in s["includes"])
            includes = f'<ul class="service-includes">{items}</ul>'
        duration = f'<p class="service-duration">{s["duration"]}</p>' if s["duration"] else ""
        rows.append(f"""          <article class="service-row">
            <div class="service-row__media">
              {thumb(s['slug'], s['alt'], sizes='(max-width: 767px) 100vw, 260px')}
            </div>
            <div class="service-row__body">
              <h2 class="service-row__title">{s['title']}</h2>
              {''.join(f'<p>{p}</p>' for p in s['intro'])}
              {includes}
              {duration}
              <p class="service-row__cta">
                <a class="btn btn--outline btn--small" href="rendez-vous.html">Réserver</a>
              </p>
            </div>
          </article>""")
    return "\n".join(rows)


def gallery_html(bg_slug, photos, label):
    imgs = "\n          ".join(
        wide(slug, alt, sizes="(max-width: 767px) 82vw, 33vw") for slug, alt in photos
    )
    return f"""    <section class="gallery profile-primary-muted-bold" style="--scrim-opacity: .45;"
             aria-label="{label}">
      <div class="gallery__bg">
        {wide(bg_slug, "", sizes='100vw')}
      </div>
      <div class="container">
        <div class="gallery__track">
          {imgs}
        </div>
      </div>
    </section>"""


def services_page_body(hero_slug, hero_alt, title, services, gallery_bg, photos):
    return f"""    <section class="page-hero" style="--scrim-opacity: .35;">
      <div class="page-hero__media">
        {wide(hero_slug, hero_alt, loading='eager', sizes='100vw')}
      </div>
      <div class="page-hero__inner">
        <h1 class="page-hero__title">{title}</h1>
      </div>
    </section>

    <section class="section profile-primary-light-neutral">
      <div class="container">
        <div class="service-rows">
{service_rows_html(services)}
        </div>
      </div>
    </section>

{gallery_html(gallery_bg, photos, 'Photos de nos toilettages')}"""


CHIENS_BODY = services_page_body(
    "banniere-chiens", "Gros plan sur l'œil et le museau d'un chien",
    "Services pour chiens", CHIENS_SERVICES, "galerie-fond-salon",
    [("galerie-spitz", "Spitz japonais sur la table de toilettage"),
     ("galerie-caniche", "Toiletteuse avec un caniche roux"),
     ("galerie-border-collie", "Border collie fraîchement toiletté")],
)

CHATS_BODY = services_page_body(
    "banniere-chats", "Portrait d'un chat roux",
    "Services pour chats", CHATS_SERVICES, "galerie-fond-guide",
    [("salon-photo-1", "Chat tigré sur la table de toilettage"),
     ("salon-photo-3", "Chat pris dans les bras après son toilettage"),
     ("salon-photo-4", "Chat blanc sur la table de toilettage")],
)


# ---------------------------------------------------------------------------
# PETITS ANIMAUX
# ---------------------------------------------------------------------------

PETITS_SERVICES = [
    ("lapin", "Lapin gris et blanc aux longues oreilles",
     f"Toilettage pour lapin – 40{NB}$",
     "Un toilettage tout en douceur pour votre ami à grandes oreilles! Brossage, griffes "
     "et soins adaptés pour garder votre lapin confortable, propre et heureux!"),
    ("furet", "Furet curieux photographié de près",
     f"Toilettage pour furet – 40{NB}$",
     "Frais et léger : un toilettage doux qui prend soin du pelage et des griffes de votre "
     "furet, pour un compagnon toujours prêt à jouer!"),
    ("petit-animal-griffes", "Taille des griffes d'un petit animal de compagnie",
     f"Taille de griffes – 10{NB}$",
     "Que ce soit un lapin, un cochon d'Inde, un rat, un furet ou tout autre petit animal, "
     "nous offrons aussi ce soin essentiel pour le confort et la santé de votre compagnon!"),
]

PETITS_BODY = f"""    <section class="page-hero page-hero--gradient profile-primary-dark-bold">
      <div class="page-hero__inner">
        <p class="eyebrow">Nouveauté en Outaouais{NB}!!!</p>
        <h1 class="page-hero__title">Services pour petits animaux de compagnie</h1>
      </div>
    </section>

    <section class="section profile-primary-light-neutral">
      <div class="container">
        <div class="service-cards">
          {''.join(f'''<article class="service-card">
            {thumb(slug, alt, sizes='(max-width: 767px) 100vw, 33vw')}
            <h2 class="service-card__title">{title}</h2>
            <p>{body}</p>
          </article>''' for slug, alt, title, body in PETITS_SERVICES)}
        </div>
        <div class="btn-row" style="margin-top: 48px;">
          <a class="btn btn--filled" href="rendez-vous.html">Prendre rendez-vous</a>
          <a class="btn btn--outline" href="contactez-nous.html">Poser une question</a>
        </div>
      </div>
    </section>"""


# ---------------------------------------------------------------------------
# GUIDE TOILETTAGE
# ---------------------------------------------------------------------------

GUIDE_CATEGORIES = [
    ("A - Ras ou nu",
     "Entretien minimal : aucun ou très peu de poil ni de sous-poil",
     "Recommandation minimale en toilettage :", f"1{NB}× par année",
     "Xoloitzcuintli, American Hairless, Chihuahua poil ras, Whippet, Greyhound, Basenji",
     None),
    ("B - Très court",
     "Entretien léger : bain et séchage rapide, aucun sous-poil et faible à aucune mue",
     "Recommandation minimale en toilettage :", f"1 à 2{NB}× par année",
     "Carlin, Boston Terrier, Pinscher, Bouledogue français, Terrier de Manchester, "
     "Bull Terrier, Boxer",
     None),
    ("C - Court à moyen",
     "Entretien saisonnier nécessaire : brossage régulier, traitement de mue recommandé, "
     "présence de sous-poil",
     "Recommandation minimale en toilettage :", f"4{NB}× par année",
     "Labrador, Beagle, Berger Australien poil court, Corgi, Teckel à poil ras avec "
     "sous-poil, Spitz Finlandais, Akita Inu, Shiba Inu, Jack Russell Terrier",
     None),
    ("D - Long ou frisé",
     "Entretien régulier nécessaire : coupe fréquente, démêlage modéré à fréquent, "
     "possibilité de soins cosmétiques ou stylisés",
     "Recommandation minimale en toilettage :", "aux 6 à 8 semaines*",
     "Bichon frisé, Caniche, Shih Tzu, Schnauzer, Yorkshire, Lhassa Apso, Cockapoo, "
     "Poméranien, Cavalier King Charles",
     "*Au-delà de 8 semaines, un rasage pourrait être nécessaire."),
    ("E - Long ou double",
     "Entretien régulier nécessaire : forte densité de poil et perte de poil importante, "
     "démêlage et brossage soutenu périodiquement",
     "Recommandation minimale en toilettage :", "aux 8 à 12 semaines",
     "Golden Retriever, Husky, Shetland, Colley, Berger Allemand",
     None),
    ("F - Dense ou laineux",
     "Entretien spécifique requis : démêlage et brossage intensif, mue excessive, "
     "compactage fréquent",
     "Recommandation en toilettage :", "évaluation requise au cas par cas",
     "Terre-Neuve, Bouvier Bernois, Chow Chow, Malamute, Komondor, Chien d'eau portugais, "
     "Briard, Samoyède, Leonberger — ou toute autre race de chien feutré ou présence de "
     "nœuds sévères",
     None),
]


def guide_grid_html():
    cells = []
    for title, maintenance, rec_label, rec_value, breeds, note in GUIDE_CATEGORIES:
        note_html = f'<span class="guide-cat__note">{note}</span>' if note else ""
        cells.append(f"""          <article class="guide-cat">
            <h2 class="guide-cat__title">{title}</h2>
            <p class="guide-cat__maintenance">{maintenance}</p>
            <dl>
              <dt>{rec_label}</dt><dd>{rec_value}</dd>
              <dt>Exemples de race :</dt><dd>{breeds}</dd>
            </dl>
            {note_html}
          </article>""")
    return "\n".join(cells)


GUIDE_BODY = f"""    <section class="page-hero" style="--scrim-opacity: .45;">
      <div class="page-hero__media">
        {wide('banniere-guide', "Pattes d'un chien au repos", loading='eager', sizes='100vw')}
      </div>
      <div class="page-hero__inner">
        <p class="visually-hidden">Votre guide toilettage</p>
      </div>
    </section>

    <section class="section profile-primary-bold">
      <div class="container">
        <h1 class="guide-title">Votre guide toilettage</h1>
        <p class="guide-subtitle">1. <em>Catégories pour chiens par type de poil</em></p>
        <p class="guide-intro">Parce que chaque chien a un pelage unique, notre tarification
          est basée sur le type de poil plutôt que simplement la race ou le poids. Cette
          approche nous permet d'évaluer plus justement le temps et les soins nécessaires,
          selon la densité, la texture et l'entretien requis. Que votre compagnon ait un poil
          ras, frisé ou dense, il sera classé dans la catégorie adaptée afin de recevoir les
          soins les plus appropriés — tout en vous offrant une transparence sur le prix.</p>
        <div class="guide-grid">
{guide_grid_html()}
        </div>
        <div class="btn-row" style="margin-top: 56px;">
          <a class="btn btn--filled" href="rendez-vous.html">Prendre rendez-vous</a>
          <a class="btn btn--outline" href="chiens.html">Voir les tarifs chiens</a>
        </div>
      </div>
    </section>

    <section class="marquee profile-primary-bold" aria-label="Notre engagement">
      <div class="marquee__track">
        <span class="marquee__item">Une tarification claire, basée sur le poil</span>
      </div>
    </section>

{gallery_html('galerie-fond-guide',
              [('galerie-caniche', "Caniche roux après son toilettage"),
               ('galerie-spitz', "Spitz japonais sur la table de toilettage"),
               ('galerie-border-collie', "Border collie après son toilettage")],
              'Photos de nos toilettages')}"""


# ---------------------------------------------------------------------------
# POLITIQUE
# ---------------------------------------------------------------------------

POLITIQUE_BODY = f"""    <section class="page-hero" style="--scrim-opacity: .5;">
      <div class="page-hero__media">
        {wide('banniere-politique', "Promenade avec un chien sur un trottoir en automne", loading='eager', sizes='100vw')}
      </div>
      <div class="page-hero__inner">
        <h1 class="page-hero__title">Politique des rendez-vous, annulation &amp; retard</h1>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="legal measure-wide">
          <p>Chez BOPOIL, notre priorité est d'offrir à vos compagnons des soins de qualité,
            dans un environnement calme, respectueux et bien organisé. Afin de préserver le
            bien-être de tous – animaux, clients et équipe – nous avons mis en place la
            politique suivante.</p>

          <h2>Prise de rendez-vous et présence</h2>
          <p>Les rendez-vous peuvent être pris en ligne, par téléphone ou directement au
            salon. Un rappel vous est envoyé entre 24{NB}h et 48{NB}h avant la date prévue. De
            plus, nous demandons à tous nos clients de se présenter seulement 5 minutes avant
            leur rendez-vous.</p>

          <h2>Annulation ou modification de rendez-vous</h2>
          <ul>
            <li>Annulation ou modification possible jusqu'à 24{NB}h avant le rendez-vous, sans
              frais.</li>
            <li>Annulation avec préavis de moins de 24{NB}h : 25{NB}% du montant du service sera
              facturé à votre prochaine visite.</li>
            <li>1<sup>re</sup> non-présentation sans préavis : 50{NB}% du montant du service sera
              facturé à votre prochaine visite.</li>
            <li>2<sup>e</sup> non-présentation sans préavis : 100{NB}% du montant du service sera
              facturé à votre prochaine visite.</li>
          </ul>

          <h2>Retard</h2>
          <h3>Avant le rendez-vous</h3>
          <ul>
            <li>Pour tout retard de plus de 15 minutes, le rendez-vous pourrait être
              écourté.</li>
            <li>Pour tout retard de plus de 30 minutes, le rendez-vous sera remis et facturé
              selon les frais de non-présentation.</li>
          </ul>

          <h3>Après le rendez-vous</h3>
          <p>En tout temps, nous demandons d'attendre notre appel avant de venir chercher
            votre compagnon. Votre présence peut nuire à la finition du toilettage précédant
            le vôtre.</p>
          <p>Pour tout retard de plus de 30 minutes après l'heure définie pour venir récupérer
            votre animal, des frais de garderie seront facturés à raison de 10{NB}$ par tranche
            de 15 minutes.</p>

          <h2>Transparence des prix</h2>
          <p>Cette politique vise à maintenir un horaire équilibré, à respecter le temps
            alloué à chaque client et à offrir une expérience agréable pour tous. Dans un
            souci de transparence, les frais applicables sont clairement communiqués à la
            clientèle, conformément aux exigences de la <em>Loi sur la protection du
            consommateur</em> en matière de transparence des prix.</p>

          <h2>Signature</h2>
          <p>Nous demandons à tous nos clients de signer notre politique. Une version papier
            est disponible en salon. En signant celle-ci, vous reconnaissez avoir lu, compris
            et accepté la Politique de rendez-vous, annulation et retard de BOPOIL.</p>
          <p>Vous pouvez aussi signer « électroniquement » notre politique en nous envoyant un
            courriel à l'adresse <a href="mailto:{EMAIL}">{EMAIL}</a> comme suit :</p>

          <div class="signature-block">
            <p><strong>Titre du courriel{NB}:</strong> Signature électronique</p>
            <p class="mb-0"><strong>Corps du courriel{NB}:</strong> <em>Je, (nom complet),
              reconnais avoir lu, compris et accepte la Politique de rendez-vous, annulation
              et retard de BOPOIL.</em></p>
          </div>

          <p>N'hésitez pas à nous contacter si vous avez des questions à
            <a href="mailto:{EMAIL}">{EMAIL}</a>.</p>
          <p>Merci beaucoup!</p>

          <div class="btn-row">
            <a class="btn btn--filled" href="mailto:{EMAIL}?subject=Signature%20%C3%A9lectronique&amp;body=Je%2C%20(nom%20complet)%2C%20reconnais%20avoir%20lu%2C%20compris%20et%20accepte%20la%20Politique%20de%20rendez-vous%2C%20annulation%20et%20retard%20de%20BOPOIL.">Signer par courriel</a>
            <a class="btn btn--outline" href="rendez-vous.html">Prendre rendez-vous</a>
          </div>
        </div>
      </div>
    </section>"""


# ---------------------------------------------------------------------------
# CONTACTEZ-NOUS
# ---------------------------------------------------------------------------

CONTACT_BODY = f"""    <section class="contact-hero profile-primary-dark-bold">
      <div class="contact-hero__bg">
        {wide('banniere-contact', "", loading='eager', sizes='100vw')}
      </div>
      <div class="container">
        <div class="contact-hero__intro stack">
          <h1 class="section-title">Contactez-nous</h1>
          <p>Vous êtes à la recherche d'un salon de toilettage pour offrir un vent de
            fraîcheur à votre compagnon?</p>
          <p>Vous êtes déjà client, aimeriez prendre votre prochain rendez-vous ou avez des
            commentaires à nous partager?</p>
          <p>Vous êtes un fournisseur et avez une proposition pour nous? Vous voulez
            travailler avec nous et faire partie de notre famille?</p>
          <p>Écrivez-nous à l'aide du formulaire ci-dessous! Nous serons enchantés de
            discuter avec vous en personne ou par téléphone!</p>
        </div>

        <form class="form form--narrow" data-formspree="contact"
              data-success="Merci! Votre message a bien été envoyé. Nous vous répondrons sous peu.">
          <div class="form-field">
            <label class="form-label" for="contact-nom">Nom complet
              <span class="req" aria-hidden="true">*</span></label>
            <input class="field" id="contact-nom" name="nom" type="text"
                   autocomplete="name" required>
          </div>
          <div class="form-field">
            <label class="form-label" for="contact-courriel">Adresse courriel
              <span class="req" aria-hidden="true">*</span></label>
            <input class="field" id="contact-courriel" name="email" type="email"
                   autocomplete="email" required>
          </div>
          <div class="form-field">
            <label class="form-label" for="contact-message">Message
              <span class="req" aria-hidden="true">*</span></label>
            <textarea class="field" id="contact-message" name="message" rows="5"
                      required></textarea>
          </div>
          {RECAPTCHA_NOTE}
          <p class="form-status" hidden></p>
          <div class="text-center">
            <button class="btn btn--filled" type="submit">Soumettre</button>
          </div>
        </form>
      </div>
    </section>

    <section class="location profile-primary-light-neutral">
      <div class="location__map">
        <iframe src="{MAP_EMBED}" loading="lazy" referrerpolicy="no-referrer-when-downgrade"
                title="Carte — 38 Av Gatineau, Gatineau, Québec"></iframe>
      </div>
      <div class="location__info">
        <p class="location__note">Veuillez noter que notre stationnement est situé directement
          sur Avenue Gatineau, devant notre entrée principale. Merci!</p>
        <div class="location__address">
          <h2 class="section-title" style="font-size: var(--font-step-1);">BOPOIL Gatineau</h2>
          <address>
            38 Av Gatineau<br>
            Gatineau, Québec J8T 4J1<br>
            <a href="tel:{PHONE_TEL}">{PHONE}</a><br>
            <a href="mailto:{EMAIL}">{EMAIL}</a>
          </address>
          <p style="margin-top: 16px;">
            <a href="{DIRECTIONS}" target="_blank" rel="noopener">Obtenir un itinéraire</a>
          </p>
        </div>
        <div>
          <h2 class="section-title" style="font-size: var(--font-step-1); margin-bottom: 16px;">
            Heures d'ouverture</h2>
          <dl class="location__hours">{hours_dl_html()}</dl>
        </div>
      </div>
    </section>"""


# ---------------------------------------------------------------------------
# FICHE D'INFORMATIONS
# ---------------------------------------------------------------------------

SIZES_OPTIONS = [
    f"XXS/TTP (moins de 10{NB}lbs)", f"XS/TP (11 à 20{NB}lbs)", f"S/P (21 à 40{NB}lbs)",
    f"M/M (41 à 60{NB}lbs)", f"L/G (61 à 80{NB}lbs)", f"XL/TG (81 à 100{NB}lbs)",
    f"XXL/TTG (101 à 120{NB}lbs)", f"Géant (plus de 121{NB}lbs)",
]


def radio_group(name, legend, options, required=False):
    req = ' <span class="req" aria-hidden="true">*</span>' if required else ""
    choices = "".join(
        f'<label class="choice"><input type="radio" name="{name}" value="{o}"'
        f'{" required" if required and i == 0 else ""}><span>{o}</span></label>'
        for i, o in enumerate(options)
    )
    return f"""          <fieldset class="field-group">
            <legend class="field-group__legend">{legend}{req}</legend>
            {choices}
          </fieldset>"""


def select_field(fid, name, label, options):
    opts = "".join(f'<option value="{o}">{o}</option>' for o in options)
    return f"""          <div class="form-field">
            <label class="form-label" for="{fid}">{label}</label>
            <select class="field" id="{fid}" name="{name}">
              <option value="">— Choisir —</option>{opts}
            </select>
          </div>"""


FICHE_BODY = f"""    <section class="page-hero" style="--scrim-opacity: .45;">
      <div class="page-hero__media">
        {wide('chiots-endormis', "Chiots endormis côte à côte sur un lit", loading='eager', sizes='100vw')}
      </div>
      <div class="page-hero__inner">
        <h1 class="page-hero__title page-hero__title--plain">Fiche d'informations</h1>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="intake">
          <div class="stack">
            <p>Vous êtes nouveau client chez la grande famille BOPOIL?</p>
            <p>Afin de mieux planifier votre premier rendez-vous avec nous, s'il vous plaît,
              compléter cette fiche d'informations. Le tout nous permettra d'adapter les soins
              offerts selon les besoins de votre animal.</p>
            <p>Déjà client? Et la situation de votre animal a changé?</p>
            <p>Merci de remplir de nouveau cette fiche afin que nous puissions mettre votre
              dossier à jour.</p>
            <p>Pour toutes questions, n'hésitez pas à
              <a href="contactez-nous.html">communiquer avec nous</a>.</p>
          </div>

          <form class="form" data-formspree="intake"
                data-success="Merci! Votre fiche a bien été reçue. Nous l'ajoutons à votre dossier.">
            <div class="form-field">
              <label class="form-label" for="fiche-proprietaire">Prénom et nom du propriétaire
                <span class="req" aria-hidden="true">*</span></label>
              <input class="field" id="fiche-proprietaire" name="proprietaire" type="text"
                     autocomplete="name" required>
            </div>
            <div class="form-field">
              <label class="form-label" for="fiche-telephone">Numéro de téléphone</label>
              <input class="field" id="fiche-telephone" name="telephone" type="tel"
                     autocomplete="tel">
            </div>
            <div class="form-field">
              <label class="form-label" for="fiche-courriel">Adresse courriel</label>
              <input class="field" id="fiche-courriel" name="email" type="email"
                     autocomplete="email">
            </div>
            <div class="form-field">
              <label class="form-label" for="fiche-animal">Nom de l'animal</label>
              <input class="field" id="fiche-animal" name="nom_animal" type="text">
            </div>
            <div class="form-field">
              <label class="form-label" for="fiche-anniversaire">Date d'anniversaire</label>
              <input class="field" id="fiche-anniversaire" name="anniversaire" type="date">
            </div>
{radio_group('espece', "Type d'animal", ['Chien', 'Chat', 'Petit animal'])}
            <div class="form-field">
              <label class="form-label" for="fiche-race">Race</label>
              <input class="field" id="fiche-race" name="race" type="text">
            </div>
{radio_group('taille', 'Taille (poids)', SIZES_OPTIONS)}
            <div class="form-field">
              <label class="form-label" for="fiche-sante">Informations sur la santé (troubles
                dermatologiques, vaccins, allergies, puces ou tiques, etc.)
                <span class="req" aria-hidden="true">*</span></label>
              <textarea class="field" id="fiche-sante" name="sante" rows="4"
                        required></textarea>
            </div>
            <div class="form-field">
              <label class="form-label" for="fiche-comportement">Informations sur les habitudes
                de vie ou le comportement (actif ou sédentaire, anxiété, agressivité,
                peurs)?</label>
              <textarea class="field" id="fiche-comportement" name="comportement"
                        rows="4"></textarea>
            </div>
{select_field('fiche-sterilise', 'sterilise', 'Stérilisé(e)?', ['Oui', 'Non'])}
{select_field('fiche-gateries', 'gateries', 'Autorisez-vous BOPOIL à offrir des gâteries?', ['Oui, vous gagnerez son coeur!', 'Non, je ne préfère pas.'])}
{select_field('fiche-photos', 'photos', 'Autorisez-vous BOPOIL à photographier votre animal à des fins de marketing?', ["Oui, j'autorise BOPOIL.", "Non, je n'autorise pas."])}
            <label class="choice">
              <input type="checkbox" name="marketing" value="oui">
              <span>J'accepte de recevoir du contenu marketing et promotionnel</span>
            </label>
            {RECAPTCHA_NOTE}
            <p class="form-status" hidden></p>
            <div>
              <button class="btn btn--filled" type="submit">Soumettre</button>
            </div>
          </form>
        </div>
      </div>
    </section>"""


# ---------------------------------------------------------------------------
# RENDEZ-VOUS  (Square Appointments)
# ---------------------------------------------------------------------------

RDV_BODY = f"""    <section class="page-hero" style="--scrim-opacity: .45;">
      <div class="page-hero__media">
        {wide('galerie-fond-corgi', "Corgi souriant, couché dans l'herbe", loading='eager', sizes='100vw')}
      </div>
      <div class="page-hero__inner">
        <h1 class="page-hero__title">Prendre rendez-vous</h1>
      </div>
    </section>

    <section class="section">
      <div class="container">
        <div class="measure-wide" style="margin-bottom: 40px;">
          <p>Réservez en quelques clics grâce à notre système de rendez-vous Square. Choisissez
            le service, la date et l'heure qui vous conviennent{NB}: vous recevrez une
            confirmation par courriel, puis un rappel entre 24{NB}h et 48{NB}h avant votre
            visite.</p>
          <p>Premier rendez-vous chez nous? Merci de remplir aussi la
            <a href="fiche-informations.html">fiche d'informations</a> afin que nous puissions
            adapter les soins aux besoins de votre animal.</p>
        </div>

        <div class="booking-cta">
          <div>
            <h2 class="booking-cta__title">Réservation en ligne</h2>
            <p class="mb-0">Choisissez votre service et votre plage horaire dans le
              calendrier Square, en un clic.</p>
          </div>
          <a class="btn btn--filled btn--large" data-booking-link="" target="_blank"
             rel="noopener" href="{{BOOKING_URL}}">Réserver sur Square</a>
        </div>

        <!-- Le cadre reste caché jusqu'à ce qu'il ait vraiment chargé, pour
             ne pas afficher un bloc gris vide si Square refuse le cadre. -->
        <div class="booking-embed" data-booking-embed hidden>
          <iframe data-booking-frame title="Réservation en ligne — Square Appointments"
                  loading="lazy"></iframe>
        </div>

        <div class="booking-links">
          <a class="booking-link" href="chiens.html">
            <h3>Chiens</h3>
            <p>Toilettage complet, traitement de la mue, toilettage de base, brossage et
              taille de griffes.</p>
          </a>
          <a class="booking-link" href="chats.html">
            <h3>Chats</h3>
            <p>Toilettage sans eau, brossage, pose de cache-griffes et taille de griffes.</p>
          </a>
          <a class="booking-link" href="petits-animaux.html">
            <h3>Petits animaux</h3>
            <p>Lapins, furets et autres petits compagnons{NB}: toilettage doux et taille de
              griffes.</p>
          </a>
        </div>

        <div class="booking-alt">
          <div>
            <h3>Par téléphone</h3>
            <p>Du mardi au vendredi, de 9{NB}h à 16{NB}h.</p>
            <a href="tel:{PHONE_TEL}">{PHONE}</a>
          </div>
          <div>
            <h3>Par texto</h3>
            <p>Réponse rapide pendant nos heures d'ouverture.</p>
            <a href="sms:{PHONE_TEL}">Envoyer un texto</a>
          </div>
          <div>
            <h3>Par courriel</h3>
            <p>Pour les demandes particulières et les questions.</p>
            <a href="mailto:{EMAIL}">{EMAIL}</a>
          </div>
        </div>

        <p class="form-note" style="margin-top: 32px;">
          En réservant, vous acceptez notre
          <a href="politique.html">politique de rendez-vous, annulation et retard</a>.
        </p>
      </div>
    </section>"""


# ---------------------------------------------------------------------------
# ASSEMBLAGE
# ---------------------------------------------------------------------------

# Doit correspondre à square.bookingUrl dans js/config.js. Utilisé uniquement
# comme repli statique (href écrit dans le HTML) si JavaScript est désactivé.
BOOKING_URL = ("https://book.squareup.com/appointments/"
               "11ede6168f2fd6ccb800ac1f6bbbcc9c/location/LJVHDT6T6W3XM/services")

PAGES = [
    dict(filename="index.html",
         title="Salon chien & chat | BOPOIL Toilettage & Boutique",
         description="BOPOIL Toilettage & Boutique à Gatineau : salon professionnel pour "
                     "toilettage chien, chat et lapin. Soins doux, produits premium et "
                     "réservation en ligne.",
         body=INDEX_BODY,
         og_image="hero-printemps-1600.jpg"),

    dict(filename="a-propos.html",
         title="À propos | BOPOIL Toilettage & Boutique",
         description="Salon de toilettage et boutique dans le quartier Touraine à Gatineau "
                     "depuis 2022. Un espace calme, propre et à aire ouverte, pensé pour le "
                     "confort de vos animaux.",
         body=APROPOS_BODY,
         og_image="boutique-interieur-1600.jpg"),

    dict(filename="nos-services.html",
         title="Notre approche | BOPOIL Toilettage & Boutique",
         description="Bien-être, respect, passion, écoute, transparence et rigueur : "
                     "l'approche de BOPOIL pour le toilettage des chiens, des chats et des "
                     "petits animaux à Gatineau.",
         body=APPROCHE_BODY,
         og_image="approche-chat-chien-1600.jpg"),

    dict(filename="chiens.html",
         title="Services pour chiens | BOPOIL Toilettage & Boutique",
         description="Toilettage complet, traitement de la mue, toilettage de base, brossage "
                     "et taille de griffes pour chiens de toutes tailles à Gatineau. Tarifs "
                     "clairs, réservation en ligne.",
         body=CHIENS_BODY,
         og_image="banniere-chiens-1600.jpg"),

    dict(filename="chats.html",
         title="Services pour chats | BOPOIL Toilettage & Boutique",
         description="Toilettage pour chats à Gatineau : shampooing sec sans rinçage, "
                     "brossage et démêlage, pose de cache-griffes et taille de griffes, dans "
                     "un environnement calme.",
         body=CHATS_BODY,
         og_image="banniere-chats-1600.jpg"),

    dict(filename="petits-animaux.html",
         title="Petits animaux | BOPOIL Toilettage & Boutique",
         description="Nouveauté en Outaouais : toilettage pour lapins, furets et autres "
                     "petits animaux de compagnie à Gatineau. Brossage, griffes et soins "
                     "adaptés.",
         body=PETITS_BODY,
         og_image="lapin-900.jpg"),

    dict(filename="guide.html",
         title="Votre guide toilettage | BOPOIL Toilettage & Boutique",
         description="Notre tarification est basée sur le type de poil plutôt que sur la "
                     "race ou le poids. Six catégories, la fréquence recommandée et des "
                     "exemples de races.",
         body=GUIDE_BODY,
         og_image="banniere-guide-1600.jpg"),

    dict(filename="politique.html",
         title="Notre politique | BOPOIL Toilettage & Boutique",
         description="Politique de rendez-vous, d'annulation et de retard de BOPOIL "
                     "Toilettage & Boutique, à Gatineau.",
         body=POLITIQUE_BODY,
         og_image="banniere-politique-1600.jpg"),

    dict(filename="rendez-vous.html",
         title="Prendre rendez-vous | BOPOIL Toilettage & Boutique",
         description="Réservez en ligne votre rendez-vous de toilettage chez BOPOIL à "
                     "Gatineau, ou joignez-nous par téléphone, texto ou courriel.",
         body=RDV_BODY.replace("{BOOKING_URL}", BOOKING_URL),
         og_image="galerie-fond-corgi-1600.jpg"),

    dict(filename="contactez-nous.html",
         title="Nous contacter | BOPOIL Toilettage & Boutique",
         description="38 Av Gatineau, Gatineau (Québec) J8T 4J1. Téléphone (819) 968-2827, "
                     "info@bopoil.ca. Formulaire de contact, carte et heures d'ouverture.",
         body=CONTACT_BODY,
         og_image="banniere-contact-1600.jpg"),

    dict(filename="fiche-informations.html",
         title="Fiche d'informations | BOPOIL Toilettage & Boutique",
         description="Fiche d'informations client BOPOIL : santé, comportement, taille et "
                     "préférences de votre animal, afin d'adapter les soins offerts.",
         body=FICHE_BODY,
         og_image="chiots-endormis-1600.jpg"),
]

# Anciennes adresses de l'ancien site Square Online → nouvelles pages.
REDIRECTS = {
    "home.html": "index.html",
    "contact.html": "contactez-nous.html",
    "services.html": "nos-services.html",
    "fichedinformations.html": "fiche-informations.html",
}


def write_redirects():
    for old, new in REDIRECTS.items():
        html = f"""<!DOCTYPE html>
<html lang="fr-CA">
<head>
  <meta charset="utf-8">
  <title>Redirection…</title>
  <link rel="canonical" href="{SITE_URL}/{new}">
  <meta http-equiv="refresh" content="0; url={new}">
  <meta name="robots" content="noindex">
</head>
<body>
  <p>Cette page a déménagé. <a href="{new}">Continuer vers la nouvelle page</a>.</p>
  <script>location.replace('{new}');</script>
</body>
</html>
"""
        with open(os.path.join(ROOT, old), "w", encoding="utf-8") as fh:
            fh.write(html)


def write_sitemap():
    urls = []
    for p in PAGES:
        loc = f"{SITE_URL}/" if p["filename"] == "index.html" else f"{SITE_URL}/{p['filename']}"
        priority = "1.0" if p["filename"] == "index.html" else "0.8"
        urls.append(f"  <url><loc>{loc}</loc><priority>{priority}</priority></url>")
    xml = ('<?xml version="1.0" encoding="UTF-8"?>\n'
           '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
           + "\n".join(urls) + "\n</urlset>\n")
    with open(os.path.join(ROOT, "sitemap.xml"), "w", encoding="utf-8") as fh:
        fh.write(xml)

    with open(os.path.join(ROOT, "robots.txt"), "w", encoding="utf-8") as fh:
        fh.write(f"User-agent: *\nAllow: /\n\nSitemap: {SITE_URL}/sitemap.xml\n")


def main():
    written = [page(**p) for p in PAGES]
    write_redirects()
    write_sitemap()
    print(f"{len(written)} pages générées :")
    for name in written:
        print("  ", name)
    print(f"{len(REDIRECTS)} redirections, sitemap.xml et robots.txt mis à jour.")


if __name__ == "__main__":
    main()
