const fs = require("fs");
const path = require("path");
const readline = require("readline");

// Langue du store Google Play -> langue des mockups
const LANGUES = {
  "en-US": "en",
  "en-GB": "en",
  "fr-FR": "fr",
  "fr-CA": "fr",
  "es-ES": "es",
  "es-419": "es",
  "es-US": "es",
  "de-DE": "de",
  "it-IT": "it",
  "pt-BR": "pt",
  "pt-PT": "pt",
  "ru-RU": "ru",
  "zh-CN": "zh",
  "zh-TW": "zh",
  "zh-HK": "zh",
  "ja-JP": "ja",
  "ko-KR": "ko",
  ar: "ar",
};

// parLangue: true  -> la source contient un dossier par langue (fr, en…)
// parLangue: false -> mêmes images pour toutes les langues (ex. l'icône)
const APPAREILS = {
  phone: {
    label: "Dossier des mockups téléphone",
    defaut: "../mockups/phone",
    parLangue: true,
  },
  tablet7: {
    label: 'Dossier des mockups tablette 7"',
    defaut: "../mockups/tablet7",
    parLangue: true,
  },
  tablet10: {
    label: 'Dossier des mockups tablette 10"',
    defaut: "../mockups/tablet10",
    parLangue: true,
  },
  feature: {
    label: "Dossier des feature graphics",
    defaut: "../mockups/feature",
    parLangue: true,
  },
  icon: {
    label: "Dossier de l'icône (commune à toutes les langues)",
    defaut: "../mockups/icon",
    parLangue: false,
  },
};

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

  const sources = {};
  for (const [appareil, { label, defaut }] of Object.entries(APPAREILS)) {
    sources[appareil] = await lecteur.demander(label, defaut);
  }
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
    for (const [appareil, { parLangue }] of Object.entries(APPAREILS)) {
      // 1. Création du dossier
      const dossierDest = path.join(destination, langueStore, appareil);
      if (!fs.existsSync(dossierDest)) dossiers++;
      fs.mkdirSync(dossierDest, { recursive: true });

      // 2. Copie des images
      const dossierSource = parLangue
        ? path.join(sources[appareil], langueMockup)
        : sources[appareil];
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
        `✓ ${langueStore}/${appareil} ← ${parLangue ? langueMockup : "commun"} (${fichiers.length} images)`,
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
