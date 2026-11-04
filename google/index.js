const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { getPublisher, withEdit, errorMessage } = require("./lib/api");
const { checkMetadata, updateMetadata } = require("./lib/metadata");
const { collectImages, uploadImages } = require("./lib/images");

// Pose une question. Entrée = valeur par défaut, "-" = ignorer.
async function ask(rl, question, defaultValue = "") {
  const hint = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${hint} : `)).trim();
  if (answer === "-") return "";
  return answer || defaultValue;
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const packageName = await ask(rl, "Nom du package (ex: com.example.monapp)");
  const metadataAnswer = await ask(
    rl,
    "Fichier JSON des métadonnées (- pour ignorer)",
    "./metadata.json",
  );
  const imagesAnswer = await ask(
    rl,
    "Dossier des images (- pour ignorer)",
    "./screenshots",
  );
  rl.close();

  // Chemins relatifs au dossier google/, d'où qu'on lance la commande
  const metadataPath =
    metadataAnswer && path.resolve(__dirname, metadataAnswer);
  const imagesDir = imagesAnswer && path.resolve(__dirname, imagesAnswer);

  if (!/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(packageName)) {
    throw new Error("Nom de package invalide (ex: com.example.monapp).");
  }
  if (!metadataPath && !imagesDir)
    throw new Error("Rien à faire : JSON et images ignorés.");
  if (metadataPath && !metadataPath.toLowerCase().endsWith(".json")) {
    throw new Error(
      `Le fichier des métadonnées doit être un .json : ${metadataPath}`,
    );
  }
  if (metadataPath && !fs.existsSync(metadataPath))
    throw new Error(`Fichier introuvable : ${metadataPath}`);
  if (imagesDir && !fs.existsSync(imagesDir))
    throw new Error(`Dossier introuvable : ${imagesDir}`);

  // Tout vérifier AVANT d'ouvrir l'édition chez Google
  let metadata = null;
  if (metadataPath) {
    try {
      metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    } catch (e) {
      throw new Error(`JSON invalide dans ${metadataPath} : ${e.message}`);
    }
    checkMetadata(metadata);
  }

  const jobs = imagesDir ? collectImages(imagesDir) : [];
  if (imagesDir && !jobs.length) {
    console.log(
      "⚠️  Aucune image trouvée (attendu : <dossier>/<langue>/phone, tablet7, tablet10, feature, icon)",
    );
  }

  console.log("");
  const publisher = getPublisher();

  await withEdit(publisher, packageName, async (editId) => {
    if (metadata) {
      console.log("\nFiches store...");
      await updateMetadata(publisher, packageName, editId, metadata);
    }
    if (jobs.length) {
      console.log("\nImages...");
      await uploadImages(publisher, packageName, editId, jobs);
    }
  });

  console.log("\n🎉 Terminé");
}

main().catch((err) => {
  console.error("\n❌ Erreur :");
  console.error(errorMessage(err));
  process.exitCode = 1;
});
