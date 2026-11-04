const api = require("./api");

// États dans lesquels les métadonnées sont modifiables
const EDITABLE_STATES = new Set([
  "PREPARE_FOR_SUBMISSION",
  "DEVELOPER_REJECTED",
  "REJECTED",
  "METADATA_REJECTED",
  "INVALID_BINARY",
]);

// Apple a renommé les champs d'état : on lit le nouveau puis l'ancien
const stateOf = (e) =>
  e.attributes.appVersionState ||
  e.attributes.state ||
  e.attributes.appStoreState;

/** Retourne la version demandée (la crée si besoin) et vérifie qu'elle est modifiable. */
async function getEditableVersion(appId, versionString) {
  const { data } = await api.get(`/apps/${appId}/appStoreVersions`, {
    params: { "filter[platform]": "IOS", limit: 20 },
  });
  const versions = data.data;
  const version = versions.find(
    (v) => v.attributes.versionString === versionString,
  );

  if (version) {
    const state = stateOf(version);
    if (!EDITABLE_STATES.has(state)) {
      throw new Error(
        `La version ${versionString} est en état ${state} : non modifiable.`,
      );
    }
    console.log(`🎯 Version ${versionString} trouvée (${state})`);
    return version;
  }

  const other = versions.find((v) => EDITABLE_STATES.has(stateOf(v)));
  if (other) {
    throw new Error(
      `La version ${other.attributes.versionString} est déjà en préparation. ` +
        `Renomme-la en ${versionString} dans App Store Connect.`,
    );
  }

  console.log(`➕ Création de la version ${versionString}...`);
  const { data: created } = await api.post("/appStoreVersions", {
    data: {
      type: "appStoreVersions",
      attributes: { platform: "IOS", versionString },
      relationships: { app: { data: { type: "apps", id: appId } } },
    },
  });
  return created.data;
}

module.exports = { getEditableVersion, EDITABLE_STATES, stateOf };
