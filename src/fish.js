// fish.js - builds the koi (phase 9; replaces the salmon of step 8.3).
//
// UNITS: a koi is about 4.6 units long at scale 1 (nose at z = +1.5, tail
// tip at about z = -3.1). The flock scales each fish 0.75x .. 1.25x.
//
// ===========================================================================
// FORWARD DIRECTION CONVENTION  (decided in step 1.3 - never change this!)
//
//   In the fish's LOCAL space:
//     +Z = FORWARD (the nose points this way, the tail trails towards -Z)
//     +Y = UP      (the back of the fish; the belly is -Y)
//     +X = the fish's LEFT side (-X is its right side)
//
//   Object3D.lookAt(target) turns an object so its local +Z faces the
//   target, so with the nose on +Z, "face where you swim" needs no extra
//   rotation maths. The flock (flock.js) depends on this.
// ===========================================================================
//
// DESIGNED FOR A CAMERA LOOKING STRAIGHT DOWN (step 8.1). We only ever see
// the koi from above, like the reference painting, so:
//   - the body's TOP-DOWN outline (its width) matters most: round head,
//     broad shoulders, long taper to a narrow tail stalk;
//   - the long "butterfly koi" fins and tail are laid out nearly FLAT
//     (horizontal). On a real fish the tail is upright, but from above an
//     upright tail is just a thin line. Flat fins read as the flowing white
//     veils you see in the painting.
//
// TWO MESHES PER KOI, BOTH INSTANCED (one draw call each):
//   1. BODY  - opaque. Its colour pattern (white + red patches, gold, ...)
//              is painted by the fragment shader per fish (see KOI VARIETIES).
//   2. FINS  - see-through white veils (tail, pectoral, pelvic, dorsal).
//              Transparent things must be drawn separately from opaque ones,
//              hence a second mesh. It SHARES the body's instanceMatrix, so
//              flock.js only moves the body and the fins follow for free.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// BODY SHAPE
// ---------------------------------------------------------------------------
export const KOI_NOSE_Z = 1.5;
export const KOI_STALK_Z = -1.65; // narrow "wrist" where the tail fin starts
const KOI_WIDEST_T = 0.32; // widest point, as a fraction from nose (0) to stalk (1)
const KOI_MAX_HALF_WIDTH = 0.46; // sideways (x) - what we see from above
const KOI_MAX_HALF_HEIGHT = 0.4; // up/down (y)
const KOI_STALK_FRACTION = 0.15; // stalk is 15% as thick as the shoulders

const TAIL_ROOT_Z = -1.45; // the tail fin starts a bit inside the stalk (no gap)
const TAIL_LENGTH = 1.65;
export const KOI_TAIL_TIP_Z = TAIL_ROOT_Z - TAIL_LENGTH; // = -3.1

const RINGS = 48; // slices along the body
const SIDES = 18; // points around each slice

function smoothstep01(t) {
  // 3t^2 - 2t^3: an S-curve from 0 to 1 that starts and ends gently.
  return t * t * (3 - 2 * t);
}

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

/**
 * Body thickness profile: 0 at the nose, 1 at the shoulders, 0.15 at the stalk.
 * t = 0 at the nose .. 1 at the tail stalk.
 */
function koiProfile(t) {
  if (t < KOI_WIDEST_T) {
    // HEAD: a quarter ellipse. sqrt(1 - (1-k)^2) rises steeply at the very
    // front and flattens toward the shoulders = a blunt, rounded koi head
    // (not the pointy snout of the salmon).
    const k = t / KOI_WIDEST_T;
    return Math.sqrt(1 - (1 - k) * (1 - k));
  }
  // BODY -> STALK: pow(k, 1.4) stays close to 0 for a while, so the body
  // keeps its fullness through the middle and slims mostly toward the tail.
  const k = (t - KOI_WIDEST_T) / (1 - KOI_WIDEST_T);
  return lerp(1, KOI_STALK_FRACTION, Math.pow(k, 1.4));
}

function getHalfSizeAtZ(z) {
  const t = clamp01((KOI_NOSE_Z - z) / (KOI_NOSE_Z - KOI_STALK_Z));
  const profile = koiProfile(t);
  return { halfWidth: KOI_MAX_HALF_WIDTH * profile, halfHeight: KOI_MAX_HALF_HEIGHT * profile };
}

/**
 * Body tube + 2 eyes, merged by hand. Extra per-vertex attribute:
 *   koiPart: 0 = body skin, 1 = eye (the shader paints eyes dark).
 */
function createBodyGeometry() {
  const positions = [];
  const parts = [];
  const indices = [];

  for (let ring = 0; ring <= RINGS; ring++) {
    const z = lerp(KOI_NOSE_Z, KOI_STALK_Z, ring / RINGS);
    let { halfWidth, halfHeight } = getHalfSizeAtZ(z);
    if (ring === RINGS) {
      // The last ring gets zero width: its sides meet in an upright line that
      // closes the tube (the tail fin covers it). The nose ring is already a
      // point because koiProfile(0) = 0.
      halfWidth = 0;
    }
    for (let side = 0; side < SIDES; side++) {
      // A point on an ellipse: cos -> sideways, sin -> up/down.
      const angle = (side / SIDES) * Math.PI * 2;
      // A koi is a little flatter underneath than on top: shrink the lower
      // half (sin < 0) by 15%.
      const belly = Math.sin(angle) < 0 ? 0.85 : 1;
      positions.push(Math.cos(angle) * halfWidth, Math.sin(angle) * halfHeight * belly, z);
      parts.push(0);
    }
  }

  // Connect neighbouring rings with 2 triangles per quad, counter-clockwise
  // seen from outside (Three.js draws only that side by default).
  for (let ring = 0; ring < RINGS; ring++) {
    for (let side = 0; side < SIDES; side++) {
      const nextSide = (side + 1) % SIDES;
      const a = ring * SIDES + side;
      const b = ring * SIDES + nextSide;
      const c = (ring + 1) * SIDES + side;
      const d = (ring + 1) * SIDES + nextSide;
      indices.push(a, c, b, b, c, d);
    }
  }

  // EYES: small spheres half-sunk into each side of the head. We copy the
  // sphere's points into our own arrays so body + eyes stay ONE geometry.
  for (const sideSign of [1, -1]) {
    const eye = new THREE.SphereGeometry(0.075, 10, 8);
    eye.translate(sideSign * 0.32, 0.12, 1.12);
    const firstIndex = positions.length / 3;
    const eyePositions = eye.attributes.position.array;
    for (let i = 0; i < eyePositions.length; i++) {
      positions.push(eyePositions[i]);
    }
    for (let i = 0; i < eye.attributes.position.count; i++) {
      parts.push(1);
    }
    const eyeIndices = eye.index.array;
    for (let i = 0; i < eyeIndices.length; i++) {
      indices.push(firstIndex + eyeIndices[i]);
    }
    eye.dispose();
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('koiPart', new THREE.Float32BufferAttribute(parts, 1));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// FINS - each fin is a small GRID of points (rows along its length, columns
// across), not just a few triangles, so the vertex shader can bend it into
// smooth flowing curves. Every vertex remembers where it sits on its fin:
//   aFinInfo = (u, v, kind, side)
//     u    = across the fin, -1 .. +1
//     v    = from the root (0, attached to the body) to the free edge (1)
//     kind = 0 tail, 1 pectoral, 2 pelvic, 3 dorsal
//     side = +1 left fin, -1 right fin, 0 for the middle fins
// ---------------------------------------------------------------------------
const FIN_KIND_TAIL = 0;
const FIN_KIND_PECTORAL = 1;
const FIN_KIND_PELVIC = 2;
const FIN_KIND_DORSAL = 3;

/** Builds one fin from a function placing (u, v) in fish space. */
function addFinGrid(target, columns, rows, kind, side, placePoint) {
  const firstIndex = target.positions.length / 3;
  for (let row = 0; row <= rows; row++) {
    const v = row / rows;
    for (let column = 0; column <= columns; column++) {
      const u = (column / columns) * 2 - 1;
      const point = placePoint(u, v);
      target.positions.push(point.x, point.y, point.z);
      target.finInfo.push(u, v, kind, side);
    }
  }
  const rowLength = columns + 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = firstIndex + row * rowLength + column;
      const b = a + 1;
      const c = a + rowLength;
      const d = c + 1;
      target.indices.push(a, c, b, b, c, d);
    }
  }
}

function createFinGeometry() {
  const target = { positions: [], finInfo: [], indices: [] };
  const point = new THREE.Vector3();

  // TAIL: a wide flat fan. halfSpread grows from the narrow root to the full
  // width (smoothstep = soft flare). The trailing edge is a shallow "V": the
  // middle (u = 0) is 80% as long as the outer lobes (|u| = 1), which gives
  // the two flowing tail lobes of the painting.
  addFinGrid(target, 10, 12, FIN_KIND_TAIL, 0, (u, v) => {
    const halfSpread = 0.1 + 0.9 * smoothstep01(clamp01(v / 0.7));
    const lobeLength = 0.8 + 0.2 * Math.pow(Math.abs(u), 0.8);
    // Lobe tips curl slightly inward so the outline is rounded, not square.
    const tipCurl = 1 - 0.18 * v * v * Math.abs(u);
    return point.set(u * halfSpread * tipCurl, 0.02 - 0.1 * v, TAIL_ROOT_Z - v * TAIL_LENGTH * lobeLength);
  });

  // PECTORAL FINS: the big "wings" behind the head of a butterfly koi. Each
  // grows from a root on the side of the body, outward and backward. Their
  // width bulges in the middle (a sine hump) and rounds off at the tip.
  for (const side of [1, -1]) {
    const root = new THREE.Vector3(side * 0.3, -0.12, 0.55);
    const outward = new THREE.Vector3(side * 0.78, -0.1, -0.62).normalize();
    // "across" = outward turned 90 degrees in the flat x/z plane.
    const across = new THREE.Vector3(-outward.z, 0, outward.x).multiplyScalar(side);
    addFinGrid(target, 6, 8, FIN_KIND_PECTORAL, side, (u, v) => {
      const halfWidth = 0.3 * Math.pow(Math.sin(Math.PI * (0.15 + 0.8 * v)), 0.6);
      point.copy(root).addScaledVector(outward, 1.0 * v).addScaledVector(across, u * halfWidth);
      point.y -= 0.1 * v * v; // the tip droops a little, like a soft veil
      return point;
    });
  }

  // PELVIC FINS: a smaller pair further back under the belly.
  for (const side of [1, -1]) {
    const root = new THREE.Vector3(side * 0.2, -0.22, -0.4);
    const outward = new THREE.Vector3(side * 0.55, -0.15, -0.82).normalize();
    const across = new THREE.Vector3(-outward.z, 0, outward.x).multiplyScalar(side);
    addFinGrid(target, 4, 6, FIN_KIND_PELVIC, side, (u, v) => {
      const halfWidth = 0.17 * Math.pow(Math.sin(Math.PI * (0.15 + 0.8 * v)), 0.6);
      return point.copy(root).addScaledVector(outward, 0.6 * v).addScaledVector(across, u * halfWidth);
    });
  }

  // DORSAL FIN: an upright veil along the back. From straight above it shows
  // as a soft pale ridge line, which is exactly how the painting draws it.
  // Here u runs along the back (-1 front .. +1 rear) and v goes upward.
  addFinGrid(target, 12, 3, FIN_KIND_DORSAL, 0, (u, v) => {
    const along = (u + 1) * 0.5; // 0 front .. 1 rear
    const z = lerp(0.35, -1.0, along);
    const backTop = getHalfSizeAtZ(z).halfHeight - 0.04;
    const finHeight = 0.32 * Math.sin(Math.PI * (0.1 + 0.85 * along));
    // The fin sweeps back as it rises (z shifts toward the tail with v).
    return point.set(0, backTop + v * finHeight, z - 0.18 * v);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(target.positions, 3));
  geometry.setAttribute('aFinInfo', new THREE.Float32BufferAttribute(target.finInfo, 4));
  geometry.setIndex(target.indices);
  geometry.computeVertexNormals();
  return geometry;
}

// ---------------------------------------------------------------------------
// THE SWIM WAVE (step 2.5, reshaped for the koi)
// A travelling sine wave bends the body sideways: sin(z * k + phase), with
// k = 2*PI / wavelength. tailWeight keeps the head still and lets the tail
// swing most. This GLSL is shared by the body, the fins AND the shadows
// (shadows.js), so all three bend exactly together.
// ---------------------------------------------------------------------------
export const fishWaveUniforms = {
  uAmplitude: { value: 0.4 }, // how far the tail tip swings, world units
  uWavelength: { value: 4.6 }, // one lazy S-curve along the whole koi
  uMood: { value: 0 }, // 0 calm .. 1 panic (set from mood in main.js)
};

// Base wave travel speed (rad/s). flock.js advances each fish's phase.
export const fishWaveSettings = {
  speed: 7.0, // koi swim more slowly and gracefully than salmon
  moodSpeedMul: 1.0,
};

const WAVE_HEAD_Z = 0.9; // in front of this the head stays perfectly still

export const koiWaveGlsl = /* glsl */ `
  uniform float uAmplitude;
  uniform float uWavelength;
  uniform float uMood;
  attribute float aPhase;
  attribute float aWiggleMul;

  // 0 at the head, 1 at the tail tip (S-curve in between).
  float koiTailWeight(float z) {
    return 1.0 - smoothstep(${KOI_TAIL_TIP_Z.toFixed(2)}, ${WAVE_HEAD_Z.toFixed(2)}, z);
  }

  // Sideways offset of the body centre line at local z.
  float koiBodyOffsetX(float z) {
    float waveNumber = 6.28318530718 / uWavelength;
    float moodAmplitude = mix(0.72, 1.55, uMood); // wider swing when panicking
    return sin(z * waveNumber + aPhase) * uAmplitude * moodAmplitude * koiTailWeight(z) * aWiggleMul;
  }
`;

// ---------------------------------------------------------------------------
// KOI VARIETIES - real koi breeds, picked at random per fish. Each fish gets
// three per-instance attributes the shaders read:
//   aKoiBase   = main skin colour (vec3)
//   aKoiPatch  = patch colour (vec3)
//   aKoiParams = (seed, coverage, sumi, tancho)
//      seed     random number: every fish gets a different patch layout
//      coverage 0..1 how much of the back the patches cover
//      sumi     1 = add small black "sumi" spots (Sanke koi)
//      tancho   1 = one round red spot on the head only (Tancho koi)
// THREE.Color('#hex') converts screen colours into the LINEAR colour space
// the lit materials work in, so the hex values look as written.
// ---------------------------------------------------------------------------
const koiVarieties = [
  // Kohaku: white with big red-orange patches (both koi in the reference).
  { weight: 0.36, base: '#f4f0e6', patch: ['#e04a22', '#f06a2e'], coverage: [0.45, 0.65], sumi: 0, tancho: 0 },
  // Sanke: like Kohaku plus small black spots.
  { weight: 0.18, base: '#f4f0e6', patch: ['#e3532a', '#ee6630'], coverage: [0.38, 0.55], sumi: 1, tancho: 0 },
  // Tancho: pure white with a single red circle on the head.
  { weight: 0.1, base: '#f6f3ec', patch: ['#d9301c', '#e23a22'], coverage: [0, 0], sumi: 0, tancho: 1 },
  // Yamabuki ogon: solid gold, with softly lighter patches.
  { weight: 0.14, base: '#f0a12c', patch: ['#f8c75c', '#fad27a'], coverage: [0.3, 0.45], sumi: 0, tancho: 0 },
  // Orange koi with white patches (the reverse of Kohaku).
  { weight: 0.22, base: '#ec7428', patch: ['#f6f1e6', '#f3ebdc'], coverage: [0.3, 0.45], sumi: 0, tancho: 0 },
];

function pickKoiVariety() {
  let roll = Math.random();
  for (const variety of koiVarieties) {
    roll -= variety.weight;
    if (roll <= 0) {
      return variety;
    }
  }
  return koiVarieties[0];
}

// ---------------------------------------------------------------------------
// BODY MATERIAL - MeshStandardMaterial (so the koi get real light and shade),
// edited with onBeforeCompile (step 2.5) to:
//   vertex:   bend with the swim wave, pass the UNBENT local position along
//             so the pattern sticks to the skin while the body moves;
//   fragment: replace the flat colour with the koi pattern.
// ---------------------------------------------------------------------------
const koiPatternGlsl = /* glsl */ `
  // 3D value noise: like the 2D version in shaders/noise.js, but blending
  // the 8 corners of a cube. Lets the patches wrap around the round body.
  float koiHash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float koiNoise(vec3 p) {
    vec3 cell = floor(p);
    vec3 f = fract(p);
    vec3 w = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(koiHash(cell), koiHash(cell + vec3(1, 0, 0)), w.x),
          mix(koiHash(cell + vec3(0, 1, 0)), koiHash(cell + vec3(1, 1, 0)), w.x), w.y),
      mix(mix(koiHash(cell + vec3(0, 0, 1)), koiHash(cell + vec3(1, 0, 1)), w.x),
          mix(koiHash(cell + vec3(0, 1, 1)), koiHash(cell + vec3(1, 1, 1)), w.x), w.y),
      w.z);
  }
`;

function addKoiBodyShader(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fishWaveUniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         ${koiWaveGlsl}
         attribute float koiPart;
         attribute vec3 aKoiBase;
         attribute vec3 aKoiPatch;
         attribute vec4 aKoiParams;
         varying vec3 vKoiLocal;
         varying float vKoiPart;
         varying vec3 vKoiBase;
         varying vec3 vKoiPatch;
         varying vec4 vKoiParams;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         // Pass the pattern inputs to the fragment shader. 'varying' values
         // are blended across each triangle, one value per pixel.
         vKoiLocal = position; // BEFORE bending: the pattern rides on the skin
         vKoiPart = koiPart;
         vKoiBase = aKoiBase;
         vKoiPatch = aKoiPatch;
         vKoiParams = aKoiParams;
         transformed.x += koiBodyOffsetX(transformed.z);`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         ${koiPatternGlsl}
         varying vec3 vKoiLocal;
         varying float vKoiPart;
         varying vec3 vKoiBase;
         varying vec3 vKoiPatch;
         varying vec4 vKoiParams;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         vec3 p = vKoiLocal;
         float seed = vKoiParams.x;
         float coverage = vKoiParams.y;

         // Patches live on the back and upper sides; the belly stays the
         // base colour (p.y < 0 is the lower half of the body).
         float backMask = smoothstep(-0.22, 0.06, p.y);

         // PATCHES: two layers of noise (big blobs + a little detail).
         // Adding seed * 17 slides each fish to a different part of the
         // endless noise pattern = every koi has its own markings.
         vec3 q = p * vec3(2.1, 2.1, 1.5) + seed * 17.0;
         float patchNoise = koiNoise(q) * 0.7 + koiNoise(q * 2.3) * 0.3;
         // Koi patches very often cover the head: nudge the noise up there.
         patchNoise += 0.12 * smoothstep(0.5, 1.2, p.z);
         // More coverage = lower threshold = more of the noise counts as patch.
         float threshold = mix(0.72, 0.38, coverage);
         // Narrow smoothstep = crisp painted edge, not a blurry gradient.
         float patchAmount = smoothstep(threshold - 0.025, threshold + 0.025, patchNoise) * backMask;
         patchAmount *= step(0.001, coverage); // coverage 0 = no patches at all

         // TANCHO: a single round spot on top of the head (distance from a
         // point on the head, seen from above in x/z).
         float tanchoSpot = 1.0 - smoothstep(0.2, 0.23, length(p.xz - vec2(0.0, 0.92)));
         patchAmount = mix(patchAmount, tanchoSpot * backMask, vKoiParams.w);

         vec3 koiColor = mix(vKoiBase, vKoiPatch, patchAmount);

         // Watercolour touch: pigment darkens where a patch meets the base.
         float patchEdge = 1.0 - abs(patchAmount * 2.0 - 1.0);
         koiColor *= 1.0 - 0.12 * patchEdge;

         // SUMI: small black spots, only on Sanke (vKoiParams.z = 1).
         float sumiNoise = koiNoise(p * 5.5 + seed * 31.0);
         float sumi = smoothstep(0.8, 0.83, sumiNoise) * backMask * vKoiParams.z;
         koiColor = mix(koiColor, vec3(0.025, 0.03, 0.035), sumi);

         // Faint scale shimmer: a tight diamond grid made of two sine waves.
         float scaleGrid = sin(p.z * 34.0 + p.x * 26.0) * sin(p.z * 34.0 - p.x * 26.0);
         koiColor *= 1.0 - 0.035 * smoothstep(0.3, 1.0, scaleGrid);

         // Eyes are dark.
         koiColor = mix(koiColor, vec3(0.02), step(0.5, vKoiPart));

         diffuseColor.rgb = koiColor;`,
      );
  };
}

// ---------------------------------------------------------------------------
// FIN MATERIAL - transparent white veils that flow and flutter.
// ---------------------------------------------------------------------------
function addKoiFinShader(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, fishWaveUniforms);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         ${koiWaveGlsl}
         attribute vec4 aFinInfo;
         attribute vec3 aKoiBase;
         varying vec4 vFinInfo;
         varying vec3 vKoiBase;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vFinInfo = aFinInfo;
         vKoiBase = aKoiBase;
         float u = aFinInfo.x;
         float v = aFinInfo.y;
         float kind = aFinInfo.z;
         float side = aFinInfo.w;

         // 1) Every fin follows the body wave at its own z, so it stays
         //    attached to the body while the fish swims.
         float bodyShift = koiBodyOffsetX(transformed.z);

         if (kind < 0.5) {
           // TAIL: the same wave keeps travelling into the tail, but each row
           // lags behind the one before it (- 1.3 * v) and swings wider (v^2).
           // That delay is what makes a long veil look soft and flowing
           // instead of a stiff paddle.
           float trailing = sin(transformed.z * 6.2831853 / uWavelength + aPhase - 1.3 * v);
           bodyShift += trailing * 0.32 * v * v * aWiggleMul * mix(0.8, 1.4, uMood);
           // A gentle up/down ripple running across the veil.
           transformed.y += sin(aPhase * 0.6 + u * 2.5 + v * 3.0) * 0.07 * v;
         } else if (kind < 1.5) {
           // PECTORAL: slow paddling. The tip moves the most (times v).
           // side shifts the beat so left and right are not in lockstep.
           float paddle = sin(aPhase * 0.32 + side * 1.3);
           transformed.y += paddle * 0.2 * v;
           transformed.z += paddle * 0.08 * v;
         } else if (kind < 2.5) {
           // PELVIC: small flutter.
           transformed.y += sin(aPhase * 0.45 + side) * 0.08 * v;
         } else {
           // DORSAL: the top edge sways a little.
           bodyShift += sin(aPhase * 0.8 + u * 3.0) * 0.05 * v;
         }
         transformed.x += bodyShift;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec4 vFinInfo;
         varying vec3 vKoiBase;`,
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
         float u = vFinInfo.x;
         float v = vFinInfo.y;

         // Milky white veil; near the root it borrows a little of the fish's
         // own body colour (gold koi get golden fin roots).
         vec3 finWhite = vec3(0.93, 0.95, 0.95);
         vec3 finColor = mix(vKoiBase, finWhite, smoothstep(0.0, 0.45, v) * 0.6 + 0.4);

         // FIN RAYS: thin bony lines running from root to edge. A sine across
         // u gives evenly spaced lines; the narrow smoothstep keeps them thin.
         float ray = smoothstep(0.75, 1.0, sin(u * 3.14159 * 7.0));
         finColor += 0.06 * ray;

         // The free edges pick up the blue of the water (watercolour wash).
         float edge = smoothstep(0.7, 1.0, max(v, abs(u)));
         finColor = mix(finColor, vec3(0.55, 0.72, 0.8), 0.35 * edge);

         // Thick near the body, wispy at the edge.
         float alpha = mix(0.85, 0.3, smoothstep(0.0, 1.0, v));
         alpha = min(1.0, alpha + 0.12 * ray);

         diffuseColor = vec4(finColor, alpha);`,
      );
  };
}

// ---------------------------------------------------------------------------
// Shared, built once.
// ---------------------------------------------------------------------------
let bodyGeometry = null;
let finGeometry = null;
let bodyMaterial = null;
let finMaterial = null;

function ensureSharedFishAssets() {
  if (bodyGeometry !== null) {
    return;
  }
  bodyGeometry = createBodyGeometry();
  finGeometry = createFinGeometry();

  // Fairly matt skin with a soft sheen (roughness 0.5, no metalness: a
  // painting has no mirror reflections).
  bodyMaterial = new THREE.MeshStandardMaterial({ roughness: 0.5, metalness: 0 });
  addKoiBodyShader(bodyMaterial);

  // transparent: blend with what is behind (the water and shadows).
  // depthWrite false: a see-through veil must not hide the fins behind it.
  // DoubleSide: fins are paper-thin, both faces must be drawn.
  finMaterial = new THREE.MeshStandardMaterial({
    roughness: 0.75,
    metalness: 0,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  addKoiFinShader(finMaterial);
}

/**
 * Body InstancedMesh with the fin InstancedMesh attached as a child
 * (mesh.userData.finMesh). flock.js fills the body's instanceMatrix; the fin
 * mesh uses the very same matrix buffer, so it moves too.
 */
export function createFishInstancedMesh(instanceCount) {
  ensureSharedFishAssets();

  // Per-fish values (InstancedBufferAttribute = one value per fish, step 3.4).
  const swimPhases = new Float32Array(instanceCount);
  const wiggleMul = new Float32Array(instanceCount);
  const koiBase = new Float32Array(instanceCount * 3);
  const koiPatch = new Float32Array(instanceCount * 3);
  const koiParams = new Float32Array(instanceCount * 4);
  const scratchColor = new THREE.Color();

  for (let i = 0; i < instanceCount; i++) {
    swimPhases[i] = Math.random() * Math.PI * 2;
    wiggleMul[i] = 1;

    const variety = pickKoiVariety();
    scratchColor.set(variety.base).toArray(koiBase, i * 3);
    const patchHex = variety.patch[Math.floor(Math.random() * variety.patch.length)];
    scratchColor.set(patchHex).toArray(koiPatch, i * 3);
    koiParams[i * 4 + 0] = Math.random() * 10; // seed
    koiParams[i * 4 + 1] = lerp(variety.coverage[0], variety.coverage[1], Math.random());
    koiParams[i * 4 + 2] = variety.sumi;
    koiParams[i * 4 + 3] = variety.tancho;
  }

  const phaseAttr = new THREE.InstancedBufferAttribute(swimPhases, 1);
  phaseAttr.setUsage(THREE.DynamicDrawUsage);
  const wiggleAttr = new THREE.InstancedBufferAttribute(wiggleMul, 1);
  wiggleAttr.setUsage(THREE.DynamicDrawUsage);
  const baseAttr = new THREE.InstancedBufferAttribute(koiBase, 3);
  const patchAttr = new THREE.InstancedBufferAttribute(koiPatch, 3);
  const paramsAttr = new THREE.InstancedBufferAttribute(koiParams, 4);

  // The SAME attribute objects go on both geometries: one upload to the GPU,
  // and body + fins always agree on phase and colours.
  for (const geometry of [bodyGeometry, finGeometry]) {
    geometry.setAttribute('aPhase', phaseAttr);
    geometry.setAttribute('aWiggleMul', wiggleAttr);
    geometry.setAttribute('aKoiBase', baseAttr);
    geometry.setAttribute('aKoiPatch', patchAttr);
    geometry.setAttribute('aKoiParams', paramsAttr);
  }

  const mesh = new THREE.InstancedMesh(bodyGeometry, bodyMaterial, instanceCount);
  const finMesh = new THREE.InstancedMesh(finGeometry, finMaterial, instanceCount);
  finMesh.instanceMatrix = mesh.instanceMatrix; // share the fish placements
  finMesh.renderOrder = 1; // see-through things are drawn after opaque ones

  // InstancedMesh culling uses a bounding sphere computed once; our fish move
  // all over the pond, so skip culling (only ~25 fish, it costs nothing).
  mesh.frustumCulled = false;
  finMesh.frustumCulled = false;
  mesh.add(finMesh);

  mesh.userData.finMesh = finMesh;
  mesh.userData.swimPhases = swimPhases;
  mesh.userData.wiggleMul = wiggleMul;
  mesh.userData.phaseAttribute = phaseAttr;
  mesh.userData.wiggleAttribute = wiggleAttr;
  return mesh;
}
