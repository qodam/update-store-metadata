import fs from "node:fs";
import { createRequire } from "node:module";
import readline from "node:readline/promises";
import jwt from "jsonwebtoken";
import XLSX from "xlsx";

const require = createRequire(import.meta.url);
const { ISSUER_ID, KEY_ID, PRIVATE_KEY_PATH } = require("../../config/config");
const KEY_FILE = PRIVATE_KEY_PATH;

// Questions dans la console
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});
const SUBSCRIPTION_ID = (
  await rl.question("Apple ID de l'abonnement : ")
).trim();
const EXCEL = (await rl.question("Chemin du fichier Excel : "))
  .trim()
  .replace(/^['"]|['"]$/g, "") // enlève les guillemets
  .replace(/\\ /g, " "); // glisser-déposer sur Mac : "\ " → espace
rl.close();
const APPLY = process.argv.includes("--apply");
// changement de prix programmé pour demain (obligatoire une fois l'abonnement validé)
const START_DATE = new Date(Date.now() + 24 * 3600 * 1000)
  .toISOString()
  .slice(0, 10);
const API = "https://api.appstoreconnect.apple.com";

const key = fs.readFileSync(KEY_FILE, "utf8");
let token = null;
let tokenAt = 0;
function auth() {
  // jeton valable 20 min max : on le renouvelle toutes les 15 min
  if (!token || Date.now() - tokenAt > 15 * 60 * 1000) {
    const now = Math.floor(Date.now() / 1000);
    token = jwt.sign(
      // marge pour l'horloge du PC : créé 1 min dans le passé, valable 15 min
      {
        iss: ISSUER_ID,
        iat: now - 60,
        exp: now + 15 * 60,
        aud: "appstoreconnect-v1",
      },
      key,
      { algorithm: "ES256", header: { alg: "ES256", kid: KEY_ID, typ: "JWT" } },
    );
    tokenAt = Date.now();
  }
  return {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json",
  };
}

async function api(path, options = {}) {
  const url = path.startsWith("http") ? path : API + path;
  const res = await fetch(url, { ...options, headers: auth() });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

// Tous les paliers de prix Apple d'un pays (avec pagination)
async function pricePoints(territory) {
  const out = [];
  let next = `/v1/subscriptions/${SUBSCRIPTION_ID}/pricePoints?filter[territory]=${territory}&limit=200`;
  while (next) {
    const page = await api(next);
    for (const p of page.data)
      out.push({ id: p.id, price: parseFloat(p.attributes.customerPrice) });
    next = page.links?.next ?? null;
  }
  return out;
}

// Prix actuel de chaque pays
async function currentPrices() {
  const map = {};
  let next = `/v1/subscriptions/${SUBSCRIPTION_ID}/prices?include=territory,subscriptionPricePoint&limit=200`;
  while (next) {
    const page = await api(next);
    const points = Object.fromEntries(
      (page.included ?? [])
        .filter((i) => i.type === "subscriptionPricePoints")
        .map((i) => [i.id, parseFloat(i.attributes.customerPrice)]),
    );
    for (const p of page.data) {
      const terr = p.relationships.territory.data.id;
      const pp = p.relationships.subscriptionPricePoint.data.id;
      // le prix le plus récent l'emporte
      const start = p.attributes.startDate ?? "0000";
      if (!map[terr] || start >= map[terr].start)
        map[terr] = { price: points[pp], start };
    }
    next = page.links?.next ?? null;
  }
  return map;
}

const rows = XLSX.utils
  .sheet_to_json(XLSX.readFile(EXCEL).Sheets["Prix par pays"])
  .filter((r) => r.Code && r.Prix);

console.log(
  APPLY
    ? "MODE RÉEL : les prix vont être changés\n"
    : "ESSAI À BLANC : rien ne sera changé\n",
);

const current = await currentPrices();
let changed = 0;
for (const r of rows) {
  const terr = String(r.Code).trim();
  const target = Number(r.Prix);
  try {
    const points = await pricePoints(terr);
    if (!points.length) {
      console.log(`⚠️  ${r.Pays} (${terr}) : aucun palier trouvé, ignoré`);
      continue;
    }
    // palier Apple le plus proche du prix voulu
    const best = points.reduce((a, b) =>
      Math.abs(b.price - target) < Math.abs(a.price - target) ? b : a,
    );
    // devise différente de celle prévue : écart énorme, on ne touche pas
    if (Math.abs(best.price - target) / target > 0.25) {
      console.log(
        `⚠️  ${r.Pays} : demandé ${target}, palier le plus proche ${best.price} (autre devise ?), ignoré`,
      );
      continue;
    }
    const now = current[terr]?.price;
    if (now === best.price) {
      console.log(`=  ${r.Pays} : déjà à ${now}`);
      continue;
    }
    console.log(`→  ${r.Pays} : ${now ?? "?"} → ${best.price}`);
    if (APPLY) {
      await api("/v1/subscriptionPrices", {
        method: "POST",
        body: JSON.stringify({
          data: {
            type: "subscriptionPrices",
            attributes: { startDate: START_DATE, preserveCurrentPrice: false },
            relationships: {
              subscription: {
                data: { type: "subscriptions", id: SUBSCRIPTION_ID },
              },
              subscriptionPricePoint: {
                data: { type: "subscriptionPricePoints", id: best.id },
              },
              territory: { data: { type: "territories", id: terr } },
            },
          },
        }),
      });
    }
    changed++;
  } catch (e) {
    console.log(`❌ ${r.Pays} (${terr}) : ${e.message}`);
  }
}
console.log(`\n${changed} pays ${APPLY ? "modifiés" : "à modifier"}.`);
