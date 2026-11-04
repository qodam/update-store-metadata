const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const readline = require("readline/promises");

const { ISSUER_ID, KEY_ID, PRIVATE_KEY_PATH } = require("../config/config");

const API = "https://api.appstoreconnect.apple.com";

// Type d'écran Apple → sous-dossier, par ordre de préférence (le plus grand d'abord)
const SCREENSHOT_TYPES = {
  iphone: [
    "APP_IPHONE_67",
    "APP_IPHONE_65",
    "APP_IPHONE_61",
    "APP_IPHONE_58",
    "APP_IPHONE_55",
    "APP_IPHONE_47",
    "APP_IPHONE_40",
    "APP_IPHONE_35",
  ],
  ipad: [
    "APP_IPAD_PRO_3GEN_129",
    "APP_IPAD_PRO_129",
    "APP_IPAD_PRO_3GEN_11",
    "APP_IPAD_105",
    "APP_IPAD_97",
  ],
};

// Versions déjà publiées (ce qui est visible sur le store)
const LIVE_STATES = ["READY_FOR_SALE", "READY_FOR_DISTRIBUTION"];

// Pose une question. Entrée = valeur par défaut, "-" = ignorer.
async function ask(rl, question, defaultValue = "") {
  const hint = defaultValue ? ` [${defaultValue}]` : "";
  const answer = (await rl.question(`${question}${hint} : `))
    .trim()
    .replace(/^["']|["']$/g, "");
  if (answer === "-") return "";
  return answer || defaultValue;
}

// ─── Authentification (JWT ES256) ───
function createTokenProvider(issuerId, keyId, privateKey) {
  const b64url = (input) => Buffer.from(input).toString("base64url");
  let token = null;
  let expiresAt = 0;

  return () => {
    const now = Math.floor(Date.now() / 1000);
    if (token && now < expiresAt - 60) return token;

    const header = b64url(
      JSON.stringify({ alg: "ES256", kid: keyId, typ: "JWT" }),
    );
    const payload = b64url(
      JSON.stringify({
        iss: issuerId,
        iat: now,
        exp: now + 15 * 60,
        aud: "appstoreconnect-v1",
      }),
    );
    const signature = crypto
      .sign("sha256", Buffer.from(`${header}.${payload}`), {
        key: privateKey,
        dsaEncoding: "ieee-p1363",
      })
      .toString("base64url");

    token = `${header}.${payload}.${signature}`;
    expiresAt = now + 15 * 60;
    return token;
  };
}

function createClient(getToken) {
  async function get(url) {
    const res = await fetch(url.startsWith("http") ? url : API + url, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      const detail =
        body.errors?.map((e) => `${e.title} : ${e.detail}`).join("\n") ||
        res.statusText;
      throw new Error(
        `App Store Connect (${res.status}) sur ${url}\n${detail}`,
      );
    }
    return body;
  }

  // Suit la pagination et renvoie toutes les entrées
  async function getAll(url) {
    const items = [];
    let next = url;
    while (next) {
      const page = await get(next);
      items.push(...(page.data ?? []));
      next = page.links?.next;
    }
    return items;
  }

  return { get, getAll };
}

// ─── Choix de la version / des infos à lire ───
const versionState = (v) =>
  v.attributes.appVersionState ?? v.attributes.appStoreState;
const infoState = (i) => i.attributes.state ?? i.attributes.appStoreState;

function pickLiveOrLatest(items, getState) {
  return items.find((i) => LIVE_STATES.includes(getState(i))) ?? items[0];
}

async function downloadImage(url, file) {
  const res = await fetch(url);
  if (!res.ok)
    throw new Error(`Téléchargement impossible (${res.status}) : ${url}`);
  fs.writeFileSync(file, Buffer.from(await res.arrayBuffer()));
}

async function main() {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const issuerId = ISSUER_ID;
  const keyId = KEY_ID;
  const keyPath = PRIVATE_KEY_PATH;
  const bundleId = await ask(rl, "Bundle ID (ex: com.example.monapp)");
  const outputAnswer = await ask(
    rl,
    "Fichier JSON à créer",
    "./metadata-from-store.json",
  );
  const imagesAnswer = await ask(
    rl,
    "Dossier où télécharger les screenshots (- pour ignorer)",
    "./screenshots-from-store",
  );
  rl.close();

  if (!issuerId || !keyId || !keyPath)
    throw new Error("Issuer ID, Key ID et fichier .p8 sont obligatoires.");
  const ROOT = path.resolve(__dirname, "..");
  const keyFile = path.resolve(ROOT, keyPath);
  if (!fs.existsSync(keyFile))
    throw new Error(`Fichier .p8 introuvable : ${keyFile}`);
  if (!bundleId) throw new Error("Bundle ID obligatoire.");

  const outputPath = path.resolve(__dirname, outputAnswer);
  const imagesDir = imagesAnswer && path.resolve(__dirname, imagesAnswer);
  if (fs.existsSync(outputPath)) {
    throw new Error(
      `Le fichier existe déjà, choisis un autre nom : ${outputPath}`,
    );
  }

  const privateKey = crypto.createPrivateKey(fs.readFileSync(keyFile, "utf8"));
  const api = createClient(createTokenProvider(issuerId, keyId, privateKey));

  // 1. L'app
  const apps = await api.getAll(
    `/v1/apps?filter[bundleId]=${encodeURIComponent(bundleId)}`,
  );
  const app = apps.find((a) => a.attributes.bundleId === bundleId);
  if (!app) throw new Error(`Aucune app trouvée pour le bundle ID ${bundleId}`);
  console.log(`\n📱 ${app.attributes.name} (${app.id})`);

  // 2. Version iOS à lire : celle en ligne, sinon la plus récente
  const versions = await api.getAll(
    `/v1/apps/${app.id}/appStoreVersions?filter[platform]=IOS&limit=200`,
  );
  if (!versions.length) throw new Error("Aucune version iOS trouvée.");
  const version = pickLiveOrLatest(versions, versionState);
  console.log(
    `   Version ${version.attributes.versionString} (${versionState(version)})`,
  );

  // 3. Infos app (nom, sous-titre, confidentialité) : celles en ligne, sinon les plus récentes
  const infos = await api.getAll(`/v1/apps/${app.id}/appInfos`);
  const info = pickLiveOrLatest(infos, infoState);

  const [infoLocs, versionLocs] = await Promise.all([
    api.getAll(`/v1/appInfos/${info.id}/appInfoLocalizations?limit=200`),
    api.getAll(
      `/v1/appStoreVersions/${version.id}/appStoreVersionLocalizations?limit=200`,
    ),
  ]);

  // 4. Assemblage au format metadata
  const result = { copyright: version.attributes.copyright ?? "", locales: {} };
  const locales = [
    ...new Set([...infoLocs, ...versionLocs].map((l) => l.attributes.locale)),
  ];

  console.log("\nFiche store...");
  for (const locale of locales) {
    const i =
      infoLocs.find((l) => l.attributes.locale === locale)?.attributes ?? {};
    const v =
      versionLocs.find((l) => l.attributes.locale === locale)?.attributes ?? {};
    result.locales[locale] = {
      name: i.name ?? "",
      subtitle: i.subtitle ?? "",
      privacyPolicyUrl: i.privacyPolicyUrl ?? "",
      description: v.description ?? "",
      keywords: v.keywords ?? "",
      promotionalText: v.promotionalText ?? "",
      whatsNew: v.whatsNew ?? "",
      supportUrl: v.supportUrl ?? "",
      marketingUrl: v.marketingUrl ?? "",
    };
    console.log(`  📝 ${locale}`);
  }

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, JSON.stringify(result, null, 2) + "\n");
  console.log(
    `\n✅ ${locales.length} langue(s) enregistrée(s) dans ${outputPath}`,
  );

  // 5. Screenshots
  if (imagesDir) {
    console.log("\nScreenshots...");
    let total = 0;

    for (const loc of versionLocs) {
      const locale = loc.attributes.locale;
      const sets = await api.getAll(
        `/v1/appStoreVersionLocalizations/${loc.id}/appScreenshotSets?limit=200`,
      );

      for (const [folder, types] of Object.entries(SCREENSHOT_TYPES)) {
        // On garde le plus grand format disponible pour chaque appareil
        const set = types
          .map((t) =>
            sets.find((s) => s.attributes.screenshotDisplayType === t),
          )
          .find(Boolean);
        if (!set) continue;

        const shots = await api.getAll(
          `/v1/appScreenshotSets/${set.id}/appScreenshots?limit=200`,
        );
        const dir = path.join(imagesDir, locale, folder);
        fs.mkdirSync(dir, { recursive: true });

        let count = 0;
        for (const shot of shots) {
          const asset = shot.attributes.imageAsset;
          if (!asset?.templateUrl) continue; // image encore en cours de traitement chez Apple
          const url = asset.templateUrl
            .replace("{w}", asset.width)
            .replace("{h}", asset.height)
            .replace("{f}", "png");
          count++;
          await downloadImage(url, path.join(dir, `${count}.png`));
        }

        total += count;
        console.log(
          `  🖼️  ${locale} / ${folder} (${count} image(s), ${set.attributes.screenshotDisplayType})`,
        );
      }
    }

    console.log(`\n✅ ${total} screenshot(s) téléchargé(s) dans ${imagesDir}`);
  }

  console.log("\n🎉 Terminé");
}

main().catch((err) => {
  console.error("\n❌ Erreur :");
  console.error(err.message);
  process.exitCode = 1;
});
