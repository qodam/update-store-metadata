// fetch.js — récupère la fiche Google Play existante d'une app
// Génère un JSON au même format que metadata.json (details + locales)
// et, si tu veux, télécharge les images dans <dossier>/<langue>/<phone|tablet7|tablet10|feature|icon>/
//
// Lancement : node fetch.js   (depuis n'importe où, les chemins sont relatifs au dossier google/)

const fs = require("fs");
const path = require("path");
const readline = require("readline/promises");
const { getPublisher, errorMessage } = require("./lib/api");

// Type d'image Google Play → nom du sous-dossier (inverse de lib/images.js)
const IMAGE_FOLDERS = {
  phoneScreenshots: "phone",
  sevenInchScreenshots: "tablet7",
  tenInchScreenshots: "tablet10",
  featureGraphic: "feature",
  icon: "icon",
};

// Pose une question. Entrée = valeur par défaut, "-" = ignorer.
async function ask(rl, question, defaultValue = "") {
  const hint = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${hint} : `)).trim();
  if (answer === "-") return "";
  return answer || defaultValue;
}

const extensionFor = (contentType = "") =>
  contentType.includes("jpeg") || contentType.includes("jpg") ? ".jpg" : ".png";

async function downloadImage(url, fileWithoutExt) {
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  const file = fileWithoutExt + extensionFor(res.headers.get("content-type"));
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
  return file;
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const packageName = await ask(rl, "Nom du package (ex: com.example.monapp)");
  const outputAnswer = await ask(
    rl,
    "Fichier JSON à créer",
    "./metadata-from-store.json",
  );
  const imagesAnswer = await ask(
    rl,
    "Dossier où télécharger les images (- pour ignorer)",
    "./screenshots-from-store",
  );
  rl.close();

  if (!/^[a-zA-Z]\w*(\.[a-zA-Z]\w*)+$/.test(packageName)) {
    throw new Error("Nom de package invalide (ex: com.example.monapp).");
  }

  const outputPath = path.resolve(__dirname, outputAnswer);
  const imagesDir = imagesAnswer && path.resolve(__dirname, imagesAnswer);

  if (fs.existsSync(outputPath)) {
    throw new Error(
      `Le fichier existe déjà, choisis un autre nom : ${outputPath}`,
    );
  }

  const publisher = getPublisher();

  // Une édition sert juste à LIRE : elle est supprimée à la fin, rien n'est modifié sur le store
  const { data: edit } = await publisher.edits.insert({ packageName });
  const editId = edit.id;

  try {
    console.log("\nFiche store...");

    const { data: details } = await publisher.edits.details.get({
      packageName,
      editId,
    });
    const { data: listingsData } = await publisher.edits.listings.list({
      packageName,
      editId,
    });
    const listings = listingsData.listings ?? [];

    const result = {
      details: {
        contactEmail: details.contactEmail ?? "",
        contactWebsite: details.contactWebsite ?? "",
      },
      locales: {},
    };

    for (const listing of listings) {
      result.locales[listing.language] = {
        title: listing.title ?? "",
        shortDescription: listing.shortDescription ?? "",
        fullDescription: listing.fullDescription ?? "",
      };
      console.log(`  📝 ${listing.language}`);
    }

    fs.mkdirSync(path.dirname(outputPath), { recursive: true });
    fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
    console.log(
      `\n✅ ${listings.length} langue(s) enregistrée(s) dans ${outputPath}`,
    );

    if (imagesDir) {
      console.log("\nImages...");
      let total = 0;

      for (const listing of listings) {
        const language = listing.language;

        for (const [imageType, folder] of Object.entries(IMAGE_FOLDERS)) {
          const { data } = await publisher.edits.images.list({
            packageName,
            editId,
            language,
            imageType,
          });
          const images = data.images ?? [];
          if (!images.length) continue;

          const dir = path.join(imagesDir, language, folder);
          fs.mkdirSync(dir, { recursive: true });

          for (const [index, image] of images.entries()) {
            await downloadImage(image.url, path.join(dir, String(index + 1)));
            total++;
          }
          console.log(
            `  🖼️  ${language} / ${folder} (${images.length} image(s))`,
          );
        }
      }

      console.log(`\n✅ ${total} image(s) téléchargée(s) dans ${imagesDir}`);
    }
  } finally {
    // On jette l'édition : aucune modification n'est publiée
    await publisher.edits.delete({ packageName, editId }).catch(() => {});
  }

  console.log("\n🎉 Terminé");
}

main().catch((err) => {
  console.error("\n❌ Erreur :");
  console.error(errorMessage(err));
  process.exitCode = 1;
});
