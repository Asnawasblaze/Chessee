// Texture pass for the two landing-page GLBs.
//
// Why this exists rather than `gltf-transform optimize --texture-compress webp`:
// that path drives sharp through a pipeline that trips a libvips error on this
// machine ("colourspace: parameter space not set"), so the whole optimize run
// aborts. Calling sharp directly works fine, so the texture step is done here
// and geometry compression is left to the CLI afterwards. Run `npm run
// optimize:models` to do both in the right order.
//
// Usage: node scripts/optimize-models.mjs <input.glb> <output.glb> [maxSize] [normalQuality]
import { NodeIO } from "@gltf-transform/core";
import { ALL_EXTENSIONS } from "@gltf-transform/extensions";
import sharp from "sharp";

const [, , inputPath, outputPath, maxSizeRaw, normalQualityRaw] = process.argv;
if (!inputPath || !outputPath) {
  console.error(
    "Usage: node scripts/optimize-models.mjs <input.glb> <output.glb> [maxSize] [normalQuality]"
  );
  process.exit(1);
}
const maxSize = Number(maxSizeRaw ?? 1024);
/* Normals get their own knob because they dominate the pawn's payload and the
   right value is a judgement call about visible faceting, not a constant.
   Pass 0 for near-lossless. */
const normalQuality = Number(normalQualityRaw ?? 88);

/* Quality per map type. A base colour map is photographic and tolerates lossy
   WebP well. A normal map does not: its channels are a vector, not a colour, so
   chroma-subsampled blocking shows up as visible faceting across smooth
   surfaces — hence the higher target here, and `nearLossless` available for the
   cases where even that is not enough. */
const ENCODE = {
  baseColor: { quality: 82, nearLossless: false },
  normal: {
    quality: normalQuality || 92,
    nearLossless: normalQuality === 0,
  },
  other: { quality: 85, nearLossless: false },
};

const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
const doc = await io.read(inputPath);
const root = doc.getRoot();

/* Map each texture to the slot it fills, so the encoder can pick a profile.
   Walking materials rather than using listTextureSlots keeps this working when
   a texture is shared between two materials. */
const slotOf = new Map();
for (const material of root.listMaterials()) {
  const base = material.getBaseColorTexture();
  if (base) slotOf.set(base, "baseColor");
  const normal = material.getNormalTexture();
  if (normal) slotOf.set(normal, "normal");
}

let before = 0;
let after = 0;

for (const texture of root.listTextures()) {
  const image = texture.getImage();
  if (!image) continue;

  const slot = slotOf.get(texture) ?? "other";
  const profile = ENCODE[slot];
  const meta = await sharp(image).metadata();

  before += image.byteLength;

  /* `withoutEnlargement` so a map that is already under the cap is re-encoded
     but never upscaled. `fit: "inside"` preserves aspect for non-square maps. */
  const encoded = await sharp(image)
    .resize(maxSize, maxSize, { fit: "inside", withoutEnlargement: true })
    .webp({ quality: profile.quality, nearLossless: profile.nearLossless })
    .toBuffer();

  texture.setImage(encoded);
  texture.setMimeType("image/webp");
  after += encoded.byteLength;

  const outMeta = await sharp(encoded).metadata();
  console.log(
    `  ${slot.padEnd(9)} ${meta.width}x${meta.height} -> ${outMeta.width}x${outMeta.height}  ` +
      `${(image.byteLength / 1024).toFixed(1)} KB -> ${(encoded.byteLength / 1024).toFixed(1)} KB`
  );
}

await io.write(outputPath, doc);

const saved = before - after;
console.log(
  `  textures ${(before / 1024).toFixed(1)} KB -> ${(after / 1024).toFixed(1)} KB ` +
    `(saved ${(saved / 1024).toFixed(1)} KB)`
);
