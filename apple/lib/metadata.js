const api = require("./api");
const { EDITABLE_STATES, stateOf } = require("./version");

// Champs qui vont dans l'App Info. Tous les autres vont dans la version.
const APP_INFO_FIELDS = [
  "name",
  "subtitle",
  "privacyPolicyUrl",
  "privacyChoicesUrl",
];

/** Met à jour (PATCH) ou crée (POST) une localisation par langue. */
async function upsertLocalizations({
  listUrl,
  type,
  parentRel,
  parentType,
  parentId,
  wanted,
}) {
  const { data } = await api.get(listUrl, { params: { limit: 200 } });
  const existing = new Map(data.data.map((l) => [l.attributes.locale, l]));

  for (const [locale, attributes] of Object.entries(wanted)) {
    const loc = existing.get(locale);
    if (loc) {
      await api.patch(`/${type}/${loc.id}`, {
        data: { type, id: loc.id, attributes },
      });
      console.log(`  ✅ ${locale} mis à jour`);
    } else {
      await api.post(`/${type}`, {
        data: {
          type,
          attributes: { locale, ...attributes },
          relationships: {
            [parentRel]: { data: { type: parentType, id: parentId } },
          },
        },
      });
      console.log(`  ➕ ${locale} créé`);
    }
  }
}

/** Applique le contenu du fichier JSON à l'app et à la version. */
async function updateMetadata(appId, version, metadata) {
  // Répartir les champs de chaque langue entre App Info et version
  const appInfoWanted = {};
  const versionWanted = {};
  for (const [locale, fields] of Object.entries(metadata.locales || {})) {
    for (const [key, value] of Object.entries(fields)) {
      const target = APP_INFO_FIELDS.includes(key)
        ? appInfoWanted
        : versionWanted;
      (target[locale] ??= {})[key] = value;
    }
  }

  if (Object.keys(appInfoWanted).length) {
    console.log("\nApp Info (nom, sous-titre, confidentialité)...");
    const { data } = await api.get(`/apps/${appId}/appInfos`);
    const info = data.data.find((i) => EDITABLE_STATES.has(stateOf(i)));
    if (!info) throw new Error("Aucune App Info modifiable trouvée.");

    await upsertLocalizations({
      listUrl: `/appInfos/${info.id}/appInfoLocalizations`,
      type: "appInfoLocalizations",
      parentRel: "appInfo",
      parentType: "appInfos",
      parentId: info.id,
      wanted: appInfoWanted,
    });
  }

  if (Object.keys(versionWanted).length) {
    console.log(
      "\nTextes de la version (description, mots-clés, nouveautés...)...",
    );
    await upsertLocalizations({
      listUrl: `/appStoreVersions/${version.id}/appStoreVersionLocalizations`,
      type: "appStoreVersionLocalizations",
      parentRel: "appStoreVersion",
      parentType: "appStoreVersions",
      parentId: version.id,
      wanted: versionWanted,
    });
  }

  if (metadata.copyright) {
    console.log("\nCopyright...");
    await api.patch(`/appStoreVersions/${version.id}`, {
      data: {
        type: "appStoreVersions",
        id: version.id,
        attributes: { copyright: metadata.copyright },
      },
    });
    console.log("  ✅ mis à jour");
  }
}

module.exports = { updateMetadata };
