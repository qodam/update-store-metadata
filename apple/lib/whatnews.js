const fs = require("fs");
const readline = require("readline/promises");
const api = require("./api");
const { getEditableVersion } = require("./version");

// Limite Apple pour le champ "Nouveautés"
const MAX_LENGTH = 4000;

// Pose une question. Entrée = valeur par défaut.
async function ask(rl, question, defaultValue = "") {
  const hint = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${hint} : `))
    .trim()
    .replace(/^["']|["']$/g, "");
  return answer || defaultValue;
}

/**
 * Lit le fichier de nouveautés. Trois formes acceptées :
 *
 *   { "fr-FR": "texte", "en-US": "texte" }          ← le plus simple
 *   { "*": "texte" }                                 ← même texte pour toutes
 *   { "locales": { "fr-FR": { "whatsNew": "..." } } } ← ton metadata.json
 */
function readWhatsNew(filePath) {
  const raw = JSON.parse(fs.readFileSync(filePath, "utf8"));
  const source = raw.locales ?? raw;
  const wanted = {};

  for (const [locale, value] of Object.entries(source)) {
    const text = typeof value === "string" ? value : value?.whatsNew;
    if (typeof text !== "string" || !text.trim()) continue;

    if (text.length > MAX_LENGTH) {
      throw new Error(
        `${locale} : ${text.length} caractères, le maximum Apple est ${MAX_LENGTH}.`,
      );
    }
    wanted[locale] = text;
  }

  if (!Object.keys(wanted).length) {
    throw new Error(`Aucun texte de nouveautés trouvé dans ${filePath}.`);
  }
  return wanted;
}

/** Applique les nouveautés aux localisations existantes de la version. */
async function updateWhatsNew(versionId, wanted) {
  const { data } = await api.get(
    `/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
    { params: { limit: 200 } },
  );
  const existing = new Map(data.data.map((l) => [l.attributes.locale, l]));

  // "*" : on applique le même texte à toutes les langues déjà présentes.
  const resolved = {};
  if (wanted["*"]) {
    for (const locale of existing.keys()) resolved[locale] = wanted["*"];
  }
  for (const [locale, text] of Object.entries(wanted)) {
    if (locale !== "*") resolved[locale] = text;
  }

  const missing = Object.keys(resolved).filter((l) => !existing.has(l));
  if (missing.length) {
    // On ne crée pas de localisation ici : Apple exige la description et les
    // mots-clés à la création. Passe par index.js pour ajouter une langue.
    throw new Error(
      `Ces langues n'existent pas encore sur cette version : ${missing.join(", ")}.\n` +
        `   Crée-les d'abord (index.js ou App Store Connect), puis relance.`,
    );
  }

  console.log("");
  for (const [locale, whatsNew] of Object.entries(resolved)) {
    await api.patch(
      `/appStoreVersionLocalizations/${existing.get(locale).id}`,
      {
        data: {
          type: "appStoreVersionLocalizations",
          id: existing.get(locale).id,
          attributes: { whatsNew },
        },
      },
    );
    console.log(`  ✅ ${locale}`);
  }

  const untouched = [...existing.keys()].filter((l) => !(l in resolved));
  if (untouched.length) {
    console.log(`\n⚠️  Non modifiées : ${untouched.join(", ")}`);
  }

  return Object.keys(resolved).length;
}

async function main() {
  // Usage direct : node whatsnew.js <appId> <version> [fichier] [--yes]
  const args = process.argv.slice(2).filter((a) => a !== "--yes");
  const autoConfirm = process.argv.includes("--yes");

  let appId = args[0];
  let versionString = args[1];
  let filePath = args[2] || "./whatsnew.json";

  // Une seule interface readline, ouverte à la demande et fermée à la fin.
  let rl = null;
  const prompt = (question, defaultValue) => {
    rl ??= readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    return ask(rl, question, defaultValue);
  };

  try {
    if (!appId || !versionString) {
      appId = await prompt("App ID (Apple ID numérique)", appId);
      versionString = await prompt(
        "Version à modifier (ex: 1.3.06)",
        versionString,
      );
      filePath = await prompt("Fichier JSON des nouveautés", filePath);
    }

    if (!/^\d+$/.test(appId || "")) {
      throw new Error("L'App ID doit être un nombre.");
    }
    if (!versionString) throw new Error("La version est obligatoire.");
    if (!fs.existsSync(filePath)) {
      throw new Error(`Fichier introuvable : ${filePath}`);
    }

    const wanted = readWhatsNew(filePath);

    // Aperçu avant d'écrire sur le store.
    console.log("\n📄 À publier :");
    for (const [locale, text] of Object.entries(wanted)) {
      const firstLine = text.split("\n")[0];
      const preview = firstLine.slice(0, 60);
      const suffix = text.length > preview.length ? "…" : "";
      console.log(`  ${locale.padEnd(8)} ${preview}${suffix}`);
    }

    if (!autoConfirm) {
      const confirm = await prompt("\nConfirmer ? (o/N)", "n");
      if (!/^(o|oui|y|yes)$/i.test(confirm)) {
        console.log("Annulé.");
        return;
      }
    }

    console.log("");
    const version = await getEditableVersion(appId, versionString);
    const count = await updateWhatsNew(version.id, wanted);

    console.log(`\n🎉 Nouveautés mises à jour (${count} langue(s))`);
  } finally {
    rl?.close();
  }
}

main().catch((err) => {
  console.error("\n❌ Erreur :");
  // err.response?.data = réponse d'Apple (objet), sinon notre propre message
  const appleError = err.response?.data;
  if (appleError) console.dir(appleError, { depth: null });
  else console.error(err.message);
  process.exitCode = 1;
});
