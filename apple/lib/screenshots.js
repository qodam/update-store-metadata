const axios = require("axios");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { imageSize } = require("image-size");
const api = require("./api");

// Nom du sous-dossier → type d'écran Apple
const DISPLAY_TYPES = {
  iphone: "APP_IPHONE_65", // iPhone 6.5"
  ipad: "APP_IPAD_PRO_3GEN_129", // iPad 13"
};

// Tailles acceptées (portrait ; le paysage est accepté aussi)
const ACCEPTED_SIZES = {
  APP_IPHONE_67: [
    [1320, 2868],
    [1290, 2796],
    [1260, 2736],
  ],
  APP_IPHONE_65: [
    [1284, 2778],
    [1242, 2688],
  ],
  APP_IPAD_PRO_3GEN_129: [
    [2064, 2752],
    [2048, 2732],
  ],
};

const MAX_PER_SET = 10;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => path.join(dir, f));
}

function checkDimensions(filePath, displayType) {
  const accepted = ACCEPTED_SIZES[displayType];
  if (!accepted) return null;
  const { width, height } = imageSize(fs.readFileSync(filePath));
  const ok = accepted.some(
    ([w, h]) => (width === w && height === h) || (width === h && height === w),
  );
  if (ok) return null;
  const list = accepted.map(([w, h]) => `${w}x${h}`).join(", ");
  return `${filePath} → ${width}x${height} (attendu : ${list})`;
}

async function getOrCreateSet(localizationId, displayType) {
  const { data } = await api.get(
    `/appStoreVersionLocalizations/${localizationId}/appScreenshotSets`,
    {
      params: { limit: 50 },
    },
  );
  const existing = data.data.find(
    (s) => s.attributes.screenshotDisplayType === displayType,
  );
  if (existing) return existing;

  const { data: created } = await api.post("/appScreenshotSets", {
    data: {
      type: "appScreenshotSets",
      attributes: { screenshotDisplayType: displayType },
      relationships: {
        appStoreVersionLocalization: {
          data: { type: "appStoreVersionLocalizations", id: localizationId },
        },
      },
    },
  });
  return created.data;
}

async function clearSet(setId) {
  const { data } = await api.get(`/appScreenshotSets/${setId}/appScreenshots`, {
    params: { limit: 50 },
  });
  for (const shot of data.data) await api.delete(`/appScreenshots/${shot.id}`);
  if (data.data.length)
    console.log(`    🗑️  ${data.data.length} ancienne(s) supprimée(s)`);
}

async function uploadOne(setId, filePath) {
  const buffer = fs.readFileSync(filePath);
  const fileName = path.basename(filePath);

  // 1. Réserver l'emplacement
  const { data: reserved } = await api.post("/appScreenshots", {
    data: {
      type: "appScreenshots",
      attributes: { fileName, fileSize: buffer.length },
      relationships: {
        appScreenshotSet: { data: { type: "appScreenshotSets", id: setId } },
      },
    },
  });
  const shot = reserved.data;

  // 2. Envoyer le fichier (axios brut : PAS le token Apple ici)
  for (const op of shot.attributes.uploadOperations) {
    await axios({
      method: op.method,
      url: op.url,
      headers: Object.fromEntries(
        (op.requestHeaders || []).map((h) => [h.name, h.value]),
      ),
      data: buffer.subarray(op.offset, op.offset + op.length),
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
    });
  }

  // 3. Confirmer avec le checksum MD5
  await api.patch(`/appScreenshots/${shot.id}`, {
    data: {
      type: "appScreenshots",
      id: shot.id,
      attributes: {
        uploaded: true,
        sourceFileChecksum: crypto
          .createHash("md5")
          .update(buffer)
          .digest("hex"),
      },
    },
  });

  // 4. Attendre le traitement Apple
  for (let i = 0; i < 30; i++) {
    const { data } = await api.get(`/appScreenshots/${shot.id}`);
    const delivery = data.data.attributes.assetDeliveryState;
    if (delivery?.state === "COMPLETE") {
      console.log(`    ✅ ${fileName}`);
      return shot.id;
    }
    if (delivery?.state === "FAILED") {
      const reasons = (delivery.errors || [])
        .map((e) => e.description)
        .join(" | ");
      throw new Error(
        `${fileName} refusée par Apple : ${reasons || "raison inconnue"}`,
      );
    }
    await sleep(2000);
  }
  console.log(`    ⏳ ${fileName} envoyée, traitement encore en cours`);
  return shot.id;
}

/** Envoie les captures de dir/<langue>/<iphone|ipad>/ sur la version. */
async function uploadScreenshots(versionId, dir) {
  console.log(`\nCaptures d'écran depuis ${dir}...`);

  const { data } = await api.get(
    `/appStoreVersions/${versionId}/appStoreVersionLocalizations`,
    {
      params: { limit: 200 },
    },
  );

  // 1. Tout vérifier avant de toucher à App Store Connect
  const jobs = [];
  const problems = [];
  for (const localization of data.data) {
    const locale = localization.attributes.locale;
    for (const [folder, displayType] of Object.entries(DISPLAY_TYPES)) {
      const files = listImages(path.join(dir, locale, folder));
      if (!files.length) continue;
      if (files.length > MAX_PER_SET)
        problems.push(
          `${locale}/${folder} : ${files.length} images (max ${MAX_PER_SET})`,
        );
      for (const file of files) {
        const issue = checkDimensions(file, displayType);
        if (issue) problems.push(issue);
      }
      jobs.push({ locale, localization, folder, displayType, files });
    }
  }

  if (!jobs.length) {
    console.log(
      "  ⚠️  Aucune image trouvée (attendu : <dossier>/<langue>/iphone et /ipad)",
    );
    return;
  }
  if (problems.length) {
    throw new Error(
      `Captures invalides, rien n'a été envoyé :\n  - ${problems.join("\n  - ")}`,
    );
  }

  // 2. Envoi
  for (const { locale, localization, folder, displayType, files } of jobs) {
    console.log(`  📱 ${locale} / ${folder} (${files.length} image(s))`);
    const set = await getOrCreateSet(localization.id, displayType);
    await clearSet(set.id);

    const ids = [];
    for (const file of files) ids.push(await uploadOne(set.id, file));

    // Ordre d'affichage = ordre des noms de fichiers
    await api.patch(
      `/appScreenshotSets/${set.id}/relationships/appScreenshots`,
      {
        data: ids.map((id) => ({ type: "appScreenshots", id })),
      },
    );
  }
}

module.exports = { uploadScreenshots };
