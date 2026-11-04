const fs = require("fs");
const readline = require("readline/promises");
const { getEditableVersion } = require("./lib/version");
const { updateMetadata } = require("./lib/metadata");
const { uploadScreenshots } = require("./lib/screenshots");

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
  const appId = await ask(rl, "App ID (Apple ID numérique)");
  const versionString = await ask(rl, "Version à modifier (ex: 1.3.06)");
  const metadataPath = await ask(
    rl,
    "Fichier JSON des métadonnées (- pour ignorer)",
    "./metadata.json",
  );
  const screenshotsDir = await ask(
    rl,
    "Dossier des captures (- pour ignorer)",
    "./screenshots",
  );
  rl.close();

  if (!/^\d+$/.test(appId)) throw new Error("L'App ID doit être un nombre.");
  if (!versionString) throw new Error("La version est obligatoire.");
  if (metadataPath && !fs.existsSync(metadataPath))
    throw new Error(`Fichier introuvable : ${metadataPath}`);
  if (screenshotsDir && !fs.existsSync(screenshotsDir))
    throw new Error(`Dossier introuvable : ${screenshotsDir}`);

  console.log("");
  const version = await getEditableVersion(appId, versionString);

  if (metadataPath) {
    const metadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
    await updateMetadata(appId, version, metadata);
  }

  if (screenshotsDir) {
    await uploadScreenshots(version.id, screenshotsDir);
  }

  console.log("\n🎉 Terminé");
}

main().catch((err) => {
  console.error("\n❌ Erreur :");
  console.dir(err.response?.data || err.message, { depth: null });
  process.exitCode = 1;
});
