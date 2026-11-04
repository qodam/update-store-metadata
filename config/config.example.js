// Copie ce fichier en config/config.js puis remplis les valeurs.
// config/config.js est ignoré par git : tes clés ne partent pas sur le dépôt.
//
// Conseil : mets des chemins ABSOLUS pour les clés. Les scripts ne résolvent
// pas tous les chemins relatifs depuis le même dossier (voir README).

module.exports = {
  // ─── Google Play ───
  // Clé JSON du compte de service (Google Cloud > IAM > Comptes de service)
  KEY_FILE: "/chemin/absolu/vers/service-account.json",
  // false : changements enregistrés dans la Play Console, sans envoi en examen
  // true  : envoyés en examen (à combiner avec la « Publication gérée »)
  SEND_FOR_REVIEW: false,

  // ─── App Store Connect ───
  // App Store Connect > Utilisateurs et accès > Intégrations > Clés API
  ISSUER_ID: "xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx",
  KEY_ID: "XXXXXXXXXX",
  PRIVATE_KEY_PATH: "/chemin/absolu/vers/AuthKey_XXXXXXXXXX.p8",
};
