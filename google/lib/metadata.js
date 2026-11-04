// Limites Google Play (en caractères)
const LIMITS = { title: 30, shortDescription: 80, fullDescription: 4000 };

/** Vérifie les longueurs avant d'envoyer quoi que ce soit. */
function checkMetadata(metadata) {
  const problems = [];
  for (const [language, fields] of Object.entries(metadata.locales || {})) {
    for (const [key, max] of Object.entries(LIMITS)) {
      const length = [...(fields[key] || "")].length;
      if (length > max)
        problems.push(`${language}.${key} : ${length} caractères (max ${max})`);
    }
  }
  if (problems.length) {
    throw new Error(`Métadonnées invalides :\n  - ${problems.join("\n  - ")}`);
  }
}

/** Met à jour les fiches store (par langue) et les coordonnées. */
async function updateMetadata(publisher, packageName, editId, metadata) {
  const { data } = await publisher.edits.listings.list({ packageName, editId });
  const existing = new Map((data.listings || []).map((l) => [l.language, l]));

  for (const [language, fields] of Object.entries(metadata.locales || {})) {
    // On part de la fiche actuelle : un champ absent du JSON garde sa valeur
    const current = existing.get(language) || {};
    await publisher.edits.listings.update({
      packageName,
      editId,
      language,
      requestBody: { ...current, ...fields, language },
    });
    console.log(`  ${existing.has(language) ? "✅" : "➕"} ${language}`);
  }

  // Coordonnées (email, site, téléphone) : communes à toutes les langues
  const details = Object.fromEntries(
    Object.entries(metadata.details || {}).filter(([, value]) => value),
  );
  if (Object.keys(details).length) {
    await publisher.edits.details.patch({
      packageName,
      editId,
      requestBody: details,
    });
    console.log("  ✅ Coordonnées mises à jour");
  }
}

module.exports = { checkMetadata, updateMetadata };
