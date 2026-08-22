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

     Le lien ci-dessous a été reconstruit à partir des identifiants trouvés
     dans l'ancien site Square Online :
       identifiant du site de réservation : 11ede6168f2fd6ccb800ac1f6bbbcc9c
       identifiant du commerce (location) : LJVHDT6T6W3XM
     VÉRIFIEZ-LE et remplacez-le au besoin par le lien exact de votre
     tableau de bord Square.
     ---------------------------------------------------------------------- */
  square: {
    bookingSiteId: '11ede6168f2fd6ccb800ac1f6bbbcc9c',
    locationId: 'LJVHDT6T6W3XM',

    // Lien principal vers la page de réservation Square.
    bookingUrl: 'https://book.squareup.com/appointments/11ede6168f2fd6ccb800ac1f6bbbcc9c/location/LJVHDT6T6W3XM/services',

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
     2. FORMULAIRES (Formspree)
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
     3. COORDONNÉES
     ---------------------------------------------------------------------- */
  contact: {
    phone: '+18199682827',
    phoneDisplay: '(819) 968-2827',
    email: 'info@bopoil.ca',
    instagram: 'https://www.instagram.com/bopoil.toilettageboutique/'
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
