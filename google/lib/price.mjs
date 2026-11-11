import path from "node:path";
import { createRequire } from "node:module";
import readline from "node:readline/promises";
import { google } from "googleapis";
import XLSX from "xlsx";

const require = createRequire(import.meta.url);
const CONFIG = require.resolve("../../config/config");
const { KEY_FILE: KEY_REL } = require(CONFIG);
// chemin relatif au dossier google/, comme indiqué dans config.js
const KEY_FILE = path.resolve(path.dirname(CONFIG), KEY_REL);
// versions des régions Google Play, de la plus récente à la plus ancienne
const REGIONS_VERSIONS = ["2026/01", "2025/03", "2022/02"];
const APPLY = process.argv.includes("--apply");
const EXPORT = process.argv.includes("--export");

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const PACKAGE = (
  await rl.question("Nom du package (ex : com.example.monapp) : ")
).trim();
const PRODUCT_ID = (await rl.question("ID produit de l'abonnement : ")).trim();
const BASE_PLAN_ID = (
  await rl.question("ID du forfait de base (base plan) : ")
).trim();
// --export : on écrit les prix actuels dans un Excel ; sinon on lit l'Excel à appliquer
const EXCEL = (
  await rl.question(
    EXPORT
      ? "Fichier Excel de sortie [prix-google.xlsx] : "
      : "Chemin du fichier Excel : ",
  )
)
  .trim()
  .replace(/^['"]|['"]$/g, "")
  .replace(/\\ /g, " ");
rl.close();

const auth = new google.auth.GoogleAuth({
  keyFile: KEY_FILE,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});
const play = google.androidpublisher({ version: "v3", auth });

const toMoney = (currencyCode, value) => {
  const units = Math.floor(value);
  return {
    currencyCode,
    units: String(units),
    nanos: Math.round((value - units) * 1e9),
  };
};
const fromMoney = (m) => Number(m.units ?? 0) + (m.nanos ?? 0) / 1e9;

const rows = EXPORT
  ? []
  : XLSX.utils
      .sheet_to_json(XLSX.readFile(EXCEL).Sheets["Prix par pays"])
      .filter((r) => r.Code && r.Prix);

if (!EXPORT)
  console.log(
    APPLY
      ? "\nMODE RÉEL : les prix vont être changés\n"
      : "\nESSAI À BLANC : rien ne sera changé\n",
  );

const { data: sub } = await play.monetization.subscriptions.get({
  packageName: PACKAGE,
  productId: PRODUCT_ID,
});
const plan = sub.basePlans?.find((b) => b.basePlanId === BASE_PLAN_ID);
if (!plan)
  throw new Error(
    `Forfait de base "${BASE_PLAN_ID}" introuvable dans "${PRODUCT_ID}"`,
  );

// Mode --export : on écrit les prix actuels dans un Excel et on s'arrête
if (EXPORT) {
  const out = EXCEL || "prix-google.xlsx";
  const names = new Intl.DisplayNames(["fr"], { type: "region" });
  const countryName = (c) => {
    try {
      return names.of(c);
    } catch {
      return c;
    }
  };
  const data = (plan.regionalConfigs ?? [])
    .filter((c) => c.price)
    .sort((a, b) => a.regionCode.localeCompare(b.regionCode))
    .map((c) => ({
      Pays: countryName(c.regionCode),
      Code: c.regionCode,
      Devise: c.price.currencyCode,
      Prix: fromMoney(c.price),
    }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    XLSX.utils.json_to_sheet(data),
    "Prix par pays",
  );
  XLSX.writeFile(wb, out);
  console.log(`✅ ${data.length} pays exportés → ${out}`);
  process.exit(0);
}

const configs = Object.fromEntries(
  (plan.regionalConfigs ?? []).map((c) => [c.regionCode, c]),
);
let changed = 0;
for (const r of rows) {
  const code = String(r.Code).trim();
  const target = Number(r.Prix);
  const cfg = configs[code];
  if (!cfg) {
    console.log(`⚠️  ${r.Pays} (${code}) : pays absent du forfait, ignoré`);
    continue;
  }
  if (r.Devise && cfg.price.currencyCode !== r.Devise) {
    console.log(
      `⚠️  ${r.Pays} : devise ${cfg.price.currencyCode} ≠ ${r.Devise} dans l'Excel, ignoré`,
    );
    continue;
  }
  const now = fromMoney(cfg.price);
  if (Math.abs(now - target) < 0.005) {
    console.log(`=  ${r.Pays} : déjà à ${now}`);
    continue;
  }
  console.log(`→  ${r.Pays} : ${now} → ${target} ${cfg.price.currencyCode}`);
  cfg.price = toMoney(cfg.price.currencyCode, target);
  changed++;
}

if (APPLY && changed) {
  let done = false;
  for (const version of REGIONS_VERSIONS) {
    try {
      await play.monetization.subscriptions.patch({
        packageName: PACKAGE,
        productId: PRODUCT_ID,
        updateMask: "basePlans",
        "regionsVersion.version": version,
        requestBody: sub,
      });
      console.log(`\n✅ Envoyé (régions ${version})`);
      done = true;
      break;
    } catch (e) {
      const msg = e.response?.data?.error?.message ?? e.message;
      // mauvaise version de régions : on essaie la suivante
      if (/regions version|Invalid currency|regionsVersion/i.test(msg)) {
        console.log(`  version ${version} refusée : ${msg}`);
        continue;
      }
      throw new Error(msg); // autre erreur : on arrête, sans le pavé de logs
    }
  }
  if (!done) {
    console.log(
      "\n❌ Aucune version de régions acceptée, rien n'a été changé.",
    );
    process.exit(1);
  }
}
console.log(`\n${changed} pays ${APPLY ? "modifiés" : "à modifier"}.`);
