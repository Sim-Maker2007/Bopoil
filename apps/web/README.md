# BOPOIL Toilettage & Boutique — site web

Site statique (HTML / CSS / JavaScript, sans dépendance ni étape de compilation)
pour **BOPOIL Toilettage & Boutique**, 38 Av Gatineau, Gatineau (Québec) J8T 4J1.

Refonte complète de l'ancien site Square Online, avec intégration de la
réservation en ligne **Square Appointments**.

---

## Mise en ligne

Le site est déployé sur Vercel avec le CRM Coat & Care, à partir du dépôt
complet : au moment du `npm run build`, le script
`scripts/sync-public-site.mjs` copie ce dossier tel quel dans
`apps/coat-care/public/`. Les en-têtes de cache, les redirections des
anciennes adresses (`home.html`, `contact.html`, `services.html`,
`fichedinformations.html`) et les en-têtes de sécurité sont définis dans
`apps/coat-care/next.config.ts`.

Le dossier reste du HTML statique pur : il peut aussi être copié tel quel sur
n'importe quel hébergement statique pour un aperçu.

### Prévisualiser sur votre ordinateur

```bash
git clone https://github.com/Sim-Maker2007/Bopoil.git
cd Bopoil/apps/web
python3 -m http.server 8000
```

Puis ouvrez <http://localhost:8000>.

### Prévisualiser sur votre téléphone (même réseau Wi-Fi)

Le serveur ci-dessus écoute déjà sur tout le réseau local. Il suffit de
trouver l'adresse IP de l'ordinateur et de l'ouvrir depuis le téléphone.

```bash
# macOS
ipconfig getifaddr en0

# Linux
hostname -I

# Windows (PowerShell)
ipconfig | Select-String IPv4
```

L'adresse ressemble à `192.168.1.42`. Sur le téléphone, connecté au **même
Wi-Fi**, ouvrez `http://192.168.1.42:8000`.

> Au premier lancement, macOS ou Windows peut demander d'autoriser Python à
> accepter les connexions entrantes : acceptez, sinon le téléphone ne pourra
> pas joindre l'ordinateur.

---

## À configurer avant la mise en ligne

Tout se trouve dans **`js/config.js`**.

### 1. Réservation Square Appointments

```js
square: {
  bookingUrl: 'https://book.squareup.com/appointments/…/location/…/services',
}
```

Le lien inscrit par défaut a été **reconstruit** à partir des identifiants
trouvés dans l'ancien site Square Online :

| | |
|---|---|
| Identifiant du site de réservation | `cxp2nq7jmuh54t` |
| Identifiant du commerce (location) | `LJVHDT6T6W3XM` |

⚠️ **Il n'a pas pu être vérifié automatiquement.** Récupérez le lien exact dans
votre tableau de bord Square (*Rendez-vous → Site de réservation en ligne →
Partager le lien*) et collez-le dans `bookingUrl`.

La page `rendez-vous.html` tente d'afficher la réservation directement dans le
site, à l'intérieur d'un cadre. Si Square refuse l'affichage en cadre — c'est
possible et hors de notre contrôle —, un message et un bouton « Ouvrir la
réservation Square » apparaissent automatiquement après quelques secondes. Le
lien direct est de toute façon toujours visible sous le module.

Vous pouvez aussi renseigner des liens de réservation par catégorie :

```js
categories: {
  chiens: 'https://…',
  chats:  'https://…',
  petitsAnimaux: 'https://…'
}
```

### 2. Coat & Care CRM

Les trois formulaires du site parlent au CRM, sans changer leur apparence :

| Formulaire | Point d'entrée | Ce que fait le CRM |
|---|---|---|
| Fiche d'informations | `intakeUrl` (`/api/public/intake`) | Crée ou met à jour le client, l'animal, son profil de soins et ses consentements. Une fiche dont le nom, le courriel ou le téléphone diffère d'un dossier existant est marquée « à réviser » plutôt qu'écrasée. |
| Contact | `contactUrl` (`/api/public/contact`) | Transmet le message par courriel au salon (Resend), avec le visiteur en réponse. Le message n'est pas conservé. |
| Infolettre | `newsletterUrl` (`/api/public/newsletter`) | Crée ou met à jour le client avec son consentement marketing et une preuve de consentement datée. |

Les adresses et les identifiants du salon sont dans `js/config.js` sous
`coatCare`. Laissez une adresse vide pour désactiver le CRM pour ce formulaire.
Chaque formulaire contient un champ piège invisible pour les robots.

### 3. Formulaires — repli

Si un point d'entrée CRM est vide ou que le service ne répond pas, le site
essaie [Formspree](https://formspree.io) (identifiants dans `js/config.js`
sous `formspree`), puis ouvre le client courriel du visiteur avec le message
prérempli. Tant qu'un identifiant Formspree commence par `VOTRE_`, il est
ignoré.

### 4. Coordonnées, avis Google et mesure d'audience

Téléphone, courriel et réseaux sociaux sont dans `js/config.js`. Les mêmes
valeurs sont écrites en dur dans les pages (afin de fonctionner sans
JavaScript) — voir la section suivante pour les modifier partout d'un coup.

- `contact.googleReviewUrl` : collez le lien « Demander des avis » de la fiche
  d'établissement Google; un lien « Laisser un avis Google » apparaît alors
  dans le pied de page.
- `analytics.plausibleDomain` ou `analytics.gtagId` : aucun script n'est
  chargé tant que rien n'est renseigné. Une fois configuré, les clics
  « Réserver » (vers Square) et les envois de formulaire sont comptés comme
  événements.

---

## Modifier le contenu

Les pages `.html` à la racine sont **générées** par `tools/build.py`, qui
centralise l'en-tête, le pied de page, la navigation, les heures d'ouverture et
le texte de chaque page.

```bash
python3 tools/build.py
```

Modifiez les données dans `tools/build.py`, relancez la commande, et les 11
pages sont régénérées de façon cohérente. Les fichiers `.html` produits sont
versionnés dans le dépôt : le script n'est jamais nécessaire pour *déployer*,
seulement pour *modifier*.

> Si vous préférez éditer directement un fichier `.html`, c'est possible — mais
> pensez à reporter la modification dans `tools/build.py`, sinon la prochaine
> exécution du script l'écrasera.

Le générateur écrit aussi les données structurées schema.org de chaque page
(salon, fil d'Ariane, services avec fourchette de prix, FAQ du guide), le
plan de site avec les dates de modification et le fichier `robots.txt`.

### Images

Déposez les photos en JPEG dans `images/` en deux largeurs (`-800` et `-1600`,
ou `-480` et `-900` pour les vignettes de services), puis générez les
variantes WebP et les vignettes de grille :

```bash
node tools/optimize-images.mjs   # utilise « sharp », installé par npm install à la racine
python3 tools/build.py
```

Le générateur lit les dimensions dans chaque fichier et n'utilise que les
variantes présentes : sans WebP, il émet un simple `<img>`.

### Heures d'ouverture

Une seule source de vérité : la constante `HOURS` dans `tools/build.py`. Elle
alimente la carte de la page d'accueil, la page contact et les données
structurées JSON-LD.

L'ancien site se contredisait (accueil : lundi et samedi « sur rendez-vous » ;
page contact : lundi 9-16 et samedi 9-14). **Version retenue : celle de la carte
de l'accueil.**

---

## Structure

```
index.html                page d'accueil — carrousel, témoignage, heures, Instagram
a-propos.html             histoire du salon
nos-services.html         notre approche
chiens.html               5 services + galerie
chats.html                5 services + galerie
petits-animaux.html       3 services
guide.html                guide toilettage — 6 catégories de poil
politique.html            politique de rendez-vous, annulation et retard
rendez-vous.html          réservation Square Appointments
contactez-nous.html       formulaire, carte, coordonnées, heures
fiche-informations.html   fiche client (nouveau ou mise à jour)
liens.html                page cachée « Nos liens » (code QR), hors plan de site

css/tokens.css            jetons de design extraits de l'ancien site
css/style.css             mise en page et composants
js/config.js              ⚙️ configuration — Square, CRM, coordonnées, mesure d'audience
js/main.js                carrousel, navigation, formulaires, repli réservation
images/                   photos JPEG + WebP en plusieurs largeurs (srcset) + logo
tools/build.py            générateur de pages, données structurées, sitemap, robots
tools/optimize-images.mjs variantes WebP et vignettes 400 px
```

---

## Design

Repris de l'ancien site, à l'identique :

- **Playfair Display** 400 pour tous les titres, **Libre Franklin** 400 pour le
  reste (Google Fonts).
- Noir `#000000` (en-tête, pied de page, cartes), prune `#b14f7e` (uniquement
  la carte des heures et l'en-tête contact), crème `#F2EDE3` (bandeaux
  galerie), gris clair `#f6f7f9` (listes de services).
- Boutons à coins arrondis 8 px, images 16 px, cartes de contenu à angles
  droits.
- La **carte noire en chevauchement** — accueil (heures) et notre approche —
  est le geste signature de la mise en page.
- Voile noir sur chaque bannière photo (opacité 0,35 à 0,5) pour la lisibilité
  du texte blanc.

Ajouts par rapport à l'ancien site : textes alternatifs sur toutes les images,
étiquettes visibles sur les champs de formulaire, lien d'évitement, gestion du
clavier et de `prefers-reduced-motion`, données structurées JSON-LD, balises
Open Graph sur toutes les pages, et images servies en deux largeurs.

---

## Ce qui n'a pas été repris

- **Les vidéos Cloudflare Stream** de l'ancien site (diapositive « chats » et
  bloc vidéo de la page approche) ne sont pas téléchargeables. Les images fixes
  correspondantes sont utilisées à la place. Pour les rétablir, hébergez les
  fichiers et ajoutez une balise `<video>` dans la diapositive concernée.
- **Le catalogue Square** (boutique en ligne) n'est pas intégré ; `shopUrl`
  dans `js/config.js` permet d'y renvoyer.
- **Le fil Instagram** est représenté par trois photos du salon qui pointent
  vers le compte. Un widget de fil en direct peut être ajouté au besoin.
- Les textes de démonstration Square laissés sur l'ancien site (copie de salon
  de coiffure, « Artisanat de qualité », « View products », message de
  confirmation d'infolettre) ont été supprimés.
- La diapositive « Réservations en ligne en pause » a été remplacée par une
  diapositive d'accueil, la réservation en ligne étant désormais active.
