// Build-time guard for the GLB assets under src/assets.
//
// optimize-models.mjs (WebP textures) and `gltf-transform optimize --compress
// meshopt` (geometry) are both developer-run, one-off commands — see
// `npm run optimize:models` — and nothing before this script connected either
// of them to the actual build. A contributor who swaps in a new or re-exported
// .glb without remembering to run that command ships an unprocessed asset
// straight to production: the pawn model went from 1.03 MB to 235 KB through
// that pipeline, and its metallicRoughness map alone was a 7.4 MB PNG before
// the texture pass stripped and re-encoded it (see ThinkingModel.tsx's own
// comment on both numbers).
//
// This runs as a `prebuild` script (see package.json — npm runs `prebuild`
// automatically before `build`, no change to the build command itself needed)
// and fails the build rather than warn, because a silently-shipped multi-MB
// model is exactly the kind of regression that is invisible until someone
// profiles the live page.
//
// Checks, per .glb found under src/assets:
//   1. EXT_meshopt_compression is present — the geometry pass was run.
//   2. Every texture is image/webp — the texture pass (optimize-models.mjs)
//      was run. A model with no textures at all (procedural-material only)
//      passes trivially.
//   3. The file itself is under a hard size ceiling, as a backstop for
//      anything the first two checks don't happen to catch — a model built
//      with a different exporter that already emits meshopt+webp by default
//      but at an unreasonable resolution, for instance.
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import { MeshoptDecoder } from "meshoptimizer";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ASSETS_DIR = path.join(__dirname, "..", "src", "assets");
/* Generous relative to the pawn's own 235 KB: this is a ceiling that catches
   a forgotten optimization pass, not a target this project is expected to sit
   near. */
const MAX_FILE_BYTES = 2 * 1024 * 1024;

/* A decoder has to be registered for NodeIO to read a meshopt-compressed file
   at all — without it, `io.read()` throws on the exact files this script
   exists to approve, rather than on the ones it exists to catch. This is the
   same registration the docs' own "Example — Read" uses; meshoptimizer is
   already in the tree as a transitive dependency of @gltf-transform/cli. */
await MeshoptDecoder.ready;
const io = new NodeIO()
  .registerExtensions(ALL_EXTENSIONS)
  .registerDependencies({ "meshopt.decoder": MeshoptDecoder });

async function checkModel(filePath) {
  const name = path.relative(ASSETS_DIR, filePath);
  const problems = [];

  const { size } = await stat(filePath);
  if (size > MAX_FILE_BYTES) {
    problems.push(
      `is ${(size / 1024).toFixed(1)} KB, over the ${(MAX_FILE_BYTES / 1024).toFixed(0)} KB ceiling`
    );
  }

  const doc = await io.read(filePath);
  const root = doc.getRoot();

  const usedExtensions = new Set(
    doc.getRoot().listExtensionsUsed().map((ext) => ext.extensionName)
  );
  if (!usedExtensions.has("EXT_meshopt_compression")) {
    problems.push(
      "has no EXT_meshopt_compression — geometry was not run through `npm run optimize:models`"
    );
  }

  for (const texture of root.listTextures()) {
    const mimeType = texture.getMimeType();
    if (mimeType && mimeType !== "image/webp") {
      const label = texture.getName() || texture.getURI() || "(unnamed)";
      problems.push(
        `texture "${label}" is ${mimeType}, not image/webp — texture pass was not run`
      );
    }
  }

  return { name, problems };
}

async function main() {
  let entries;
  try {
    entries = await readdir(ASSETS_DIR);
  } catch (error) {
    console.warn(`check-models: could not read ${ASSETS_DIR}, skipping.`, error);
    return;
  }

  const glbFiles = entries.filter((entry) => entry.toLowerCase().endsWith(".glb"));
  if (glbFiles.length === 0) return;

  const results = await Promise.all(
    glbFiles.map((entry) => checkModel(path.join(ASSETS_DIR, entry)))
  );

  const failures = results.filter((result) => result.problems.length > 0);
  if (failures.length === 0) {
    console.log(`check-models: ${glbFiles.length} GLB asset(s) OK.`);
    return;
  }

  console.error("check-models: unoptimized GLB asset(s) found:\n");
  for (const failure of failures) {
    console.error(`  ${failure.name}`);
    for (const problem of failure.problems) {
      console.error(`    - ${problem}`);
    }
  }
  console.error(
    "\nRun `npm run optimize:models` (adjust the input/output paths for the " +
      "file in question) before building, or update this script's ceiling if " +
      "the size increase is intentional."
  );
  process.exitCode = 1;
}

await main();
