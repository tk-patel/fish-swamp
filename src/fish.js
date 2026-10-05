// fish.js - builds the fish.
//
// UNITS: 1 world unit is about half a fish body length, so our fish is
// roughly 3.65 units long from nose to tail tip (nose at z = +1.35, tail tip
// at z = -2.3). (The pond is tens of units across, so that is believable.)
//
// ===========================================================================
// FORWARD DIRECTION CONVENTION  (decided in step 1.3 - never change this!)
//
//   In the fish's LOCAL space:
//     +Z = FORWARD (the nose points this way, the tail trails towards -Z)
//     +Y = UP      (the back of the fish; the belly is -Y)
//     +X = the fish's LEFT side (-X is its right side)
//
//   Why is +X the fish's left? Standing at +Z and looking at the origin,
//   +X is on YOUR right. A fish facing +Z is facing TOWARDS you, so its
//   left is on your right. (Face a friend: your right hand is on their
//   left.) The fish is symmetric, so this rarely matters, but it explains
//   what you will see in the axes helper.
//
//   Why +Z? Because Object3D.lookAt(target) rotates an object so that its
//   local +Z axis points at the target (for non-camera objects). With +Z as
//   the nose, `fish.lookAt(somewhere)` makes the fish face `somewhere`
//   with no extra rotation maths. Velocity-based steering (steps 1.4-1.6)
//   and the instanced flock (phase 3) all depend on this one decision.
//
//   The geometry below follows it: the nose tip is at z = +1.35 and the tail
//   tip is at z = -2.3.
// ===========================================================================

import * as THREE from 'three';
// mergeGeometries lives in the addons folder (like OrbitControls).
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// STEP 2.4: THE SINGLE-MESH FISH
//
// Until now a fish was a Group of 4 meshes (body, tail, 2 eyes) = 4 draw
// calls per fish (see step 2.3). To draw hundreds of fish with one draw call
// (InstancedMesh, phase 3) every fish must be ONE mesh made of ONE geometry.
// So we build a custom BufferGeometry: the body and the tail fin are the
// same continuous surface, just shaped differently along the Z axis.
//
// WHAT IS A BufferGeometry?  Just a few big lists of numbers (typed arrays):
//   position - for every VERTEX (corner point): x, y, z
//   color    - for every vertex: r, g, b   (we add this one ourselves)
//   normal   - for every vertex: which way the surface faces (used by
//              lighting; we let Three.js compute it)
//   index    - a list of triples "vertex 5, vertex 9, vertex 12 form a
//              triangle", so vertices can be shared between triangles.
//
// HOW WE BUILD THE SHAPE: think of a loaf of bread sliced along Z. Each slice
// ("ring") is an ellipse, with a width (X) and a height (Y). If we choose the
// ellipse size for every slice, we have chosen the whole shape:
//
//    nose z=+1.35                                 tail tip z=-2.3
//      .-~~~~~-.______                            |\
//     (  body   )_____ ) ~~ thin "neck" ~~~~~~~~~~| |  <- fin: tall but very
//      '-.___.-'                                  |/        thin from the side
//
//   z from +1.35 to -0.85 : a long ellipsoid (a stretched step-1.1 egg)
//   z from -0.85 to -1.55 : squeezes down to a thin "tail stalk" (narrowest)
//   z from -1.55 to -2.3  : flares up in height into a flat vertical fin
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// STEP 7.6: A BETTER FISH — still ONE mesh, now built from several parts
// STEP 8.3: reshaped from a koi into a SALMON (long, slim, compressed)
//
// WHY NOT A GLB FILE?  The plan suggested loading a low-poly .glb model with
// GLTFLoader. That needs a model file, and we have no art asset in the project.
// So instead of one hand-made file, we build the fish in code and MERGE every
// part into a single BufferGeometry. The result behaves like a loaded model
// would: one geometry, one material, drawn with InstancedMesh, with the same
// vertex-shader wiggle. (If you later get a .glb, only createFishGeometry()
// needs to be swapped for `gltf.scene...geometry`.)
//
// The parts (all merged into one mesh):
//   body        - the ring-by-ring shape from step 2.4, now a long salmon body
//                 ending at the tail stalk, painted with a pale belly, a
//                 silvery band along the side, a darker speckled back and a
//                 slightly darker snout
//   tail fin    - a flat fin with a MODERATE fork (two lobes, small notch)
//   dorsal fin  - the sail on the middle of the back
//   adipose fin - the tiny fleshy flap salmon and trout have before the tail
//   pectoral fins - two small side fins ("arms") tucked under the front body
//   eyes        - two tiny near-black spheres
//
// LATERALLY COMPRESSED: a real salmon is taller than it is wide (flattened
// from the sides), so getHalfSizeAtZ() returns a halfHeight bigger than its
// halfWidth. That is what makes the fish read as slim from the top-down pond
// camera, which mostly sees the fish's back.
//
// COLOR TRICK: the vertex colors below are mostly GREY (brightness only).
// Each fish also has an instance color (set in flock.js: silvery blue, olive,
// rosy pink or sockeye red). The GPU MULTIPLIES the two, so grey patterns come
// out as "the fish's own color, darker here and paler there". One mesh, many
// looks.
// ---------------------------------------------------------------------------

const NOSE_Z = 1.35;
const BODY_END_Z = -0.85; // where the salmon body starts to narrow
const STALK_Z = -1.55; // the narrowest point; the body mesh ends here
const TAIL_TIP_Z = -2.3; // the very back of the tail fin

const RINGS = 44; // how many slices along Z (more slices = smoother long body)
const SIDES = 16; // how many points around each slice

// smoothstep(t): turns a straight 0..1 ramp into an S-curve that starts and
// ends gently (slope 0 at both ends). Great for blending shapes together
// without a visible crease. Formula: 3t^2 - 2t^3.
function smoothstep01(t) {
  return t * t * (3 - 2 * t);
}

// lerp(a, b, t) = "linear interpolation": a when t = 0, b when t = 1, and a
// proportional mix in between. (Used again for steering and moods later.)
function lerp(a, b, t) {
  return a + (b - a) * t;
}

function clamp01(value) {
  return Math.min(Math.max(value, 0), 1);
}

// The body shape: for a given z, how wide (x) and how tall (y) is the half-ellipse?
// Returns the HALF width and HALF height (distance from the center line).
// STEP 8.3: this is the SALMON profile — long, slim and flattened from the sides.
function getHalfSizeAtZ(z) {
  if (z >= BODY_END_Z) {
    // Normalise z by the nose position. u = 1 AT the nose, u = 0 at the widest
    // point (z = 0) and negative toward the tail. Working with the fraction u
    // instead of the raw z keeps the maths the same however long the fish is.
    const u = z / NOSE_Z;
    // sqrt(1 - u^2) is the classic ellipse: 1 in the middle, falling to 0 at
    // the nose. On its own that gives a round, blunt nose.
    const roundness = Math.sqrt(Math.max(0, 1 - u * u));

    // POINTED SNOUT: raising roundness to a power bigger than 1 makes it fall
    // off faster near the nose (roundness -> 0 sooner), turning the blunt ball
    // into a cone-ish snout. The exponent grows from 0.75 at the middle to
    // 1.35 at the nose (0.75 + 0.6 * 1), so only the front sharpens up.
    const snoutTaper = Math.pow(roundness, 0.75 + 0.6 * clamp01(u));

    // halfWidth < halfHeight => taller than it is wide, i.e. LATERALLY
    // COMPRESSED, exactly like a real salmon seen from above.
    return { halfWidth: 0.22 * snoutTaper, halfHeight: 0.34 * snoutTaper };
  }

  // Body -> narrow stalk (the "wrist" the tail fin attaches to). We start from
  // the SAME tapered value the body branch has at z = BODY_END_Z so the two
  // branches join with no step, then smoothstep-blend down to the thin stalk.
  const bodyEndU = BODY_END_Z / NOSE_Z;
  const bodyEndRoundness = Math.sqrt(Math.max(0, 1 - bodyEndU * bodyEndU));
  const bodyEndTaper = Math.pow(bodyEndRoundness, 0.75 + 0.6 * clamp01(bodyEndU));
  const t = smoothstep01((BODY_END_Z - z) / (BODY_END_Z - STALK_Z));
  return {
    halfWidth: lerp(0.22 * bodyEndTaper, 0.045, t),
    halfHeight: lerp(0.34 * bodyEndTaper, 0.09, t),
  };
}

/**
 * Grey brightness (0..1) for one point on the body. `angle` goes around the
 * ring: sin(angle) = +1 on the back, -1 on the belly, 0 on the sides.
 * STEP 8.3: salmon colouring — countershading, a silvery side band, dark
 * speckles on the upper half and a darker snout.
 */
function getBodyBrightness(angle, z) {
  const backAmount = clamp01(Math.sin(angle) * 0.5 + 0.5); // 0 belly .. 1 back

  // COUNTERSHADING: pale (silvery) belly, darker back. pow(backAmount, 1.2)
  // pushes the darkening up toward the top, so the flanks stay bright and only
  // the true back goes dark — the way a real salmon fades into the water
  // below and stands out against it from above.
  let brightness = lerp(1.0, 0.62, Math.pow(backAmount, 1.2));

  // LATERAL LINE: a slightly brighter silvery band along each side. sin(angle)
  // is +-1 on the back/belly and 0 on the sides, so (1 - |sin(angle)|) is 1 at
  // the sides and 0 top/bottom. We increase brightness there.
  const sideAmount = 1 - Math.abs(Math.sin(angle));
  brightness *= 1 + 0.12 * sideAmount;
  brightness = Math.min(brightness, 1.0); // never brighter than "full" white

  // SPECKLES: salmon have small dark spots on the upper half. Two sine waves
  // (one running along the body in z, one wrapping around in angle) multiply;
  // only where both are high (> 0.55) do we darken a small patch. Multiplying
  // by backAmount keeps the spots off the pale belly.
  const speckle = Math.sin(z * 23.0) * Math.sin(angle * 9.0 + z * 7.0);
  const speckleAmount = smoothstep01(clamp01((speckle - 0.55) / 0.25)) * backAmount;
  brightness *= 1 - 0.45 * speckleAmount;

  // A slightly darker snout so the face reads at a distance. The ramp runs from
  // z = NOSE_Z - 0.4 (start of the darkening) to the nose at z = NOSE_Z.
  brightness *= lerp(1.0, 0.85, clamp01((z - (NOSE_Z - 0.4)) / 0.4));
  return brightness;
}

function createBodyGeometry() {
  const vertexCount = (RINGS + 1) * SIDES;
  const positions = new Float32Array(vertexCount * 3); // x, y, z per vertex
  const colors = new Float32Array(vertexCount * 3); // r, g, b per vertex

  for (let ring = 0; ring <= RINGS; ring++) {
    // ring 0 is at the nose, the last ring at the tail stalk.
    const z = lerp(NOSE_Z, STALK_Z, ring / RINGS);
    let { halfWidth, halfHeight } = getHalfSizeAtZ(z);

    // The very last ring has zero width: its left and right sides meet in a
    // line, which CLOSES the back of the body (the tail fin covers that line).
    if (ring === RINGS) {
      halfWidth = 0;
    }

    for (let side = 0; side < SIDES; side++) {
      // A point on the ellipse: angle goes once around (0..2*PI radians);
      // cos gives the x direction, sin the y direction; multiplying by the
      // half width/height stretches the circle into an ellipse.
      const angle = (side / SIDES) * Math.PI * 2;
      const vertexIndex = ring * SIDES + side;
      const brightness = getBodyBrightness(angle, z);

      positions[vertexIndex * 3 + 0] = Math.cos(angle) * halfWidth; // x
      positions[vertexIndex * 3 + 1] = Math.sin(angle) * halfHeight; // y
      positions[vertexIndex * 3 + 2] = z; // z

      colors[vertexIndex * 3 + 0] = brightness;
      colors[vertexIndex * 3 + 1] = brightness;
      colors[vertexIndex * 3 + 2] = brightness;
    }
  }

  // INDICES: connect neighbouring rings into quads, each quad = 2 triangles.
  // `(side + 1) % SIDES` wraps the last point back to the first so the ring
  // closes up. The ORDER of the 3 corners matters: Three.js only draws the
  // side of a triangle whose corners go counter-clockwise as you look at it,
  // and we want that to be the OUTSIDE of the fish.
  const indices = [];
  for (let ring = 0; ring < RINGS; ring++) {
    for (let side = 0; side < SIDES; side++) {
      const nextSide = (side + 1) % SIDES;
      const a = ring * SIDES + side; //             this ring, this point
      const b = ring * SIDES + nextSide; //         this ring, next point around
      const c = (ring + 1) * SIDES + side; //       next ring, this point
      const d = (ring + 1) * SIDES + nextSide; //   next ring, next point around
      indices.push(a, c, b);
      indices.push(b, c, d);
    }
  }

  const geometry = new THREE.BufferGeometry();
  // The 3 means "3 numbers per vertex" (so the list is read in groups of 3).
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  // Works out each vertex's normal (the direction it faces) by averaging the
  // triangles that touch it. Lighting needs this to shade the surface.
  geometry.computeVertexNormals();
  return geometry;
}

/**
 * A flat fin made from a few hand-placed points.
 * @param {number[][]} points      [x, y, z] corners of the fin
 * @param {number[][]} triangles   triples of indices into `points`
 * @param {number[]} brightnesses  grey brightness per point (fins fade toward the edge)
 */
function createFinGeometry(points, triangles, brightnesses) {
  const positions = new Float32Array(points.length * 3);
  const colors = new Float32Array(points.length * 3);
  points.forEach((point, index) => {
    positions.set(point, index * 3);
    colors.fill(brightnesses[index], index * 3, index * 3 + 3);
  });

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(triangles.flat());
  geometry.computeVertexNormals();
  return geometry;
}

function createTailFinGeometry() {
  // Looking from the side (Y up, tail pointing left, -Z):
  //
  //   root top ____ upper mid ___ upper tip
  //      |                          \
  //   center .          notch  <-----'    (the "V" cut makes the fork)
  //      |                          /
  //   root bottom --- lower mid --- lower tip
  //
  // STEP 8.3: the fork is only MODERATE now (tips ±0.5, mid ±0.3) — salmon
  // tails are forked, but nowhere near as deep as a koi's double tail.
  const points = [
    [0, 0.09, STALK_Z + 0.05], // 0 root top (just ahead of the stalk)
    [0.0, 0.3, -1.85], // 1 upper mid
    [0.0, 0.5, TAIL_TIP_Z], // 2 upper tip
    [0.0, 0.0, -2.05], // 3 notch (the "V" between the lobes)
    [0.0, -0.5, TAIL_TIP_Z], // 4 lower tip
    [0.0, -0.3, -1.85], // 5 lower mid
    [0, -0.09, STALK_Z + 0.05], // 6 root bottom
    [0, 0, -1.75], // 7 center (every triangle starts here: a "fan")
  ];
  const triangles = [
    [7, 0, 1],
    [7, 1, 2],
    [7, 2, 3],
    [7, 3, 4],
    [7, 4, 5],
    [7, 5, 6],
    [7, 6, 0],
  ];
  // Fins are paler and softer than the body, fading toward the edge.
  const brightnesses = [0.9, 0.75, 0.6, 0.8, 0.6, 0.75, 0.9, 0.9];
  return createFinGeometry(points, triangles, brightnesses);
}

function createDorsalFinGeometry() {
  // STEP 8.3: sits on the MIDDLE of the back (z ≈ 0.35 .. -0.25) instead of far
  // back, matching where a salmon's dorsal fin actually is.
  const points = [
    [0, 0.3, 0.35], // 0 front base (sits slightly inside the back)
    [0, 0.27, -0.25], // 1 back base
    [0, 0.62, -0.12], // 2 tip
    [0, 0.52, 0.2], // 3 front edge, halfway up
  ];
  const triangles = [
    [0, 3, 2],
    [0, 2, 1],
  ];
  return createFinGeometry(points, triangles, [0.85, 0.85, 0.6, 0.7]);
}

// STEP 8.3: ADIPOSE FIN — salmon and trout have this small fleshy flap with no
// fin rays (no skeleton inside) sitting between the dorsal fin and the tail.
// It is the quickest way to spot a salmonid, so we add one as a tiny flap.
function createAdiposeFinGeometry() {
  const points = [
    [0, 0.13, -1.1], // 0 front base
    [0, 0.1, -1.38], // 1 back base
    [0, 0.24, -1.3], // 2 rear tip
    [0, 0.22, -1.15], // 3 front tip
  ];
  const triangles = [
    [0, 3, 2],
    [0, 2, 1],
  ];
  return createFinGeometry(points, triangles, [0.7, 0.7, 0.55, 0.6]);
}

function createPectoralFinGeometry(sideSign) {
  // sideSign = +1 for the fish's left (+X), -1 for its right.
  // STEP 8.3: smaller and tucked under the FRONT of the slimmer body.
  const points = [
    [sideSign * 0.18, -0.16, 0.75], // 0 root, front
    [sideSign * 0.2, -0.2, 0.4], // 1 root, back
    [sideSign * 0.55, -0.34, 0.15], // 2 tip
    [sideSign * 0.45, -0.24, 0.55], // 3 leading edge
  ];
  const triangles = [
    [0, 3, 2],
    [0, 2, 1],
  ];
  return createFinGeometry(points, triangles, [0.9, 0.9, 0.6, 0.75]);
}

function createEyeGeometry(sideSign) {
  const eye = new THREE.SphereGeometry(0.06, 8, 6);
  // SphereGeometry also stores texture coordinates (uv). Our other parts do
  // not, and merging requires every part to have the SAME attributes.
  eye.deleteAttribute('uv');
  // Nearly black.
  const eyeColors = new Float32Array(eye.attributes.position.count * 3).fill(0.04);
  eye.setAttribute('color', new THREE.BufferAttribute(eyeColors, 3));
  // Move it to the side of the head, partly sunk into the body.
  // STEP 8.3: at z = 1.0 the body halfWidth is only ~0.137, and a touch less at
  // y = 0.1 (the eye sits above the centre line), so x = 0.13 puts the eye
  // centre right on the surface: half the little ball shows, half is inside.
  eye.translate(sideSign * 0.13, 0.1, 1.0);
  return eye;
}

function createFishGeometry() {
  // mergeGeometries glues several geometries into ONE (a single vertex list),
  // which is what lets the whole fish stay one draw call per instance batch.
  return mergeGeometries([
    createBodyGeometry(),
    createTailFinGeometry(),
    createDorsalFinGeometry(),
    createAdiposeFinGeometry(),
    createPectoralFinGeometry(1),
    createPectoralFinGeometry(-1),
    createEyeGeometry(1),
    createEyeGeometry(-1),
  ]);
}

// ---------------------------------------------------------------------------
// STEP 2.5: THE SWIM WIGGLE, DONE ON THE GPU WITH A VERTEX SHADER
//
// WHAT IS A SHADER?  A tiny program that runs on the graphics card (GPU),
// written in a C-like language called GLSL. For every frame, the GPU runs:
//   - a VERTEX SHADER once for every vertex (corner point) of the mesh: it
//     decides where on the screen that corner goes. We can nudge vertices
//     here, which MOVES THE SHAPE.
//   - a FRAGMENT SHADER once for every pixel covered by a triangle: it
//     decides that pixel's color (lighting, fog, ...). We leave this alone.
// The GPU runs thousands of these in parallel, which is why it can wiggle
// 300 fish for almost free - the CPU never touches their vertices.
//
// WHY NOT JUST MOVE VERTICES IN JAVASCRIPT?  We would loop over 641 vertices
// x 300 fish x 60 times a second and re-upload the data to the GPU. Wasteful.
//
// HOW DO WE ADD OUR OWN CODE?  MeshStandardMaterial already contains a big,
// complicated shader (physically based lighting, fog, ...). Rewriting it
// would be painful, so Three.js lets us EDIT it as text just before it is
// compiled: `material.onBeforeCompile = (shader) => { ... }`. The shader is
// built from named snippets like `#include <begin_vertex>` (the line that
// creates the vertex position variable `transformed`). We find that line and
// put our own code right after it.
//
// UNIFORMS: a value that is the SAME for every vertex in a draw call, set
// from JavaScript. "Uniform" = uniform across all vertices. We keep each one
// in an object so main.js and the sliders can change `.value` and the shader
// sees the new number on the next frame.
// ---------------------------------------------------------------------------
export const fishWaveUniforms = {
  // How far the tail tip swings sideways, in world units.
  uAmplitude: { value: 0.35 },
  // Distance along the body for one full S-curve. Fish are ~3.65 long, so 3.8
  // means "about one S-curve along the whole body". Step 8.3 raised this from
  // 3.0: a longer body gets a longer, lazier wave, the way a big salmon swims.
  uWavelength: { value: 3.8 },
  // Step 5.6: 0 = calm slow wag, 1 = panicked fast flap (set from mood in main.js).
  uMood: { value: 0 },
};

// Base wave travel speed (rad/s). Each fish also scales phase growth by its
// swim speed (step 3.4) via the per-instance aWiggleMul attribute.
export const fishWaveSettings = {
  speed: 9.0,
  // Multiplier on phase advance; main.js ties this to smoothed uMood.
  moodSpeedMul: 1.0,
};

const WAVE_HEAD_Z = 1.0; // from here forward the body stays perfectly still

function addSwimWiggleToMaterial(material) {
  material.onBeforeCompile = (shader) => {
    // Give the shader access to our uniform objects.
    shader.uniforms.uAmplitude = fishWaveUniforms.uAmplitude;
    shader.uniforms.uWavelength = fishWaveUniforms.uWavelength;
    shader.uniforms.uMood = fishWaveUniforms.uMood;

    // Per-instance attributes (InstancedBufferAttribute on the geometry, step 3.4).
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uAmplitude;
       uniform float uWavelength;
       uniform float uMood;
       attribute float aPhase;
       attribute float aWiggleMul;`,
    );

    // 2) Add the wiggle right after the vertex position is created.
    //    (The ${...} parts below are filled in by JavaScript before the
    //    text is sent to the GPU, turning our constants into GLSL numbers.)
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>

       // 'transformed' is this vertex's position in the fish's own local
       // space (x = sideways, y = up, z = along the body, nose at +Z).

       // HOW MUCH should THIS vertex wiggle? 0 for the head, 1 at the tail
       // tip. A real fish keeps its head fairly steady and swings its tail
       // the most; without this weight the whole fish would just slide
       // side to side like a snake with no head.
       //
       // smoothstep(edge0, edge1, x) returns 0 when x <= edge0, 1 when
       // x >= edge1, and an S-shaped curve in between (flat at both ends).
       // Our edges are (tail tip, head line). z is large at the nose, so
       // smoothstep gives 1 at the head and 0 at the tail - we flip it with
       // "1.0 - ..." to get 0 at the head and 1 at the tail.
       // Compared with a straight ramp, the S-curve keeps the front half of
       // the body calm and concentrates the motion in the tail, and it has
       // no visible kink where the still part meets the moving part.
       float tailWeight = 1.0 - smoothstep(${TAIL_TIP_Z.toFixed(2)}, ${WAVE_HEAD_Z.toFixed(2)}, transformed.z);

       // A TRAVELLING SINE WAVE: sin(position * k + phase).
       //  - z * k : different parts of the body are at different points of
       //            the wave, so the body bends into an S-shape.
       //            k = 2*PI / wavelength (radians of wave per unit length).
       //            Short wavelength = many tight ripples; long = one lazy bend.
       //  - aPhase : per-fish phase (random start, advanced on CPU each frame).
       //  - aWiggleMul : scales wag with this fish's swim speed (0..1-ish).
       float waveNumber = 6.28318530718 / uWavelength;
       float wavePhase = transformed.z * waveNumber + aPhase;

       // uMood (0 calm .. 1 panic): wider tail swing when the flock is chaotic.
       float moodAmpMul = mix(0.72, 1.55, uMood);

       transformed.x += sin(wavePhase) * uAmplitude * moodAmpMul * tailWeight * aWiggleMul;`,
    );
  };
}

// Build the geometry and material ONCE and share them between every fish.
// Many meshes can point at the same geometry/material, so 1000 fish do not
// need 1000 copies of the same 640 vertices. InstancedMesh (step 3.1) goes
// further: one draw call tells the GPU "draw this mesh N times", each copy
// at a different position/rotation stored in instanceMatrix.
let sharedFishGeometry = null;
let sharedFishMaterial = null;

function ensureSharedFishAssets() {
  if (sharedFishGeometry !== null) {
    return;
  }
  sharedFishGeometry = createFishGeometry();
  // vertexColors: true tells the material to use the 'color' attribute we
  // painted above instead of one flat color for the whole mesh.
  // DoubleSide: fins are paper-thin flat shapes, so both faces must be drawn.
  // roughness 0.35 / metalness 0.25: fairly smooth and slightly metallic. Real
  // fish scales are wet and a bit reflective, so this gives salmon that silvery
  // sheen without turning them into mirrors.
  sharedFishMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.35,
    metalness: 0.25,
    side: THREE.DoubleSide,
  });
  addSwimWiggleToMaterial(sharedFishMaterial);
}

/**
 * Creates one fish and returns it as a single THREE.Mesh.
 * (Before step 2.4 this returned a Group with several meshes inside.)
 */
export function createFish() {
  ensureSharedFishAssets();
  return new THREE.Mesh(sharedFishGeometry, sharedFishMaterial);
}

/**
 * Empty InstancedMesh shell — flock.js fills instanceMatrix each frame from
 * typed-array positions and quaternions (steps 3.2–3.3).
 */
export function createFishInstancedMesh(instanceCount) {
  ensureSharedFishAssets();

  const swimPhases = new Float32Array(instanceCount);
  const wiggleMul = new Float32Array(instanceCount);
  for (let i = 0; i < instanceCount; i++) {
    swimPhases[i] = Math.random() * Math.PI * 2;
    wiggleMul[i] = 1;
  }

  const phaseAttr = new THREE.InstancedBufferAttribute(swimPhases, 1);
  phaseAttr.setUsage(THREE.DynamicDrawUsage);
  const wiggleAttr = new THREE.InstancedBufferAttribute(wiggleMul, 1);
  wiggleAttr.setUsage(THREE.DynamicDrawUsage);
  sharedFishGeometry.setAttribute('aPhase', phaseAttr);
  sharedFishGeometry.setAttribute('aWiggleMul', wiggleAttr);

  const mesh = new THREE.InstancedMesh(
    sharedFishGeometry,
    sharedFishMaterial,
    instanceCount,
  );
  mesh.userData.swimPhases = swimPhases;
  mesh.userData.wiggleMul = wiggleMul;
  mesh.userData.phaseAttribute = phaseAttr;
  mesh.userData.wiggleAttribute = wiggleAttr;
  return mesh;
}
