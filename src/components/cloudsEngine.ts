/* ---------------------------------------------------------------------- */
/* Clouds — WebGL fog engine                                               */
/* ---------------------------------------------------------------------- */

/* Split out of Clouds.tsx on purpose: that file also exports the `<Clouds>`
   React component, and Vite's fast-refresh plugin only preserves component
   state across an edit when a file exports *only* components. With
   `createClouds`/`supportsHtmlInCanvas` living alongside it, every edit to
   this engine — shader tweaks, tuning constants — forced a full reload of
   the page instead of a hot-swap. Nothing outside Clouds.tsx imports these
   symbols directly, so the split is invisible to every other consumer. */

import { createFpsGovernor } from "./fpsGovernor";

export interface CloudsOptions {
  scale?: number;
  speed?: number;
  cover?: number;
  density?: number;
  shading?: number;
  color?: [number, number, number] | "auto";
  opacity?: number;
  shadow?: number;
  shadowOffsetX?: number;
  shadowOffsetY?: number;
  shadowSoftness?: number;
  wind?: number;
  windRadius?: number;
  refraction?: number;
  fogBlur?: number;
  quality?: number;
  /** Simulation frame rate cap. Fog is a slow medium — the field's own
   * motion is a fraction of a texel per frame — so running the whole
   * three-pass pipeline at display rate buys nothing visible while costing
   * twice the GPU time. The loop still runs at display rate while the
   * pointer is stirring the wind (see WIND_ACTIVE_MS), which is the only
   * part of the simulation fast enough to notice. */
  fps?: number;
  /** Ceiling on the device pixel ratio the output canvas is rasterised at.
   * The composite is a soft, low-frequency image, so on a 2x/3x display
   * running it at native resolution quadruples the fill cost for a
   * difference you cannot see. */
  maxDpr?: number;
  /** Hard ceiling on the noise field's pixel count, applied on top of
   * `quality`. The field shader evaluates ~37 simplex-noise samples per
   * pixel, so its resolution — not the output canvas's — is what actually
   * sets the frame cost. It's upsampled with linear filtering into the
   * composite, and fog has no fine detail to lose. */
  maxFieldPixels?: number;
}

export interface CloudsElements {
  source: HTMLCanvasElement;
  content: HTMLElement;
  output: HTMLCanvasElement;
}

export interface CloudsInstance {
  setOptions: (options: CloudsOptions) => void;
  /** Stops (or resumes) the render loop without tearing down the GL
   * context/shaders/textures — see the `paused` prop on `<Clouds>` for why
   * this exists as a separate lever from mounting. */
  setPaused: (paused: boolean) => void;
  resize: () => void;
  destroy: () => void;
}

type PaintableCanvas = HTMLCanvasElement & {
  requestPaint?: () => void;
  onpaint: (() => void) | null;
};

type ElementImageContext = CanvasRenderingContext2D & {
  drawElementImage?: (element: Element, x: number, y: number) => void;
};

const DEFAULTS: Required<CloudsOptions> = {
  scale: 1,
  speed: 0.6,
  cover: 0.1,
  density: 2.5,
  shading: 0.1,
  color: "auto",
  opacity: 0.64,
  shadow: 0.06,
  shadowOffsetX: 200,
  shadowOffsetY: -10,
  shadowSoftness: 1,
  wind: 0.5,
  windRadius: 150,
  refraction: 0,
  fogBlur: 0,
  quality: 1,
  fps: 30,
  maxDpr: 1.5,
  maxFieldPixels: 300_000,
};

/** Values this layer's own live options are quietly stepped down to the one
 * time the fps governor below trips — see fpsGovernor.ts for why this is a
 * separate, decoupled lever from renderQuality's static tier. All three are
 * already caller-facing knobs on CloudsOptions, so dropping to these costs
 * no context rebuild and no shader recompile: only a smaller field and a
 * lower simulation rate on the next frame. Chosen as roughly what a `low`
 * renderQuality tier would already imply for a layer at this cost, rather
 * than a new number invented for this path — a machine that reports capable
 * on static signals but isn't keeping up in practice gets treated the same
 * as one that reported incapable from the start. */
const FPS_DEGRADE: Pick<CloudsOptions, "fps" | "quality" | "maxFieldPixels"> = {
  fps: 20,
  quality: 0.7,
  maxFieldPixels: 150_000,
};

/** How long after the last pointer move the loop keeps running at display
 * rate rather than the capped simulation rate. The wind stamp is the one
 * part of the field that tracks a gesture, so it gets the full frame rate
 * while a gesture is happening and nothing else does. */
const WIND_ACTIVE_MS = 900;

/** Rate the loop lifts to while a gesture is in progress. The wind stamp is
 * a segment from the previous pointer position to the current one, so it
 * stays continuous at any rate — this only needs to be high enough that the
 * channel the cursor opens feels like it is tracking the hand, not high
 * enough to match a 120Hz+ display. */
const WIND_GESTURE_FPS = 45;

/** Wind amplitude below which the field is treated as settled, at which
 * point the pass is zeroed once and then skipped entirely. */
const WIND_IDLE_EPSILON = 0.004;

/* ---------------------------------------------------------------------- */
/* Shared per-frame render budget                                          */
/* ---------------------------------------------------------------------- */

/** At most one cloud layer draws per animation frame, across every instance
 * on the page.
 *
 * This is the fix for the last of the scroll jank on the landing page, and
 * it is a scheduling problem rather than a cost one: with the simulation
 * capped to 30fps, a single layer holds a comfortable margin inside a frame
 * — but the hero's fog and the features curtain's fog were independently
 * capped, so their render frames regularly landed on the *same* frame and
 * that frame blew its budget. Measured on a 120Hz display, either layer
 * alone held 120fps and the two together sat at 60. Interleaving them costs
 * nothing: each still gets its own 30fps, just never on the same frame as
 * the other. A layer that loses the claim keeps its `lastTime` and is
 * therefore overdue on the next frame, so it takes the slot then — which is
 * what makes the two settle into alternating frames on their own. */
const renderBudget = { at: -1, used: 0 };

function claimRenderSlot(now: number): boolean {
  if (renderBudget.at !== now) {
    renderBudget.at = now;
    renderBudget.used = 0;
  }
  if (renderBudget.used >= 1) return false;
  renderBudget.used += 1;
  return true;
}

function clampNum(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

const VERT = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
void main () {
  gl_Position = vec4(aPos, 0.0, 1.0);
}`;

const FIELD_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform vec2 uResolution;
uniform vec2 uOffset;
uniform float uTime;
uniform float uScale;
uniform float uCover;
uniform float uDensity;

const mat2 m = mat2(1.6, 1.2, -1.2, 1.6);

vec2 hash (vec2 p) {
  p = vec2(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)));
  return -1.0 + 2.0 * fract(sin(p) * 43758.5453123);
}

float noise (vec2 p) {
  const float K1 = 0.366025404;
  const float K2 = 0.211324865;
  vec2 i = floor(p + (p.x + p.y) * K1);
  vec2 a = p - i + (i.x + i.y) * K2;
  vec2 o = (a.x > a.y) ? vec2(1.0, 0.0) : vec2(0.0, 1.0);
  vec2 b = a - o + K2;
  vec2 c = a - 1.0 + 2.0 * K2;
  vec3 h = max(0.5 - vec3(dot(a, a), dot(b, b), dot(c, c)), 0.0);
  vec3 n = h * h * h * h
    * vec3(dot(a, hash(i)), dot(b, hash(i + o)), dot(c, hash(i + 1.0)));
  return dot(n, vec3(70.0));
}

float fbm (vec2 n) {
  float total = 0.0;
  float amplitude = 0.1;
  for (int i = 0; i < 7; i++) {
    total += noise(n) * amplitude;
    n = m * n;
    amplitude *= 0.4;
  }
  return total;
}

void main () {
  vec2 p = gl_FragCoord.xy / uResolution + uOffset;
  vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);
  float q = fbm(p * asp * uScale * 0.5);

  float r = 0.0;
  vec2 uv = p * asp * uScale;
  uv -= q - uTime;
  float weight = 0.8;
  for (int i = 0; i < 8; i++) {
    r += abs(weight * noise(uv));
    uv = m * uv + uTime;
    weight *= 0.7;
  }

  float f = 0.0;
  uv = p * asp * uScale;
  uv -= q - uTime;
  weight = 0.7;
  for (int i = 0; i < 8; i++) {
    f += weight * noise(uv);
    uv = m * uv + uTime;
    weight *= 0.6;
  }
  f *= r + f;

  float c = 0.0;
  float t2 = uTime * 2.0;
  uv = p * asp * uScale * 2.0;
  uv -= q - t2;
  weight = 0.4;
  for (int i = 0; i < 7; i++) {
    c += weight * noise(uv);
    uv = m * uv + t2;
    weight *= 0.6;
  }

  float c1 = 0.0;
  float t3 = uTime * 3.0;
  uv = p * asp * uScale * 3.0;
  uv -= q - t3;
  weight = 0.4;
  for (int i = 0; i < 7; i++) {
    c1 += abs(weight * noise(uv));
    uv = m * uv + t3;
    weight *= 0.6;
  }
  c += c1;

  float coverage = clamp(uCover + uDensity * f * r + c, 0.0, 1.0);
  outColor = vec4(coverage, clamp(c, 0.0, 1.0), 0.0, 1.0);
}`;

const WIND_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uPrev;
uniform vec2 uResolution;
uniform float uDecay;
uniform vec2 uA;
uniform vec2 uB;
uniform float uRadius;
uniform float uStrength;

void main () {
  vec2 uv = gl_FragCoord.xy / uResolution;
  float prev = texture(uPrev, uv).r * uDecay;
  vec2 asp = vec2(uResolution.x / uResolution.y, 1.0);
  vec2 p = uv * asp;
  vec2 a = uA * asp;
  vec2 b = uB * asp;
  vec2 pa = p - a;
  vec2 ba = b - a;
  float h = clamp(dot(pa, ba) / max(dot(ba, ba), 1e-6), 0.0, 1.0);
  float d = length(pa - ba * h) / max(uRadius, 1e-4);
  float stamp = exp(-d * d * 3.0) * uStrength;
  outColor = vec4(clamp(prev + stamp, 0.0, 1.0), 0.0, 0.0, 1.0);
}`;

const COMPOSITE_FRAG = `#version 300 es
precision highp float;
out vec4 outColor;
uniform sampler2D uField;
uniform sampler2D uContent;
uniform sampler2D uWind;
uniform vec2 uResolution;
uniform vec2 uContentScale;
uniform vec3 uBase;
uniform float uShading;
uniform float uOpacity;
uniform float uShadow;
uniform vec2 uShadowShift;
uniform float uShadowLod;
uniform float uWindAmt;
uniform float uRefraction;
uniform float uFogBlur;
uniform float uHasContent;

void main () {
  vec2 uv = gl_FragCoord.xy / uResolution;
  vec2 field = texture(uField, uv).rg;
  float wind = texture(uWind, uv).r * uWindAmt;
  float cov = field.r - wind;
  float mist = smoothstep(0.04, 0.9, cov);
  float cloudA = mist * uOpacity;

  float lum = dot(uBase, vec3(0.299, 0.587, 0.114));
  float sh = clamp(field.g, 0.0, 1.0);
  float k = uShading * 0.35;
  vec3 cloudRGB = lum > 0.5
    ? uBase - vec3((1.0 - sh) * k)
    : uBase + vec3(sh * k);
  cloudRGB = clamp(cloudRGB, 0.0, 1.0);

  // Two extra texture fetches per pixel, and the only thing that needs the
  // field's mip chain. uShadow is a uniform, so the branch is coherent
  // across the whole draw — when a layer runs without a drop shadow (both
  // of this page's do) the taps and the per-frame generateMipmap that
  // feeds them are skipped outright.
  float shadowA = 0.0;
  if (uShadow > 0.0) {
    vec2 sUv = uv + uShadowShift;
    float s = textureLod(uField, sUv, uShadowLod).r
      - texture(uWind, sUv).r * uWindAmt;
    shadowA = smoothstep(0.35, 1.0, s) * uShadow * (1.0 - mist);
  }

  float a;
  vec3 rgb;
  if (uHasContent > 0.5) {
    vec2 e = vec2(8.0) / uResolution;
    float gx = texture(uField, uv + vec2(e.x, 0.0)).r
      - texture(uField, uv - vec2(e.x, 0.0)).r;
    float gy = texture(uField, uv + vec2(0.0, e.y)).r
      - texture(uField, uv - vec2(0.0, e.y)).r;
    vec2 rUv = uv + vec2(gx, gy) * uRefraction * mist;
    vec3 fogged = textureLod(
      uContent, vec2(rUv.x, 1.0 - rUv.y) * uContentScale, mist * uFogBlur * 5.0
    ).rgb;
    vec3 layer = mix(fogged, cloudRGB, cloudA) * (1.0 - shadowA);
    float aF = smoothstep(0.02, 0.2, mist);
    a = aF + shadowA * (1.0 - aF);
    rgb = layer * aF;
  } else {
    a = cloudA + shadowA * (1.0 - cloudA);
    rgb = cloudRGB * cloudA;
  }
  outColor = vec4(rgb, a);
}`;

export function supportsHtmlInCanvas(): boolean {
  if (typeof document === "undefined") return false;
  const probe = document.createElement("canvas") as PaintableCanvas;
  const ctx = probe.getContext("2d") as ElementImageContext | null;
  return Boolean(
    ctx &&
    typeof ctx.drawElementImage === "function" &&
    typeof probe.requestPaint === "function",
  );
}

export function createClouds(
  elements: CloudsElements,
  options: CloudsOptions = {},
): CloudsInstance | null {
  const config = { ...DEFAULTS, ...options };
  const { source, content, output } = elements;

  const gl = output.getContext("webgl2", {
    alpha: true,
    depth: false,
    stencil: false,
    antialias: false,
    premultipliedAlpha: true,
  });
  if (!gl || gl.isContextLost()) return null;

  const sourceCtx = source.getContext("2d") as ElementImageContext | null;
  const paintable = source as PaintableCanvas;
  const htmlInCanvas = Boolean(
    sourceCtx &&
    typeof sourceCtx.drawElementImage === "function" &&
    typeof paintable.requestPaint === "function",
  );

  let contentDirty = false;
  let wake = () => {};

  if (htmlInCanvas) {
    paintable.onpaint = () => {
      try {
        sourceCtx!.reset();
        sourceCtx!.drawElementImage!(content, 0, 0);
        contentDirty = true;
        wake();
      } catch {
        // Best-effort repaint: a failure here just leaves the previous
        // content texture on screen for one more frame, which the next
        // successful paint corrects. Not worth surfacing.
      }
    };
  }

  function compile(type: number, text: string): WebGLShader {
    const shader = gl!.createShader(type)!;
    gl!.shaderSource(shader, text);
    gl!.compileShader(shader);
    if (!gl!.getShaderParameter(shader, gl!.COMPILE_STATUS)) {
      console.error("Clouds shader error:", gl!.getShaderInfoLog(shader));
    }
    return shader;
  }

  function link(fragSource: string) {
    const vs = compile(gl!.VERTEX_SHADER, VERT);
    const fs = compile(gl!.FRAGMENT_SHADER, fragSource);
    const program = gl!.createProgram()!;
    gl!.attachShader(program, vs);
    gl!.attachShader(program, fs);
    gl!.linkProgram(program);
    const uniforms: Record<string, WebGLUniformLocation> = {};
    const count = gl!.getProgramParameter(program, gl!.ACTIVE_UNIFORMS);
    for (let i = 0; i < count; i++) {
      const info = gl!.getActiveUniform(program, i)!;
      uniforms[info.name] = gl!.getUniformLocation(program, info.name)!;
    }
    return { program, vs, fs, uniforms };
  }

  const field = link(FIELD_FRAG);
  const windPass = link(WIND_FRAG);
  const composite = link(COMPOSITE_FRAG);

  const quad = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, quad);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

  /** The field's mip chain exists for exactly two consumers: the drop
   * shadow's `textureLod` tap and (html-in-canvas only) the fog blur. With
   * neither in play, rebuilding it every frame is a full extra pass over
   * the field for nothing, so the texture drops to plain LINEAR instead. */
  function fieldNeedsMips() {
    return (
      (config.shadow > 0 && config.shadowSoftness > 0) ||
      (htmlInCanvas && config.fogBlur > 0)
    );
  }

  let fieldMips = false;

  const fieldTexture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, fieldTexture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

  /** Keeps MIN_FILTER in step with whether the chain is being maintained —
   * a mipmap filter on a texture without mips is an incomplete texture and
   * samples as black. */
  function applyFieldFilter() {
    const next = fieldNeedsMips();
    if (next === fieldMips) return;
    fieldMips = next;
    gl!.bindTexture(gl!.TEXTURE_2D, fieldTexture);
    gl!.texParameteri(
      gl!.TEXTURE_2D,
      gl!.TEXTURE_MIN_FILTER,
      next ? gl!.LINEAR_MIPMAP_LINEAR : gl!.LINEAR,
    );
    if (next && fieldW > 0) gl!.generateMipmap(gl!.TEXTURE_2D);
  }

  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);

  const contentTexture = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, contentTexture);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    gl.LINEAR_MIPMAP_LINEAR,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    1,
    1,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    new Uint8Array([0, 0, 0, 255]),
  );
  gl.generateMipmap(gl.TEXTURE_2D);

  function makeWindTexture() {
    const texture = gl!.createTexture()!;
    gl!.bindTexture(gl!.TEXTURE_2D, texture);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MIN_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_MAG_FILTER, gl!.LINEAR);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_S, gl!.CLAMP_TO_EDGE);
    gl!.texParameteri(gl!.TEXTURE_2D, gl!.TEXTURE_WRAP_T, gl!.CLAMP_TO_EDGE);
    return texture;
  }
  const windTextures = [makeWindTexture(), makeWindTexture()];
  let windIndex = 0;
  // The wind field is entirely pointer-driven and decays to nothing on its
  // own. `texImage2D(..., null)` is specified to zero-fill, so it starts
  // settled: until the cursor actually stirs the fog, the wind pass — a
  // full extra draw over the field every frame — never runs at all.
  let windEnergy = 0;
  let windSettled = true;

  const fbo = gl.createFramebuffer();

  let fieldW = 0;
  let fieldH = 0;
  let contentScaleX = 1;
  let contentScaleY = 1;
  // `render()` runs every animation frame (not just while scrolling), and
  // used to read `content.clientWidth/clientHeight/scrollLeft/scrollTop`
  // live each time. Any of those can force a synchronous layout if they're
  // read while other code (GSAP's scrub tween, in this page) has pending
  // style writes from the same frame — a Chrome performance trace on the
  // scroll transition attributed several seconds of forced reflow to this
  // exact call. Cached here and refreshed from `syncCanvasSize` (size) and
  // a passive scroll listener (scroll offset) instead, so the hot render
  // path never touches layout.
  let contentClientWidth = 1;
  let contentClientHeight = 1;
  let contentScrollLeft = 0;
  let contentScrollTop = 0;
  // Same reasoning as above, for the output canvas's own rendered size
  // (also read multiple times per frame in `render()`).
  let outputClientWidth = 1;
  let outputClientHeight = 1;

  let baseColor: [number, number, number] = [1, 1, 1];
  const probe = document.createElement("canvas");
  probe.width = probe.height = 1;
  const probeCtx = probe.getContext("2d", { willReadFrequently: true });

  function syncBaseColor() {
    if (config.color !== "auto") {
      baseColor = config.color;
      return;
    }
    if (!probeCtx) return;
    let el: Element | null = content;
    while (el) {
      const bg = getComputedStyle(el).backgroundColor;
      if (bg && bg !== "transparent") {
        probeCtx.clearRect(0, 0, 1, 1);
        probeCtx.fillStyle = bg;
        probeCtx.fillRect(0, 0, 1, 1);
        const [r, g, b, a] = probeCtx.getImageData(0, 0, 1, 1).data;
        if (a > 0) {
          baseColor = [r / 255, g / 255, b / 255];
          return;
        }
      }
      el = el.parentElement;
    }
    baseColor = [1, 1, 1];
  }

  function syncCanvasSize() {
    const cw = content.clientWidth;
    const ch = content.clientHeight;
    contentClientWidth = cw;
    contentClientHeight = ch;
    if (cw > 0 && ch > 0) {
      const wpx = `${cw}px`;
      const hpx = `${ch}px`;
      if (output.style.width !== wpx) output.style.width = wpx;
      if (output.style.height !== hpx) output.style.height = hpx;
    }
    const dpr = clampNum(window.devicePixelRatio || 1, 1, config.maxDpr);
    outputClientWidth = output.clientWidth;
    outputClientHeight = output.clientHeight;
    const width = Math.max(1, Math.round(outputClientWidth * dpr));
    const height = Math.max(1, Math.round(outputClientHeight * dpr));
    if (output.width !== width || output.height !== height) {
      output.width = width;
      output.height = height;
    }
    contentScaleX = htmlInCanvas
      ? Math.min(1, cw / Math.max(source.clientWidth, 1))
      : 1;
    contentScaleY = htmlInCanvas
      ? Math.min(1, ch / Math.max(source.clientHeight, 1))
      : 1;
    const quality = clampNum(config.quality, 0.2, 1);
    // Resolution is budgeted in *pixels*, not in width: the field shader's
    // cost is per-pixel, and a width cap alone let a tall or wide viewport
    // through at several times the intended load. This replaces the old
    // "1440px wide" cap, which on a 1500px viewport resolved to a ~1.5
    // megapixel field — ~37 noise samples each, every frame, per layer.
    const outW = Math.max(output.clientWidth, 1);
    const outH = Math.max(output.clientHeight, 1);
    const budgetQ = Math.sqrt(
      Math.max(config.maxFieldPixels, 40_000) / (outW * outH),
    );
    const q = Math.min(quality, budgetQ, 1);
    const nextW = Math.max(16, Math.round(outW * q));
    const nextH = Math.max(16, Math.round(outH * q));
    if (nextW !== fieldW || nextH !== fieldH) {
      fieldW = nextW;
      fieldH = nextH;
      gl!.bindTexture(gl!.TEXTURE_2D, fieldTexture);
      gl!.texImage2D(
        gl!.TEXTURE_2D,
        0,
        gl!.RGBA,
        fieldW,
        fieldH,
        0,
        gl!.RGBA,
        gl!.UNSIGNED_BYTE,
        null,
      );
      if (fieldMips) gl!.generateMipmap(gl!.TEXTURE_2D);
      // Reallocated as zero-filled, so the decaying wind field is settled
      // again and its pass can stay skipped until the pointer stirs it.
      windEnergy = 0;
      windSettled = true;
      for (const texture of windTextures) {
        gl!.bindTexture(gl!.TEXTURE_2D, texture);
        gl!.texImage2D(
          gl!.TEXTURE_2D,
          0,
          gl!.RGBA,
          fieldW,
          fieldH,
          0,
          gl!.RGBA,
          gl!.UNSIGNED_BYTE,
          null,
        );
      }
    }
    if (htmlInCanvas) {
      const cssWidth = Math.max(1, Math.round(source.clientWidth));
      const cssHeight = Math.max(1, Math.round(source.clientHeight));
      if (source.width !== cssWidth * dpr || source.height !== cssHeight * dpr) {
        source.width = cssWidth * dpr;
        source.height = cssHeight * dpr;
      }
      paintable.requestPaint!();
    }
  }

  applyFieldFilter();
  syncCanvasSize();
  syncBaseColor();

  function uploadContent() {
    if (!htmlInCanvas || !contentDirty) return;
    contentDirty = false;
    gl!.bindTexture(gl!.TEXTURE_2D, contentTexture);
    gl!.texImage2D(
      gl!.TEXTURE_2D,
      0,
      gl!.RGBA,
      gl!.RGBA,
      gl!.UNSIGNED_BYTE,
      source,
    );
    gl!.generateMipmap(gl!.TEXTURE_2D);
  }

  let pointerX = 0.5;
  let pointerY = 0.5;
  let prevPointerX = 0.5;
  let prevPointerY = 0.5;
  let hasPointer = false;
  let lastPointerMove = 0;

  let time = Math.random() * 64;

  function render(delta: number) {
    uploadContent();

    gl!.bindFramebuffer(gl!.FRAMEBUFFER, fbo);
    gl!.framebufferTexture2D(
      gl!.FRAMEBUFFER,
      gl!.COLOR_ATTACHMENT0,
      gl!.TEXTURE_2D,
      fieldTexture,
      0,
    );
    gl!.viewport(0, 0, fieldW, fieldH);
    gl!.useProgram(field.program);
    gl!.uniform2f(field.uniforms.uResolution, fieldW, fieldH);
    gl!.uniform2f(
      field.uniforms.uOffset,
      contentScrollLeft / Math.max(contentClientWidth, 1),
      -contentScrollTop / Math.max(contentClientHeight, 1),
    );
    gl!.uniform1f(field.uniforms.uTime, time);
    gl!.uniform1f(field.uniforms.uScale, Math.max(config.scale, 0.05));
    gl!.uniform1f(field.uniforms.uCover, Math.max(config.cover, 0));
    gl!.uniform1f(field.uniforms.uDensity, Math.max(config.density, 0));
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);

    const moved = Math.hypot(pointerX - prevPointerX, pointerY - prevPointerY);
    const stamping = hasPointer && moved > 0 && config.wind > 0;
    const decay = Math.pow(0.5, delta / 0.7);
    if (stamping) {
      windEnergy = 1;
      windSettled = false;
    }

    // Skipped entirely once the field has decayed back to nothing: with no
    // stamp to add and nothing left to decay, the pass would only be
    // multiplying zeros — at field resolution, every frame. The frame that
    // crosses the threshold runs with uDecay = 0 so the texture is left
    // genuinely zeroed rather than holding a residue.
    if (!windSettled) {
      if (!stamping) windEnergy *= decay;
      const finalise = !stamping && windEnergy < WIND_IDLE_EPSILON;
      const prevWind = windTextures[windIndex];
      const nextWind = windTextures[1 - windIndex];
      windIndex = 1 - windIndex;
      gl!.framebufferTexture2D(
        gl!.FRAMEBUFFER,
        gl!.COLOR_ATTACHMENT0,
        gl!.TEXTURE_2D,
        nextWind,
        0,
      );
      gl!.useProgram(windPass.program);
      gl!.activeTexture(gl!.TEXTURE0);
      gl!.bindTexture(gl!.TEXTURE_2D, prevWind);
      gl!.uniform1i(windPass.uniforms.uPrev, 0);
      gl!.uniform2f(windPass.uniforms.uResolution, fieldW, fieldH);
      gl!.uniform1f(windPass.uniforms.uDecay, finalise ? 0 : decay);
      gl!.uniform2f(windPass.uniforms.uA, prevPointerX, prevPointerY);
      gl!.uniform2f(windPass.uniforms.uB, pointerX, pointerY);
      gl!.uniform1f(
        windPass.uniforms.uRadius,
        Math.max(config.windRadius, 1) / Math.max(outputClientHeight, 1),
      );
      gl!.uniform1f(
        windPass.uniforms.uStrength,
        stamping ? Math.min(0.2 + moved * 12, 1) * 0.5 : 0,
      );
      gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
      if (finalise) {
        windEnergy = 0;
        windSettled = true;
      }
    }
    prevPointerX = pointerX;
    prevPointerY = pointerY;
    const currentWind = windTextures[windIndex];

    gl!.bindFramebuffer(gl!.FRAMEBUFFER, null);
    if (fieldMips) {
      gl!.bindTexture(gl!.TEXTURE_2D, fieldTexture);
      gl!.generateMipmap(gl!.TEXTURE_2D);
    }

    gl!.viewport(0, 0, output.width, output.height);
    gl!.useProgram(composite.program);
    gl!.activeTexture(gl!.TEXTURE0);
    gl!.bindTexture(gl!.TEXTURE_2D, fieldTexture);
    gl!.uniform1i(composite.uniforms.uField, 0);
    gl!.activeTexture(gl!.TEXTURE1);
    gl!.bindTexture(gl!.TEXTURE_2D, contentTexture);
    gl!.uniform1i(composite.uniforms.uContent, 1);
    gl!.activeTexture(gl!.TEXTURE2);
    gl!.bindTexture(gl!.TEXTURE_2D, currentWind);
    gl!.uniform1i(composite.uniforms.uWind, 2);
    gl!.uniform2f(composite.uniforms.uResolution, output.width, output.height);
    gl!.uniform2f(
      composite.uniforms.uContentScale,
      contentScaleX,
      contentScaleY,
    );
    gl!.uniform3f(
      composite.uniforms.uBase,
      baseColor[0],
      baseColor[1],
      baseColor[2],
    );
    gl!.uniform1f(
      composite.uniforms.uOpacity,
      Math.min(Math.max(config.opacity, 0), 1),
    );
    gl!.uniform1f(composite.uniforms.uShading, Math.max(config.shading, 0));
    gl!.uniform1f(
      composite.uniforms.uShadow,
      Math.min(Math.max(config.shadow, 0), 1),
    );
    gl!.uniform2f(
      composite.uniforms.uShadowShift,
      -config.shadowOffsetX / Math.max(outputClientWidth, 1),
      config.shadowOffsetY / Math.max(outputClientHeight, 1),
    );
    gl!.uniform1f(
      composite.uniforms.uShadowLod,
      Math.min(Math.max(config.shadowSoftness, 0), 1) * 4,
    );
    gl!.uniform1f(
      composite.uniforms.uWindAmt,
      Math.min(Math.max(config.wind, 0), 1),
    );
    gl!.uniform1f(
      composite.uniforms.uRefraction,
      Math.max(config.refraction, 0) / Math.max(outputClientWidth, 1),
    );
    gl!.uniform1f(
      composite.uniforms.uFogBlur,
      Math.min(Math.max(config.fogBlur, 0), 1),
    );
    gl!.uniform1f(composite.uniforms.uHasContent, htmlInCanvas ? 1 : 0);
    gl!.drawArrays(gl!.TRIANGLE_STRIP, 0, 4);
  }

  let raf = 0;
  let lastTime = performance.now();
  let destroyed = false;
  let running = false;
  let visible = true;
  // A backgrounded tab still gets rAF callbacks in some browsers (and gets
  // them in bursts on wake), so the loop parks itself rather than burning
  // GPU time on a canvas nobody is looking at.
  let documentHidden =
    typeof document !== "undefined" && document.visibilityState === "hidden";
  /* Measures render-to-render time, not rAF-callback time — this layer is
     already deliberately capped to `config.fps` (30 by default), so the
     governor has to judge whether *that* rate is being met, not mistake the
     intentional cap for a problem. See fpsGovernor.ts. */
  const fpsGovernor = createFpsGovernor();
  /* Keys `setOptions` will not let a caller's own value override once the
     governor has stepped them down. Without this, a caller passing a static
     prop (every current one on this page does — see e.g. FeaturesSection's
     `quality={0.75}`) re-applies that same literal on every re-render, which
     would silently undo the degrade the very next time the component above
     happened to re-render for any unrelated reason. */
  const degradedKeys = new Set<keyof CloudsOptions>();

  function applyDegrade() {
    let sizeChanged = false;
    for (const key of Object.keys(FPS_DEGRADE) as (keyof typeof FPS_DEGRADE)[]) {
      degradedKeys.add(key);
      const value = FPS_DEGRADE[key];
      if (value === undefined || config[key] === value) continue;
      config[key] = value;
      sizeChanged = true;
    }
    applyFieldFilter();
    if (sizeChanged) syncCanvasSize();
    start();
  }
  // Separate from `visible` (which tracks on-screen intersection): this is
  // an explicit pause request from outside, used to freeze the loop while
  // still keeping the GL context/shaders/textures alive — see setPaused.
  let externallyPaused = false;
  // First frame after a pause lands with a huge, stale `delta` (the clock
  // kept ticking while paused) — this forces `render` to draw at least one
  // frame with a fresh timestamp on resume before the usual capped delta
  // math resumes, so nothing jumps.
  let justResumed = false;

  const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  let reducedMotion = motionQuery.matches;

  function frame(now: number) {
    if (destroyed) return;
    if (!visible || externallyPaused || documentHidden) {
      running = false;
      return;
    }
    if (justResumed) {
      justResumed = false;
      lastTime = now;
    }

    // Frame pacing. The simulation's own motion is slow enough that the
    // capped rate is indistinguishable from the display rate, and halving
    // the number of three-pass renders is the single largest saving
    // available here — the field shader runs ~37 noise samples per pixel,
    // so a skipped frame is a skipped megapixel of that. The exception is
    // an active pointer gesture: the wind stamp is the one part of the
    // field that tracks input, so it gets full rate while it's happening.
    const windGesture = now - lastPointerMove < WIND_ACTIVE_MS;
    const targetFps = windGesture
      ? Math.max(config.fps, WIND_GESTURE_FPS)
      : config.fps;
    const minFrameMs = 1000 / clampNum(targetFps, 1, 120) - 1;
    const elapsed = now - lastTime;
    if (elapsed < minFrameMs || !claimRenderSlot(now)) {
      raf = requestAnimationFrame(frame);
      return;
    }

    // Clamped generously: at the capped rate a normal delta is already
    // ~1/30s, so the old 1/30 ceiling would have clipped every frame and
    // stalled the fog's drift.
    const delta = Math.min(elapsed / 1000, 1 / 12);
    lastTime = now;
    if (!reducedMotion) time += delta * config.speed * 0.03;
    render(delta);
    if (fpsGovernor.sample(now)) {
      // One-time step down: this is the same code path setOptions itself
      // uses, so the resolution/rate changes apply on the very next render
      // exactly as they would if a caller had passed these values in.
      applyDegrade();
    }
    const windActive = now - lastPointerMove < 3000;
    if (reducedMotion && !windActive && !contentDirty) {
      running = false;
      return;
    }
    raf = requestAnimationFrame(frame);
  }

  function start() {
    if (destroyed || running || !visible || externallyPaused || documentHidden) {
      return;
    }
    running = true;
    lastTime = performance.now();
    raf = requestAnimationFrame(frame);
  }

  wake = start;

  // One synchronous draw at construction, before any pause can be applied.
  // Linking a program is not what costs on first use — drivers finish
  // compiling lazily, at the first draw that actually uses it — so a layer
  // created paused and unpaused later would pay that bill at the exact
  // moment it needs to appear. Exercising all three passes once here moves
  // it to page load and lets callers arm a paused layer late instead of
  // running it for a screenful of scroll it isn't visible for.
  render(0);

  start();

  function onMotionChange() {
    reducedMotion = motionQuery.matches;
    start();
  }
  motionQuery.addEventListener("change", onMotionChange);

  function onVisibilityChange() {
    documentHidden = document.visibilityState === "hidden";
    if (documentHidden) {
      cancelAnimationFrame(raf);
      running = false;
      return;
    }
    // The clock kept running while the tab was away, so the first frame
    // back needs a fresh timestamp or it would advance the field by the
    // whole absence in one step.
    justResumed = true;
    start();
  }
  document.addEventListener("visibilitychange", onVisibilityChange);

  const observer = new ResizeObserver(() => {
    invalidateRect();
    syncCanvasSize();
    start();
  });
  observer.observe(output);
  observer.observe(content);

  const intersection = new IntersectionObserver((entries) => {
    visible = entries[entries.length - 1]?.isIntersecting ?? true;
    if (visible) start();
  });
  intersection.observe(output);

  // `pointermove` fires at the pointer's polling rate, which on a lot of
  // mice is well above the display rate. Reading getBoundingClientRect()
  // per event (twice over, with two Clouds layers on the page) forced a
  // layout that often enough landed in the middle of the same frame's GSAP
  // style writes. The rect only moves on scroll or resize, so it's cached
  // and re-read at most once per frame instead.
  let cachedRect: DOMRect | null = null;
  function invalidateRect() {
    cachedRect = null;
  }
  function outputRect() {
    if (!cachedRect) cachedRect = output.getBoundingClientRect();
    return cachedRect;
  }
  window.addEventListener("scroll", invalidateRect, {
    passive: true,
    capture: true,
  });

  function onPointerMove(event: PointerEvent) {
    const rect = outputRect();
    const inside =
      event.clientX >= rect.left &&
      event.clientX <= rect.right &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom;

    if (!inside) {
      hasPointer = false;
      return;
    }

    const x = (event.clientX - rect.left) / Math.max(rect.width, 1);
    const y = 1 - (event.clientY - rect.top) / Math.max(rect.height, 1);
    if (!hasPointer) {
      prevPointerX = x;
      prevPointerY = y;
      hasPointer = true;
    }
    pointerX = x;
    pointerY = y;
    lastPointerMove = performance.now();
    start();
  }

  // Track above the component's stacking context so visual overlays do not
  // swallow wind input before it reaches the WebGL simulation.
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  function onContentScroll() {
    contentScrollLeft = content.scrollLeft;
    contentScrollTop = content.scrollTop;
    start();
  }
  onContentScroll();
  content.addEventListener("scroll", onContentScroll, { passive: true });

  let themeTimer = 0;
  function onThemeShift() {
    syncBaseColor();
    start();
    window.clearTimeout(themeTimer);
    themeTimer = window.setTimeout(() => {
      syncBaseColor();
      start();
    }, 300);
  }

  const themeObserver = new MutationObserver(onThemeShift);
  themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class", "style", "data-theme"],
  });
  const schemeQuery = window.matchMedia("(prefers-color-scheme: dark)");
  schemeQuery.addEventListener("change", onThemeShift);

  return {
    // Called after *every* render of the <Clouds> component (see the effect
    // in the wrapper), so it has to be free when nothing actually changed.
    // It used to re-run syncCanvasSize + syncBaseColor unconditionally,
    // which reads clientWidth/clientHeight and walks ancestors with
    // getComputedStyle — a forced layout on every re-render of the parent,
    // and the hero re-renders on every resize measurement it takes.
    setOptions(next) {
      let sizeChanged = false;
      let colorChanged = false;
      let changed = false;
      for (const key of Object.keys(next) as (keyof CloudsOptions)[]) {
        // The fps governor stepped this key down already; a caller's own
        // (typically static) prop value is not allowed to quietly undo that
        // on the next re-render. See degradedKeys above.
        if (degradedKeys.has(key)) continue;
        const value = next[key];
        if (value === undefined) continue;
        const current = config[key];
        if (Array.isArray(value) && Array.isArray(current)) {
          if (value.every((v, i) => v === current[i])) continue;
        } else if (value === current) {
          continue;
        }
        changed = true;
        if (key === "quality" || key === "maxDpr" || key === "maxFieldPixels") {
          sizeChanged = true;
        }
        if (key === "color") colorChanged = true;
        // @ts-expect-error keys are checked against the same option type
        config[key] = value;
      }
      if (!changed) return;
      applyFieldFilter();
      if (sizeChanged) syncCanvasSize();
      if (colorChanged) syncBaseColor();
      start();
    },
    setPaused(paused) {
      if (paused === externallyPaused) return;
      externallyPaused = paused;
      if (paused) {
        cancelAnimationFrame(raf);
        running = false;
      } else {
        justResumed = true;
        // A frame painted while paused (e.g. a resize) can leave stale
        // content on screen; a render on resume guarantees the canvas is
        // current even if the loop then decides not to keep going (the
        // reduced-motion idle path).
        render(0);
        start();
      }
    },
    resize() {
      syncCanvasSize();
      start();
    },
    destroy() {
      destroyed = true;
      cancelAnimationFrame(raf);
      observer.disconnect();
      intersection.disconnect();
      themeObserver.disconnect();
      schemeQuery.removeEventListener("change", onThemeShift);
      window.clearTimeout(themeTimer);
      motionQuery.removeEventListener("change", onMotionChange);
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("scroll", invalidateRect, { capture: true });
      window.removeEventListener("pointermove", onPointerMove);
      content.removeEventListener("scroll", onContentScroll);
      if (htmlInCanvas) paintable.onpaint = null;
      gl!.deleteTexture(fieldTexture);
      gl!.deleteTexture(contentTexture);
      gl!.deleteTexture(windTextures[0]);
      gl!.deleteTexture(windTextures[1]);
      gl!.deleteFramebuffer(fbo);
      gl!.deleteProgram(field.program);
      gl!.deleteProgram(windPass.program);
      gl!.deleteProgram(composite.program);
      gl!.deleteShader(field.vs);
      gl!.deleteShader(field.fs);
      gl!.deleteShader(windPass.vs);
      gl!.deleteShader(windPass.fs);
      gl!.deleteShader(composite.vs);
      gl!.deleteShader(composite.fs);
      gl!.deleteBuffer(quad);
      /* Deliberately NOT calling WEBGL_lose_context.loseContext() here.
       *
       * It looks like the right thing — deleting every GL object above still
       * leaves the context itself alive until GC, and this page runs several at
       * once against a per-page cap. But the canvas this context belongs to is
       * owned by React (it comes in as `output`, a ref to a JSX <canvas>), and
       * `loseContext()` puts that canvas into a permanently lost state: a later
       * `getContext("webgl2")` on the *same element* hands back the same lost
       * context, and there is no way to get a working one without replacing the
       * element.
       *
       * That breaks the mount/unmount/remount cycle React StrictMode runs in
       * development: the cleanup lost the context, the remount got the dead one
       * back, `isContextLost()` was true, createClouds returned null, and the
       * fog silently disappeared for the rest of the session. Production build
       * looked fine because effects only run once there, which is exactly why
       * this needs a comment rather than a second attempt.
       *
       * three.js's `forceContextLoss()` is safe in FeatureVisual/ThinkingModel by
       * contrast, because the renderer creates and owns its own canvas and that
       * element is discarded on unmount — a remount builds a fresh one. */
    },
  };
}
