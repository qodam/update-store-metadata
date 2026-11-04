const fs = require("fs");
const path = require("path");
const { imageSize } = require("image-size");

// Nom du sous-dossier → type d'image Google Play
const IMAGE_TYPES = {
  phone: { type: "phoneScreenshots", max: 8 },
  tablet7: { type: "sevenInchScreenshots", max: 8 },
  tablet10: { type: "tenInchScreenshots", max: 8 },
  feature: { type: "featureGraphic", max: 1, size: [1024, 500] },
  icon: { type: "icon", max: 1, size: [512, 512] },
};

function listImages(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /\.(png|jpe?g)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
    .map((f) => path.join(dir, f));
}

/*function checkImage(file, rule) {
  const { width, height } = imageSize(fs.readFileSync(file));

  if (rule.size) {
    const [w, h] = rule.size;
    return width === w && height === h
      ? null
      : `${file} → ${width}x${height} (attendu : ${w}x${h})`;
  }

  const small = Math.min(width, height);
  const big = Math.max(width, height);
  if (small < 320 || big > 3840)
    return `${file} → ${width}x${height} (chaque côté entre 320 et 3840 px)`;
  if (big > small * 2)
    return `${file} → ${width}x${height} (le grand côté ne doit pas dépasser 2x le petit)`;
  return null;
}*/

function checkImage(file, rule) {
  const { width, height } = imageSize(fs.readFileSync(file));

  if (rule.size) {
    const [w, h] = rule.size;
    return width === w && height === h
      ? null
      : `${file} → ${width}x${height} (attendu : ${w}x${h})`;
  }

  const small = Math.min(width, height);
  const big = Math.max(width, height);
  if (small < 320 || big > 3840)
    return `${file} → ${width}x${height} (chaque côté entre 320 et 3840 px)`;
  return null;
}

/** Parcourt dir/<langue>/<phone|tablet7|tablet10|feature|icon>/ et vérifie tout. */
function collectImages(dir) {
  const jobs = [];
  const problems = [];

  for (const language of fs.readdirSync(dir)) {
    const languageDir = path.join(dir, language);
    if (!fs.statSync(languageDir).isDirectory()) continue;

    for (const [folder, rule] of Object.entries(IMAGE_TYPES)) {
      const files = listImages(path.join(languageDir, folder));
      if (!files.length) continue;

      if (files.length > rule.max) {
        problems.push(
          `${language}/${folder} : ${files.length} images (max ${rule.max})`,
        );
      }
      for (const file of files) {
        const issue = checkImage(file, rule);
        if (issue) problems.push(issue);
      }
      jobs.push({ language, folder, imageType: rule.type, files });
    }
  }

  if (problems.length) {
    throw new Error(
      `Images invalides, rien n'a été envoyé :\n  - ${problems.join("\n  - ")}`,
    );
  }
  return jobs;
}

/** Remplace les images de chaque type par celles du dossier, dans l'ordre des noms. */
async function uploadImages(publisher, packageName, editId, jobs) {
  for (const { language, folder, imageType, files } of jobs) {
    console.log(`  🖼️  ${language} / ${folder} (${files.length} image(s))`);
    await publisher.edits.images.deleteall({
      packageName,
      editId,
      language,
      imageType,
    });

    for (const file of files) {
      await publisher.edits.images.upload({
        packageName,
        editId,
        language,
        imageType,
        media: {
          mimeType: /\.png$/i.test(file) ? "image/png" : "image/jpeg",
          body: fs.createReadStream(file),
        },
      });
      console.log(`    ✅ ${path.basename(file)}`);
    }
  }
}

module.exports = { collectImages, uploadImages };
