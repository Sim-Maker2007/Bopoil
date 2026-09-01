# BOPOIL Toilettage & Boutique — site web

Site statique (HTML / CSS / JavaScript, sans dépendance ni étape de compilation)
pour **BOPOIL Toilettage & Boutique**, 38 Av Gatineau, Gatineau (Québec) J8T 4J1.

Refonte complète de l'ancien site Square Online, avec intégration de la
réservation en ligne **Square Appointments**.

---

## Mise en ligne

Aucun outil n'est requis. Copiez le contenu du dépôt sur n'importe quel
hébergement statique — GitHub Pages, Netlify, Cloudflare Pages, ou un simple
serveur web.

### Prévisualiser sur votre ordinateur

```bash
git clone -b claude/website-redesign-square-tqt1jj \
  https://github.com/Sim-Maker2007/Bopoil.git
cd Bopoil
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

La fiche d'informations peut enregistrer directement les profils client et
animal dans Coat & Care sans modifier sa mise en page. Configurez l'adresse du
CRM et les identifiants du salon dans `js/config.js` sous `coatCare`. Tant que
`intakeUrl` est vide, aucune donnée n'est transmise au CRM. Les formulaires de
contact et d'infolettre restent indépendants.

### 3. Formulaires

Les formulaires (contact, fiche d'informations, infolettre) sont envoyés via
[Formspree](https://formspree.io) — offre gratuite suffisante pour ce volume.

1. Créez un compte, puis un formulaire par usage.
2. Copiez l'identifiant de chaque formulaire (par exemple `xbjnqlpz`).
3. Collez-les dans `js/config.js` :

```js
formspree: {
  contact:    'xbjnqlpz',
  intake:     '…',
  newsletter: '…'
}
```

Tant qu'une valeur commence par `VOTRE_`, le formulaire affiche un message
clair invitant à écrire à `info@bopoil.ca` plutôt que d'envoyer dans le vide.

### 4. Coordonnées

Téléphone, courriel et Instagram sont également dans `js/config.js`. Les
mêmes valeurs sont écrites en dur dans les pages (afin de fonctionner sans
JavaScript) — voir la section suivante pour les modifier partout d'un coup.

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

home.html, contact.html, services.html, fichedinformations.html
                          redirections depuis les anciennes adresses

css/tokens.css            jetons de design extraits de l'ancien site
css/style.css             mise en page et composants
js/config.js              ⚙️ configuration — Square, Formspree, coordonnées
js/main.js                carrousel, navigation, formulaires, repli réservation
images/                   photos en deux largeurs (srcset) + logo
tools/build.py            générateur de pages
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
