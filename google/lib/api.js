const fs = require("fs");
const path = require("path");
const { google } = require("googleapis");
const { KEY_FILE, SEND_FOR_REVIEW } = require("../../config/config");

const errorMessage = (err) => err.response?.data?.error?.message || err.message;

function getPublisher() {
  const keyFile = path.resolve(__dirname, "..", KEY_FILE);
  if (!fs.existsSync(keyFile))
    throw new Error(`Clé du compte de service introuvable : ${keyFile}`);

  const auth = new google.auth.GoogleAuth({
    keyFile,
    scopes: ["https://www.googleapis.com/auth/androidpublisher"],
  });
  return google.androidpublisher({ version: "v3", auth });
}

/**
 * Ouvre une édition, exécute fn(editId), puis la valide.
 * En cas d'erreur, l'édition est supprimée : rien n'est publié à moitié.
 */
async function withEdit(publisher, packageName, fn) {
  const { data } = await publisher.edits.insert({ packageName });
  const editId = data.id;
  console.log(`📝 Édition ouverte (${editId})`);

  try {
    await fn(editId);
  } catch (err) {
    await publisher.edits.delete({ packageName, editId }).catch(() => {});
    console.log("\n↩️  Édition annulée, rien n'a été modifié");
    throw err;
  }

  const commit = (notSent) =>
    publisher.edits.commit({
      packageName,
      editId,
      ...(notSent && { changesNotSentForReview: true }),
    });

  try {
    try {
      await commit(!SEND_FOR_REVIEW);
    } catch (err) {
      const msg = errorMessage(err);

      // Google veut obligatoirement envoyer en examen pour cette app
      if (msg.includes("must not be set")) {
        throw new Error(
          "Google envoie automatiquement les changements de cette app en examen :\n" +
            "il refuse de les enregistrer sans examen.\n\n" +
            "Pour garder la main sur la mise en ligne :\n" +
            "  1. Play Console > Vue d'ensemble de la publication > active « Publication gérée »\n" +
            "  2. Dans config/config.js, mets SEND_FOR_REVIEW: true\n" +
            "  3. Relance : Google examinera les changements, mais rien ne sera en ligne\n" +
            "     tant que tu n'auras pas cliqué sur « Publier » dans la Play Console.",
        );
      }

      // Google refuse l'envoi automatique : on enregistre sans examen
      if (!SEND_FOR_REVIEW || !msg.includes("changesNotSentForReview"))
        throw err;
      await commit(true);
      console.log(
        "\n💾 Enregistré sans examen (Google refuse l'envoi automatique pour cette app).",
      );
      console.log(
        "   Envoie les changements depuis Play Console > Vue d'ensemble de la publication.",
      );
      return;
    }
  } catch (err) {
    console.error(
      "\nDétail Google :",
      JSON.stringify(err.response?.data, null, 2),
    );
    await publisher.edits.delete({ packageName, editId }).catch(() => {});
    throw new Error(
      `${errorMessage(err)}\n\nRien n'a été modifié sur ta fiche.`,
    );
  }

  if (SEND_FOR_REVIEW) {
    console.log("\n🚀 Modifications envoyées à Google pour examen.");
    console.log(
      "   Avec la publication gérée, elles attendront ton clic sur « Publier ».",
    );
  } else {
    console.log(
      "\n💾 Modifications enregistrées dans la Play Console, PAS envoyées en examen.",
    );
    console.log(
      "   Pour les publier : Play Console > Vue d'ensemble de la publication.",
    );
  }
}

module.exports = { getPublisher, withEdit, errorMessage };
