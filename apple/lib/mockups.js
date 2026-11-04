const fs = require("fs");
const path = require("path");
const readline = require("readline");

// Langue du store -> langue des mockups
const LANGUES = {
  "en-US": "en",
  "en-GB": "en",
  vi: "en",
  "fr-FR": "fr",
  "fr-CA": "fr",
  "es-ES": "es",
  "es-MX": "es",
  "de-DE": "de",
  it: "it",
  "pt-BR": "pt",
  "pt-PT": "pt",
  ru: "ru",
  "zh-Hans": "zh",
  "zh-Hant": "zh",
  ja: "ja",
  ko: "ko",
  "ar-SA": "ar",
};

const APPAREILS = ["iphone", "ipad"];

// Nettoie un chemin collé ou glissé dans le terminal (guillemets, espaces)
const nettoyer = (chemin) => chemin.trim().replace(/^["']|["']$/g, "");

// Lecture ligne par ligne (fonctionne au clavier comme avec une entrée collée)
function creerLecteur() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const lignes = [];
  const attentes = [];
  rl.on("line", (ligne) => {
    const attente = attentes.shift();
    attente ? attente(ligne) : lignes.push(ligne);
  });
  rl.on("close", () => attentes.splice(0).forEach((a) => a("")));

  return {
    demander(question, defaut) {
      process.stdout.write(`${question} [${defaut}] : `);
      return new Promise((resolve) => {
        const repondre = (ligne) => resolve(nettoyer(ligne) || defaut);
        lignes.length ? repondre(lignes.shift()) : attentes.push(repondre);
      });
    },
    fermer: () => rl.close(),
  };
}

async function main() {
  const lecteur = creerLecteur();

  console.log("Laisse vide pour garder la valeur entre crochets.\n");

  const sources = {
    iphone: await lecteur.demander(
      "Dossier des mockups iPhone",
      "../mockups/iphone",
    ),
    ipad: await lecteur.demander("Dossier des mockups iPad", "../mockups/ipad"),
  };
  const destination = await lecteur.demander(
    "Dossier de destination",
    "../screenshots",
  );

  lecteur.fermer();
  console.log("\n");

  let dossiers = 0;
  let images = 0;
  const manquants = [];

  for (const [langueStore, langueMockup] of Object.entries(LANGUES)) {
    for (const appareil of APPAREILS) {
      // 1. Création du dossier
      const dossierDest = path.join(destination, langueStore, appareil);
      if (!fs.existsSync(dossierDest)) dossiers++;
      fs.mkdirSync(dossierDest, { recursive: true });

      // 2. Copie des images
      const dossierSource = path.join(sources[appareil], langueMockup);
      if (!fs.existsSync(dossierSource)) {
        manquants.push(dossierSource);
        continue;
      }

      const fichiers = fs
        .readdirSync(dossierSource)
        .filter((f) => /\.(png|jpe?g)$/i.test(f))
        .sort();

      for (const fichier of fichiers) {
        fs.copyFileSync(
          path.join(dossierSource, fichier),
          path.join(dossierDest, fichier),
        );
        images++;
      }

      console.log(
        `✓ ${langueStore}/${appareil} ← ${langueMockup} (${fichiers.length} images)`,
      );
    }
  }

  console.log(`\n${dossiers} dossier(s) créé(s), ${images} image(s) copiée(s)`);
  console.log(`Destination : ${path.resolve(destination)}`);

  const uniques = [...new Set(manquants)];
  if (uniques.length) {
    console.log(`\n⚠ Dossiers de mockups introuvables :`);
    uniques.forEach((d) => console.log(`  - ${path.resolve(d)}`));
  }
}

main().catch((err) => {
  console.error("Erreur :", err.message);
  process.exit(1);
});
