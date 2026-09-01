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

    // Lien principal vers la page de réservation Square.
    bookingUrl: 'https://book.squareup.com/appointments/cxp2nq7jmuh54t/location/LJVHDT6T6W3XM/services',

    // Liens directs par catégorie de service (facultatif).
    // Laissez la valeur nulle pour utiliser bookingUrl.
    categories: {
      chiens: null,
      chats: null,
      petitsAnimaux: null
    },

    // Boutique en ligne Square (catalogue de produits).
    shopUrl: 'https://bopoil.square.site/'
  },

  /* ----------------------------------------------------------------------
     2. COAT & CARE CRM (activation volontaire)
     ----------------------------------------------------------------------
     La fiche d'informations conserve exactement la même apparence. Une fois
     l'adresse approuvée, placez ici le point d'entrée public de Coat & Care.
     Tant que intakeUrl est vide, le formulaire garde son fonctionnement
     Formspree/courriel actuel et aucune donnée n'est envoyée au CRM.
     ---------------------------------------------------------------------- */
  coatCare: {
    intakeUrl: '/api/public/intake',
    salonSlug: 'bopoil',
    locationSlug: 'gatineau'
  },

  /* ----------------------------------------------------------------------
     3. FORMULAIRES (Formspree)
     ----------------------------------------------------------------------
     Créez un compte gratuit sur https://formspree.io, créez un formulaire
     par usage, puis collez l'identifiant (ex. « xbjnqlpz ») ci-dessous.
     Tant que la valeur commence par « VOTRE_ », le site affiche un message
     d'erreur clair au lieu d'envoyer dans le vide.
     ---------------------------------------------------------------------- */
  formspree: {
    contact:    'VOTRE_ID_FORMSPREE_CONTACT',
    intake:     'VOTRE_ID_FORMSPREE_FICHE',
    newsletter: 'VOTRE_ID_FORMSPREE_INFOLETTRE'
  },

  /* ----------------------------------------------------------------------
     4. COORDONNÉES
     ---------------------------------------------------------------------- */
  contact: {
    phone: '+18199682827',
    phoneDisplay: '(819) 968-2827',
    email: 'info@bopoil.ca',
    instagram: 'https://www.instagram.com/bopoil.toilettageboutique/',
    facebook: 'https://www.facebook.com/share/19BA9jkFU2/',
    tiktok: 'https://www.tiktok.com/@bopoil1'
  },

  /* ----------------------------------------------------------------------
     5. FIL INSTAGRAM (facultatif)
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
