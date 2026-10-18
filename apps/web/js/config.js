/* ==========================================================================
   BOPOIL — Configuration
   --------------------------------------------------------------------------
   TOUT CE QUI DOIT ÊTRE MODIFIÉ SE TROUVE DANS CE FICHIER.
   Everything that needs to be changed lives in this file.
   ========================================================================== */

window.BOPOIL_CONFIG = {

  /* ----------------------------------------------------------------------
     1. SQUARE APPOINTMENTS
     ----------------------------------------------------------------------
     Pour obtenir ces valeurs :
       Tableau de bord Square → Rendez-vous → Site de réservation en ligne
       → « Partager le lien ». Collez le lien complet dans bookingUrl.

     Lien vérifié (copié depuis Rendez-vous → Réservation en ligne → View
     du tableau de bord Square) :
       identifiant du site de réservation : cxp2nq7jmuh54t
       identifiant du commerce (location) : LJVHDT6T6W3XM
     ---------------------------------------------------------------------- */
  square: {
    bookingSiteId: 'cxp2nq7jmuh54t',
    locationId: 'LJVHDT6T6W3XM',

    // Coat & Care reconnaît le client, puis crée le rendez-vous dans Square.
    bookingUrl: '/book/bopoil/gatineau',
    embedBooking: false,

    // Liens directs par catégorie de service (facultatif).
    // Laissez la valeur nulle pour utiliser bookingUrl.
    categories: {
      chiens: null,
      chats: null,
      petitsAnimaux: null
    },

    // Boutique en ligne Square (catalogue de produits).
    shopUrl: 'https://bopoil.square.site/',

    // « Contactez-nous par texto » ouvre le formulaire « Text us » de Square,
    // comme sur l'ancien site Square Online : le message arrive dans Square
    // Messages (tableau de bord et appli Square) et la réponse part par texto.
    // Le module reçoit locationId et la source du site de réservation Square,
    // dont le bouton « Text us » est activé dans Messages → Paramètres.
    // Laissez script vide pour revenir au simple lien sms:.
    textUs: {
      script: 'https://conversations-production-f.squarecdn.com/v2/messages-plugin.js',
      source: 'APPOINTMENTS_BOOKING_SITE'
    }
  },

  /* ----------------------------------------------------------------------
     2. COAT & CARE CRM (activation volontaire)
     ----------------------------------------------------------------------
     La fiche d'informations conserve exactement la même apparence. Une fois
     l'adresse approuvée, placez ici le point d'entrée public de Coat & Care.
     Tant que intakeUrl est vide, le formulaire ouvre le client courriel du
     visiteur avec la fiche préremplie et aucune donnée n'est envoyée au CRM.
     ---------------------------------------------------------------------- */
  coatCare: {
    intakeUrl: '/api/public/intake',
    // Formulaire de contact : transmis par courriel au salon via le CRM
    // (Resend). Infolettre : crée ou met à jour la fiche client avec son
    // consentement marketing. Laissez vide pour revenir au courriel prérempli.
    contactUrl: '/api/public/contact',
    newsletterUrl: '/api/public/newsletter',
    salonSlug: 'bopoil',
    locationSlug: 'gatineau'
  },

  /* ----------------------------------------------------------------------
     3. COORDONNÉES
     ---------------------------------------------------------------------- */
  contact: {
    phone: '+18199682827',
    phoneDisplay: '(819) 968-2827',
    email: 'info@bopoil.ca',
    instagram: 'https://www.instagram.com/bopoil.toilettageboutique/',
    facebook: 'https://www.facebook.com/share/19BA9jkFU2/',
    tiktok: 'https://www.tiktok.com/@bopoil1',

    // Lien « Laisser un avis » de la fiche Google (Fiche d'établissement →
    // Demander des avis → copier le lien). Le lien du pied de page apparaît
    // dès qu'une valeur est renseignée.
    googleReviewUrl: ''
  },

  /* ----------------------------------------------------------------------
     3b. MESURE D'AUDIENCE (facultatif)
     ----------------------------------------------------------------------
     Aucun script n'est chargé tant que rien n'est renseigné. Renseignez UN
     des deux : le domaine Plausible (respectueux de la vie privée, sans
     bandeau de témoins) ou l'identifiant Google Analytics 4 (G-XXXXXXX).
     Les clics « Réserver » et les envois de formulaire sont comptés comme
     événements dans les deux cas.

     Loi 25 : Google Analytics dépose des témoins, donc il ne se charge
     qu'après l'accord du visiteur. Tant que gtagId est renseigné, un
     bandeau « Refuser / Accepter » le demande à la première visite, et le
     lien « Gérer les témoins » du pied de page permet de changer d'avis.
     Avec Plausible seul (gtagId vide), aucun bandeau n'apparaît.
     ---------------------------------------------------------------------- */
  analytics: {
    plausibleDomain: '',   // ex. 'bopoil.ca'
    gtagId: 'G-WP5LELX275' // Google Analytics 4
  },

  /* ----------------------------------------------------------------------
     4. FIL INSTAGRAM (facultatif)
     ----------------------------------------------------------------------
     Par défaut, l'accueil montre trois photos du salon avec un lien vers
     Instagram. Pour afficher le vrai fil en direct, créez un widget
     gratuit sur https://lightwidget.com (aucun compte Instagram Business
     requis, aucune clé d'API à obtenir) et collez l'URL de l'iframe
     ci-dessous. La grille est automatiquement remplacée par le fil réel.
     ---------------------------------------------------------------------- */
  instagram: {
    embedUrl: ''   // ex. 'https://cdn.lightwidget.com/widgets/xxxx.html'
  }
};
