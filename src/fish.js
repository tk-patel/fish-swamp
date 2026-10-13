// fish.js — illustrated top-down koi (step 9.3).
//
// TWO IDEAS IN THIS FILE
//
// 1. PAINT, THEN BEND. Instead of building the koi's look out of shader maths,
//    we DRAW each koi once with the browser's ordinary Canvas 2D API (the same
//    API you'd use for a chart): ink outline, orange patches, flowing tail
//    with fin rays, whiskers, eyes. That picture becomes a texture. The mesh
//    the texture sits on is a flat grid ("ribbon") that the vertex shader
//    bends every frame — so the drawing swims like a sheet of paper.
//
// 2. A FISH SWIMS WITH A TRAVELLING WAVE. A real koi does not wag its body
//    like a stiff stick. A wave starts small at the head and grows as it runs
//    down to the tail (the "carangiform" swim). On top of that:
//      - when it TURNS, the whole body curves into a "C" toward the turn;
//      - the long tail lags behind and flutters like fabric;
//      - pectoral fins (front pair) and pelvic fins (back pair) row slowly,
//        fold back when the fish swims fast and spread when it is slow.
//
// UNITS: about 4.6 long at scale 1 (nose +1.5, tail tip -3.1). flock.js
// multiplies by KOI_WORLD_SCALE so they stay small in the pond.
export const KOI_WORLD_SCALE = 0.8;

// ===========================================================================
// FORWARD DIRECTION  (+Z is the nose — flock.js depends on this)
//   +Z forward, +Y up, +X the fish's left.
// ===========================================================================

import * as THREE from 'three';

export const KOI_NOSE_Z = 1.5;
export const KOI_STALK_Z = -1.65; // where the body narrows into the tail
export const KOI_TAIL_TIP_Z = -3.1;

const KOI_WIDEST_T = 0.34;
const KOI_MAX_HALF_WIDTH = 0.4;
const KOI_STALK_FRACTION = 0.16;

// ---------------------------------------------------------------------------
// THE PICTURE RECTANGLE
// Each koi drawing covers this rectangle in the fish's local x/z. It is a bit
// bigger than the fish so the whiskers (in front) and the wide tail fit.
// ---------------------------------------------------------------------------
const CARD_HALF_WIDTH = 0.85;
const CARD_FRONT_Z = 1.8;
const CARD_BACK_Z = -3.3;
const CARD_LENGTH = CARD_FRONT_Z - CARD_BACK_Z; // 5.1 → 3x as long as wide

// TEXTURE ATLAS: one big canvas holding 16 different koi pictures side by side
// (8 columns x 2 rows). One texture = one material = still one draw call for
// the whole school; each fish just looks at a different "cell".
const ATLAS_COLUMNS = 8;
const ATLAS_ROWS = 2;
const CELL_WIDTH_PX = 256;
const CELL_HEIGHT_PX = 768; // 256 * 3, same 1:3 shape as the card
const PIXELS_PER_UNIT = CELL_WIDTH_PX / (CARD_HALF_WIDTH * 2);

const INK = '#2b2e33'; // the dark grey line colour from the reference drawing

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Tiny seeded random generator (mulberry32). Same seed → same "random"
// patches, so every reload paints the same 16 koi.
function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function random() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Body outline from above: 0 at the nose, 1 at the shoulders, thin at the stalk. */
function koiProfile(t) {
  if (t < KOI_WIDEST_T) {
    // Quarter circle → round, blunt koi head.
    const k = t / KOI_WIDEST_T;
    return Math.sqrt(1 - (1 - k) * (1 - k));
  }
  const k = (t - KOI_WIDEST_T) / (1 - KOI_WIDEST_T);
  // Power > 1 keeps the body full through the middle, then it narrows
  // quickly into the tail stalk — the torpedo shape of the reference koi.
  return lerp(1, KOI_STALK_FRACTION, Math.pow(k, 1.7));
}

function bodyHalfWidthAt(z) {
  const t = clamp01((KOI_NOSE_Z - z) / (KOI_NOSE_Z - KOI_STALK_Z));
  return KOI_MAX_HALF_WIDTH * koiProfile(t);
}

// ===========================================================================
// KOI VARIETIES — real koi names. `fin` tints the tail and the fin meshes.
// `cells` = how many of the 16 atlas pictures use this variety (adds to 16),
// so kohaku (the reference look) is the most common.
// ===========================================================================
const koiVarieties = [
  { name: 'kohaku', cells: 4, base: '#f7f4ee', fin: '#f7f4ee', patches: ['#f2581e'], coverage: 0.5 },
  { name: 'sanke', cells: 2, base: '#f7f4ee', fin: '#f7f4ee', patches: ['#ee4f1c'], coverage: 0.4, inkSpots: 7 },
  { name: 'showa', cells: 2, base: '#26282c', fin: '#e9e6e0', patches: ['#ea5a1f', '#f4f1ea'], coverage: 0.5 },
  { name: 'tancho', cells: 2, base: '#f8f6f1', fin: '#f8f6f1', patches: [], coverage: 0, headSpot: '#e2321b' },
  { name: 'ogon', cells: 1, base: '#f0b13a', fin: '#f6c862', patches: [], coverage: 0, sheen: true },
  { name: 'yamabuki', cells: 1, base: '#fbd54a', fin: '#fde58a', patches: [], coverage: 0, sheen: true },
  { name: 'asagi', cells: 2, base: '#7d97a8', fin: '#f0b08a', patches: ['#ec7a3c'], coverage: 0, net: true, belly: '#ec7a3c' },
  { name: 'chagoi', cells: 1, base: '#e9782a', fin: '#f09650', patches: [], coverage: 0, net: true },
  { name: 'bekko', cells: 1, base: '#f7f4ee', fin: '#f7f4ee', patches: [], coverage: 0, inkSpots: 9 },
];

// ===========================================================================
// PAINTING ONE KOI (Canvas 2D)
// ctx is set up (see paintKoiAtlas) so we can draw in the fish's local units:
// x = left/right, y on the canvas = z of the fish. So the numbers below are
// the same numbers the shader and flock use.
// ===========================================================================
function traceBodyPath(ctx) {
  // Walk down the left edge (nose → stalk), then back up the right edge.
  const steps = 40;
  ctx.beginPath();
  for (let i = 0; i <= steps; i++) {
    const z = lerp(KOI_NOSE_Z, KOI_STALK_Z, i / steps);
    ctx.lineTo(bodyHalfWidthAt(z), z);
  }
  for (let i = steps; i >= 0; i--) {
    const z = lerp(KOI_NOSE_Z, KOI_STALK_Z, i / steps);
    ctx.lineTo(-bodyHalfWidthAt(z), z);
  }
  ctx.closePath();
}

// The tail: two long lobes that flare out and hang back, with a soft fork in
// the middle and a ragged (scalloped) trailing edge like silk.
function traceTailLobe(ctx, side) {
  const s = side; // +1 = left lobe, -1 = right lobe (mirror)
  ctx.beginPath();
  ctx.moveTo(0.02 * s, KOI_STALK_Z + 0.15);
  ctx.bezierCurveTo(0.16 * s, -1.9, 0.7 * s, -2.25, 0.74 * s, -2.95);
  // Scalloped (ruffled) trailing edge from the outer tip back to the fork.
  const scallops = 7;
  let previousX = 0.74 * s;
  let previousZ = -2.95;
  for (let i = 1; i <= scallops; i++) {
    const t = i / scallops;
    const x = lerp(0.74, 0.05, t) * s;
    const z = lerp(-2.95, -2.35, t) - 0.3 * Math.sin(t * Math.PI);
    const midX = (previousX + x) / 2;
    const midZ = (previousZ + z) / 2 - 0.09;
    ctx.quadraticCurveTo(midX, midZ, x, z);
    previousX = x;
    previousZ = z;
  }
  ctx.bezierCurveTo(0.04 * s, -2.2, 0.02 * s, -1.95, 0.0, KOI_STALK_Z + 0.05);
  ctx.closePath();
}

function drawFinRays(ctx, fromX, fromZ, toPoints) {
  for (const [x, z] of toPoints) {
    ctx.beginPath();
    ctx.moveTo(fromX, fromZ);
    // Slightly curved ray: control point pulled toward the body's centre line.
    ctx.quadraticCurveTo((fromX + x) * 0.5 * 0.85, (fromZ + z) * 0.5, x, z);
    ctx.stroke();
  }
}

function drawTail(ctx, variety) {
  for (const side of [1, -1]) {
    traceTailLobe(ctx, side);
    ctx.fillStyle = variety.fin;
    ctx.globalAlpha = 0.82; // see-through like a real koi tail
    ctx.fill();
    ctx.globalAlpha = 1;

    // Fin rays: thin ink lines fanning out from the stalk.
    ctx.save();
    traceTailLobe(ctx, side);
    ctx.clip();
    ctx.strokeStyle = INK;
    ctx.globalAlpha = 0.45;
    ctx.lineWidth = 0.012;
    const rays = [];
    for (let i = 0; i < 9; i++) {
      const t = i / 8;
      rays.push([lerp(0.8, 0.02, t) * side, lerp(-3.0, -2.4, t) - 0.3 * Math.sin(t * Math.PI)]);
    }
    drawFinRays(ctx, 0.02 * side, KOI_STALK_Z + 0.1, rays);
    ctx.restore();

    traceTailLobe(ctx, side);
    ctx.strokeStyle = INK;
    ctx.lineWidth = 0.022;
    ctx.stroke();
  }
}

// A wobbly round blob — the irregular edge is what makes it read as a koi
// patch rather than a polka dot.
function traceBlob(ctx, centerX, centerZ, radiusX, radiusZ, random) {
  const lumps = 3 + Math.floor(random() * 3);
  const lumpPhase = random() * Math.PI * 2;
  const points = 28;
  ctx.beginPath();
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const wobble = 1 + 0.22 * Math.sin(angle * lumps + lumpPhase) + 0.08 * Math.sin(angle * 7 + lumpPhase * 2);
    ctx.lineTo(centerX + Math.cos(angle) * radiusX * wobble, centerZ + Math.sin(angle) * radiusZ * wobble);
  }
  ctx.closePath();
}

function paintPatches(ctx, variety, random) {
  // Everything here is clipped to the body so patches never spill onto water.
  ctx.save();
  traceBodyPath(ctx);
  ctx.clip();

  if (variety.belly) {
    // Asagi: orange cheeks and flanks under a blue-grey back.
    ctx.fillStyle = variety.belly;
    for (const side of [1, -1]) {
      ctx.beginPath();
      ctx.ellipse(0.42 * side, -0.1, 0.14, 1.7, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.beginPath();
    ctx.ellipse(0, 1.3, 0.4, 0.3, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  if (variety.coverage > 0) {
    // Big patches march down the back, like the kohaku in the reference:
    // often one on the head, then a few along the body.
    const patchCount = 3 + Math.floor(random() * 3);
    for (let i = 0; i < patchCount; i++) {
      const color = variety.patches[i % variety.patches.length];
      const z = lerp(1.15, -1.4, (i + random() * 0.6) / patchCount);
      const x = (random() - 0.5) * 0.45;
      const size = (0.13 + random() * 0.17) * (0.6 + variety.coverage);
      if (random() < 0.85) {
        ctx.fillStyle = color;
        traceBlob(ctx, x, z, size * 1.0, size * 1.35, random);
        ctx.fill();
      }
    }
    // A few small "freckles", also from the reference.
    const freckles = 3 + Math.floor(random() * 4);
    ctx.fillStyle = variety.patches[0];
    for (let i = 0; i < freckles; i++) {
      traceBlob(ctx, (random() - 0.5) * 0.6, lerp(0.6, -1.5, random()), 0.045, 0.06, random);
      ctx.fill();
    }
  }

  if (variety.headSpot) {
    // Tancho: one round red spot on the head (the Japanese flag koi).
    ctx.fillStyle = variety.headSpot;
    traceBlob(ctx, 0, 0.95, 0.17, 0.17, () => 0.3);
    ctx.fill();
  }

  if (variety.inkSpots) {
    ctx.fillStyle = '#1b1c1f';
    for (let i = 0; i < variety.inkSpots; i++) {
      const size = 0.04 + random() * 0.08;
      traceBlob(ctx, (random() - 0.5) * 0.6, lerp(0.7, -1.5, random()), size, size * 1.3, random);
      ctx.fill();
    }
  }

  if (variety.net) {
    // Reticulated scales: rows of small arcs, darker than the base colour.
    ctx.strokeStyle = 'rgba(20, 25, 35, 0.28)';
    ctx.lineWidth = 0.014;
    for (let z = 0.75; z > KOI_STALK_Z; z -= 0.13) {
      const offset = Math.round((0.75 - z) / 0.13) % 2 === 0 ? 0 : 0.065;
      for (let x = -0.5 + offset; x < 0.5; x += 0.13) {
        ctx.beginPath();
        ctx.arc(x, z, 0.07, Math.PI * 0.15, Math.PI * 0.85);
        ctx.stroke();
      }
    }
  }

  // ROUNDNESS: darker toward the edges, a pale stripe along the spine. From
  // above this is all the "3D" a flat drawing needs to look plump.
  const sideShade = ctx.createLinearGradient(-0.5, 0, 0.5, 0);
  sideShade.addColorStop(0, 'rgba(30, 30, 40, 0.28)');
  sideShade.addColorStop(0.3, 'rgba(30, 30, 40, 0.0)');
  sideShade.addColorStop(0.5, variety.sheen ? 'rgba(255, 255, 230, 0.35)' : 'rgba(255, 255, 255, 0.08)');
  sideShade.addColorStop(0.7, 'rgba(30, 30, 40, 0.0)');
  sideShade.addColorStop(1, 'rgba(30, 30, 40, 0.28)');
  ctx.fillStyle = sideShade;
  ctx.fillRect(-0.6, KOI_STALK_Z, 1.2, KOI_NOSE_Z - KOI_STALK_Z);

  ctx.restore();
}

function drawHead(ctx) {
  // Eyes sit right on the outline, like the reference.
  ctx.fillStyle = '#16171a';
  for (const side of [1, -1]) {
    ctx.beginPath();
    ctx.ellipse(0.23 * side, 1.08, 0.045, 0.065, 0.3 * side, 0, Math.PI * 2);
    ctx.fill();
  }

  // Whiskers (barbels): two curly ink lines from each corner of the mouth.
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.02;
  ctx.lineCap = 'round';
  for (const side of [1, -1]) {
    ctx.beginPath();
    ctx.moveTo(0.1 * side, 1.44);
    ctx.bezierCurveTo(0.18 * side, 1.62, 0.3 * side, 1.66, 0.38 * side, 1.56);
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(0.06 * side, 1.47);
    ctx.quadraticCurveTo(0.1 * side, 1.62, 0.2 * side, 1.7);
    ctx.stroke();
  }
}

function drawDorsalFin(ctx, variety) {
  // From above the dorsal fin is just a thin strip down the spine.
  ctx.beginPath();
  ctx.moveTo(0, 0.35);
  ctx.quadraticCurveTo(0.045, -0.4, 0.01, -1.3);
  ctx.lineTo(-0.01, -1.3);
  ctx.quadraticCurveTo(-0.045, -0.4, 0, 0.35);
  ctx.closePath();
  ctx.fillStyle = variety.fin;
  ctx.globalAlpha = 0.4;
  ctx.fill();
  ctx.globalAlpha = 0.6;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.012;
  ctx.stroke();
}

function paintKoi(ctx, variety, random) {
  ctx.lineJoin = 'round';
  drawTail(ctx, variety);

  traceBodyPath(ctx);
  ctx.fillStyle = variety.base;
  ctx.fill();
  paintPatches(ctx, variety, random);

  traceBodyPath(ctx);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.03;
  ctx.stroke();

  drawDorsalFin(ctx, variety);
  drawHead(ctx);
}

/**
 * Paint all 16 koi into one canvas. Returns the canvas and, per cell, which
 * variety it holds (so fins can be tinted to match).
 */
function paintKoiAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = CELL_WIDTH_PX * ATLAS_COLUMNS;
  canvas.height = CELL_HEIGHT_PX * ATLAS_ROWS;
  const ctx = canvas.getContext('2d');
  const random = createSeededRandom(9003);

  const cellVarieties = [];
  for (const variety of koiVarieties) {
    for (let i = 0; i < variety.cells; i++) {
      cellVarieties.push(variety);
    }
  }

  cellVarieties.forEach((variety, cellIndex) => {
    const column = cellIndex % ATLAS_COLUMNS;
    const row = Math.floor(cellIndex / ATLAS_COLUMNS);
    ctx.save();
    // Move the origin to the fish's (0, 0) inside this cell, then scale so
    // 1 unit = PIXELS_PER_UNIT pixels. The NEGATIVE y-scale flips the canvas
    // so +z (the nose) is at the top of the cell.
    ctx.setTransform(
      PIXELS_PER_UNIT, 0,
      0, -PIXELS_PER_UNIT,
      column * CELL_WIDTH_PX + CELL_WIDTH_PX / 2,
      row * CELL_HEIGHT_PX + CARD_FRONT_Z * PIXELS_PER_UNIT,
    );
    paintKoi(ctx, variety, random);
    ctx.restore();
  });

  return { canvas, cellVarieties };
}

/** One shared fin picture: hinge on the left edge, fin points to +u. */
function paintFinTexture() {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  // Local fin units: u 0..1 along the fin, v -0.5..0.5 across it.
  ctx.setTransform(size * 0.94, 0, 0, -size * 0.94, size * 0.03, size / 2);

  const traceFin = () => {
    ctx.beginPath();
    ctx.moveTo(0, 0.14);
    // Leading edge (front, +v) is firm and straight-ish...
    ctx.quadraticCurveTo(0.55, 0.32, 0.98, 0.12);
    // ...the trailing edge is soft and scalloped.
    const scallops = 5;
    for (let i = 1; i <= scallops; i++) {
      const t = i / scallops;
      const x = lerp(0.98, 0.12, t);
      const y = lerp(0.12, -0.2, t) - 0.18 * Math.sin(t * Math.PI);
      ctx.quadraticCurveTo(x + 0.06, y - 0.04, x, y);
    }
    ctx.quadraticCurveTo(0.03, -0.12, 0, -0.08);
    ctx.closePath();
  };

  traceFin();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.78)';
  ctx.fill();

  ctx.save();
  traceFin();
  ctx.clip();
  ctx.strokeStyle = INK;
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = 0.014;
  for (let i = 0; i < 8; i++) {
    const t = i / 7;
    ctx.beginPath();
    ctx.moveTo(0, 0.04);
    ctx.quadraticCurveTo(0.45, lerp(0.22, -0.05, t), lerp(1.0, 0.25, t), lerp(0.14, -0.42, t));
    ctx.stroke();
  }
  ctx.restore();

  traceFin();
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.022;
  ctx.stroke();
  return canvas;
}

// ===========================================================================
// GEOMETRY — one mesh per koi made of:
//   4 fins (pectoral L/R, pelvic L/R) drawn FIRST so the body covers their roots,
//   then the body "card": a grid 6 wide x 48 long. More rows along the length
//   = a smoother bend; across the width a few columns are enough.
//
// Every vertex carries aFin = (hingeX, hingeZ, side, kind):
//   kind 0 = body, 1 = pectoral fin, 2 = pelvic fin.
// For fins, `position` is NOT the final place: x = distance along the fin,
// z = distance across it. The shader swings it around the hinge each frame.
// ===========================================================================
const BODY_COLUMNS = 6;
const BODY_ROWS = 48;
const FIN_SEGMENTS = 5;

const finLayouts = [
  // kind, hingeX, hingeZ, length, width
  { kind: 1, hingeX: 0.26, hingeZ: 0.62, length: 0.85, width: 0.62 },
  { kind: 2, hingeX: 0.14, hingeZ: -0.75, length: 0.5, width: 0.36 },
];

function createKoiGeometry() {
  const positions = [];
  const uvs = [];
  const finData = [];
  const indices = [];

  function addGrid(columns, rows, vertexAt) {
    const firstVertex = positions.length / 3;
    for (let row = 0; row <= rows; row++) {
      for (let column = 0; column <= columns; column++) {
        vertexAt(column / columns, row / rows);
      }
    }
    for (let row = 0; row < rows; row++) {
      for (let column = 0; column < columns; column++) {
        const a = firstVertex + row * (columns + 1) + column;
        const b = a + columns + 1;
        indices.push(a, b, a + 1, a + 1, b, b + 1);
      }
    }
  }

  for (const fin of finLayouts) {
    for (const side of [1, -1]) {
      addGrid(FIN_SEGMENTS, 1, (alongFin, acrossFin) => {
        // Start a little INSIDE the body so the root is hidden under it.
        positions.push(lerp(-0.08, fin.length, alongFin), -0.02, (acrossFin - 0.5) * fin.width);
        uvs.push(alongFin, acrossFin);
        finData.push(fin.hingeX * side, fin.hingeZ, side, fin.kind);
      });
    }
  }

  addGrid(BODY_COLUMNS, BODY_ROWS, (u, v) => {
    positions.push(lerp(-CARD_HALF_WIDTH, CARD_HALF_WIDTH, u), 0, lerp(CARD_BACK_Z, CARD_FRONT_Z, v));
    // v = 1 at the nose end = the TOP of the cell in the canvas (CanvasTexture
    // flips rows on upload, so canvas-top becomes v = 1).
    uvs.push(u, v);
    finData.push(0, 0, 0, 0);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setAttribute('aFin', new THREE.Float32BufferAttribute(finData, 4));
  geometry.setIndex(indices);
  return geometry;
}

// ---------------------------------------------------------------------------
// SWIM — shared by the koi and by its floor shadow (shadows.js), so the dark
// shape bends exactly like the fish.
//
// Per-fish values come in through `aSwim` (written by flock.js every frame):
//   aSwim.x  phase      — the wave's clock (radians, keeps growing)
//   aSwim.y  wiggle     — amplitude multiplier (bigger when fast)
//   aSwim.z  turnBend   — -1..1, how hard the fish is turning (and which way)
//   aSwim.w  speedRatio — 0..1 of max speed (folds the fins back)
// ---------------------------------------------------------------------------
export const fishWaveUniforms = {
  uAmplitude: { value: 0.3 },
  uWavelength: { value: 4.2 },
  uMood: { value: 0 },
  uTurnBend: { value: 0.075 },
};

export const fishWaveSettings = {
  speed: 5.0,
  moodSpeedMul: 1.0,
};

export const koiWaveGlsl = /* glsl */ `
  uniform float uAmplitude;
  uniform float uWavelength;
  uniform float uMood;
  uniform float uTurnBend;
  attribute vec4 aSwim;
  attribute vec4 aFin;

  // SPINE: where is the fish's centre line at body position z?
  // (Sideways offset only; the rest of the body hangs off this line.)
  float koiSpineX(float z) {
    // 0 at the nose, 1 at the tail tip.
    float alongBody = clamp((${KOI_NOSE_Z.toFixed(2)} - z) / ${(KOI_NOSE_Z - KOI_TAIL_TIP_Z).toFixed(2)}, 0.0, 1.0);

    // ENVELOPE: how much this part of the body is allowed to move. Small at
    // the head (it only shivers a little), growing fast toward the tail.
    float envelope = 0.08 + 0.92 * alongBody * alongBody;

    // TRAVELLING WAVE: sin(z * waveNumber + phase). As phase grows, a crest
    // that was at z moves to smaller z — i.e. the wave runs from head to tail.
    float waveNumber = 6.28318530718 / uWavelength;
    float moodAmplitude = mix(0.85, 1.35, uMood);
    float wave = sin(z * waveNumber + aSwim.x) * envelope * uAmplitude * moodAmplitude * aSwim.y;

    // TAIL FLUTTER: a faster, smaller ripple that only lives in the tail, a
    // little behind the main wave → the silky tail "follows" the body.
    float tailOnly = smoothstep(-1.4, ${KOI_TAIL_TIP_Z.toFixed(2)}, z);
    float flutter = sin(z * 5.0 + aSwim.x * 1.6 - 1.2) * 0.07 * tailOnly * aSwim.y;

    // TURN BEND: a parabola (z - pivot)^2 is 0 at the pivot and grows both
    // ways, so head and tail both lean into the turn → the body makes a "C".
    float fromPivot = z - 0.35;
    float turn = aSwim.z * uTurnBend * fromPivot * fromPivot;

    return wave + flutter + turn;
  }

  // Bend a point (x across, z along) onto the curved spine. We don't just
  // slide it sideways (that would shear the drawing); we step along the
  // spine's NORMAL (the direction perpendicular to the curve) so the body
  // keeps its width while it curves.
  vec2 koiBendPoint(float x, float z, float anchorZ) {
    float spineX = koiSpineX(anchorZ);
    // Slope of the spine = how much x changes per unit z (finite difference:
    // sample just in front and just behind, divide by the gap).
    float slope = (koiSpineX(anchorZ + 0.02) - koiSpineX(anchorZ - 0.02)) / 0.04;
    vec2 tangent = normalize(vec2(slope, 1.0)); // along the body (x, z)
    vec2 normal = vec2(tangent.y, -tangent.x);  // 90° turned → across the body
    return vec2(spineX, anchorZ) + normal * x + tangent * (z - anchorZ);
  }

  // Full koi vertex: body follows the spine; fins swing around their hinge,
  // then ride along with the spine at that hinge.
  vec3 koiSwimPosition(vec3 localPosition) {
    float kind = aFin.w;
    if (kind < 0.5) {
      vec2 bent = koiBendPoint(localPosition.x, localPosition.z, localPosition.z);
      return vec3(bent.x, localPosition.y, bent.y);
    }

    float side = aFin.z;
    float alongFin = localPosition.x;
    float acrossFin = localPosition.z;
    float isPectoral = step(kind, 1.5);
    float finLength = mix(0.5, 0.85, isPectoral);

    // FIN ANGLE (0 = sticking straight out sideways, bigger = swept back).
    //  - fast fish fold their fins back against the body, slow ones spread;
    //  - fins row slowly (half the tail-beat speed), left and right a bit
    //    out of step;
    //  - the fin on the inside of a turn opens wide, like a brake.
    float spread = mix(0.55, 1.15, aSwim.w) + mix(0.15, 0.0, isPectoral);
    float rowing = sin(aSwim.x * 0.5 + side * 0.6 + kind) * mix(0.18, 0.3, isPectoral);
    float brake = max(0.0, side * aSwim.z) * 0.55 * isPectoral;
    float finAngle = spread + rowing - brake;
    // The soft fin edge trails a bit more toward the tip (it bends in water).
    float tipT = clamp(alongFin / finLength, 0.0, 1.0);
    finAngle += 0.25 * tipT * tipT * sin(aSwim.x * 0.5 + side * 0.6 + kind - 1.3);

    // Rotate the fin's own (along, across) axes into the fish's (x, z).
    // For side = +1 "out" is +x; for side = -1 we mirror x.
    vec2 outward = vec2(side * cos(finAngle), -sin(finAngle));
    vec2 forward = vec2(side * sin(finAngle), cos(finAngle));
    vec2 finPoint = aFin.xy + outward * alongFin + forward * acrossFin;

    vec2 bent = koiBendPoint(finPoint.x, finPoint.y, aFin.y);
    return vec3(bent.x, localPosition.y, bent.y);
  }
`;

// Shared by koi and shadow: pick the right picture (body atlas cell or fin).
export const koiTextureGlsl = /* glsl */ `
  uniform sampler2D uKoiAtlas;
  uniform sampler2D uFinTexture;
  uniform vec2 uAtlasGrid; // (columns, rows)

  vec4 koiSample(vec2 uv, vec2 atlasCell, float kind, float mipBias) {
    if (kind > 0.5) {
      return texture2D(uFinTexture, uv, mipBias);
    }
    // Cell (column, row) counted from the TOP-left in the canvas; texture v
    // runs bottom-up, so flip the row.
    vec2 cellOrigin = vec2(atlasCell.x, uAtlasGrid.y - 1.0 - atlasCell.y);
    return texture2D(uKoiAtlas, (cellOrigin + uv) / uAtlasGrid, mipBias);
  }
`;

const koiVertexShader = /* glsl */ `
  ${koiWaveGlsl}
  attribute vec2 aAtlasCell;
  attribute vec3 aFinTint;
  varying vec2 vUv;
  varying vec2 vAtlasCell;
  varying vec3 vFinTint;
  varying float vKind;

  void main() {
    vUv = uv;
    vAtlasCell = aAtlasCell;
    vFinTint = aFinTint;
    vKind = aFin.w;

    vec3 transformed = koiSwimPosition(position);
    #include <project_vertex>
  }
`;

const koiFragmentShader = /* glsl */ `
  ${koiTextureGlsl}
  varying vec2 vUv;
  varying vec2 vAtlasCell;
  varying vec3 vFinTint;
  varying float vKind;

  void main() {
    vec4 painted = koiSample(vUv, vAtlasCell, vKind, 0.0);
    if (painted.a < 0.02) discard; // empty corners of the picture rectangle
    vec3 color = painted.rgb;
    if (vKind > 0.5) {
      color *= vFinTint; // white fin x variety colour; ink stays dark
    }
    gl_FragColor = vec4(color, painted.a);
  }
`;

let sharedGeometry = null;
let sharedMaterial = null;
let sharedCellVarieties = null;

function ensureSharedFishAssets() {
  if (sharedGeometry !== null) {
    return;
  }
  sharedGeometry = createKoiGeometry();

  const atlas = paintKoiAtlas();
  sharedCellVarieties = atlas.cellVarieties;
  // CanvasTexture = "upload this canvas to the GPU as a picture". Mipmaps
  // (pre-shrunk copies) keep the thin ink lines from sparkling when a big
  // 768px drawing is shown only ~100px tall.
  const atlasTexture = new THREE.CanvasTexture(atlas.canvas);
  atlasTexture.anisotropy = 4;
  const finTexture = new THREE.CanvasTexture(paintFinTexture());

  koiTextureUniforms.uKoiAtlas.value = atlasTexture;
  koiTextureUniforms.uFinTexture.value = finTexture;

  sharedMaterial = new THREE.ShaderMaterial({
    uniforms: { ...fishWaveUniforms, ...koiTextureUniforms },
    vertexShader: koiVertexShader,
    fragmentShader: koiFragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
    // No depth writes: koi are drawn one after another like paper cutouts
    // laid on a table. With depth writes, a see-through tail would punch a
    // hole through any koi drawn after it.
    depthWrite: false,
  });
}

// Uniform objects shared (same object, not a copy) with shadows.js.
export const koiTextureUniforms = {
  uKoiAtlas: { value: null },
  uFinTexture: { value: null },
  uAtlasGrid: { value: new THREE.Vector2(ATLAS_COLUMNS, ATLAS_ROWS) },
};

export function createFishInstancedMesh(instanceCount) {
  ensureSharedFishAssets();

  const swimState = new Float32Array(instanceCount * 4); // see aSwim above
  const swimPhaseRates = new Float32Array(instanceCount);
  const atlasCells = new Float32Array(instanceCount * 2);
  const finTints = new Float32Array(instanceCount * 3);
  const scratchColor = new THREE.Color();
  const cellCount = sharedCellVarieties.length;

  for (let i = 0; i < instanceCount; i++) {
    swimState[i * 4 + 0] = Math.random() * Math.PI * 2;
    swimState[i * 4 + 1] = 1;
    swimPhaseRates[i] = 0.85 + Math.random() * 0.3;

    // Cycle through cells first so every picture shows up before any repeats.
    const cellIndex = i < cellCount ? i : Math.floor(Math.random() * cellCount);
    atlasCells[i * 2 + 0] = cellIndex % ATLAS_COLUMNS;
    atlasCells[i * 2 + 1] = Math.floor(cellIndex / ATLAS_COLUMNS);
    scratchColor.set(sharedCellVarieties[cellIndex].fin).toArray(finTints, i * 3);
  }

  const swimAttribute = new THREE.InstancedBufferAttribute(swimState, 4);
  swimAttribute.setUsage(THREE.DynamicDrawUsage);

  sharedGeometry.setAttribute('aSwim', swimAttribute);
  sharedGeometry.setAttribute('aAtlasCell', new THREE.InstancedBufferAttribute(atlasCells, 2));
  sharedGeometry.setAttribute('aFinTint', new THREE.InstancedBufferAttribute(finTints, 3));

  const mesh = new THREE.InstancedMesh(sharedGeometry, sharedMaterial, instanceCount);
  mesh.frustumCulled = false;
  mesh.userData.swimState = swimState;
  mesh.userData.swimPhaseRates = swimPhaseRates;
  mesh.userData.swimAttribute = swimAttribute;
  return mesh;
}
