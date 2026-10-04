// fish.js - builds the fish.
//
// UNITS: 1 world unit is about half a fish body length, so our fish is
// roughly 2.8 units long from nose to tail tip. (The tank is 40 x 20 x 30
// units, so that is a believable size for a fish in it.)
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
//   The geometry below follows it: the nose tip is at z = +1 and the tail
//   tip is at z = -1.8.
// ===========================================================================

import * as THREE from 'three';

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
//    nose z=+1                                   tail tip z=-1.8
//      .-~~~~~-.______                            |\
//     (  body   )_____ ) ~~ thin "neck" ~~~~~~~~~~| |  <- fin: tall but very
//      '-.___.-'                                  |/        thin from the side
//
//   z from +1 to -0.6 : an ellipsoid (the same egg as step 1.1)
//   z from -0.6 to -1.05: squeezes down to a thin "tail stalk" (the narrowest)
//   z from -1.05 to -1.8: flares up in height into a flat vertical fin
// ---------------------------------------------------------------------------

const NOSE_Z = 1.0;
const BODY_END_Z = -0.6; // where the egg-shaped body ends
const STALK_Z = -1.05; // the narrowest point (the "wrist" of the tail)
const TAIL_TIP_Z = -1.8; // the very back of the fin

const RINGS = 40; // how many slices along Z (more = smoother, more triangles)
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

// The shape: for a given z, how wide (x) and how tall (y) is the half-ellipse?
// Returns the HALF width and HALF height (distance from the center line).
function getHalfSizeAtZ(z) {
  if (z >= BODY_END_Z) {
    // Egg-shaped body: sqrt(1 - z^2) is 1 in the middle and falls to 0 at the
    // nose (z = 1), which makes a round nose. Same widths as step 1.1.
    const roundness = Math.sqrt(Math.max(0, 1 - z * z));
    return { halfWidth: 0.35 * roundness, halfHeight: 0.5 * roundness };
  }

  const bodyEndRoundness = Math.sqrt(1 - BODY_END_Z * BODY_END_Z); // = 0.8
  const bodyEndWidth = 0.35 * bodyEndRoundness;
  const bodyEndHeight = 0.5 * bodyEndRoundness;

  if (z >= STALK_Z) {
    // Body -> narrow stalk. t goes 0 -> 1 as z moves from BODY_END_Z to STALK_Z.
    const t = smoothstep01((BODY_END_Z - z) / (BODY_END_Z - STALK_Z));
    return { halfWidth: lerp(bodyEndWidth, 0.06, t), halfHeight: lerp(bodyEndHeight, 0.12, t) };
  }

  // Stalk -> fin. The fin grows TALL (height 0.12 -> 0.55) but stays THIN
  // (width 0.06 -> 0.015): a flat vertical blade, like the cone tail before.
  const t = smoothstep01((STALK_Z - z) / (STALK_Z - TAIL_TIP_Z));
  return { halfWidth: lerp(0.06, 0.015, t), halfHeight: lerp(0.12, 0.55, t) };
}

function createFishGeometry() {
  const vertexCount = (RINGS + 1) * SIDES;
  const positions = new Float32Array(vertexCount * 3); // x, y, z per vertex
  const colors = new Float32Array(vertexCount * 3); // r, g, b per vertex

  // Painting the fish with VERTEX COLORS: every vertex gets its own color and
  // the GPU blends smoothly between them across each triangle. Orange body,
  // darker orange fin, with a soft transition around the stalk.
  const bodyColor = new THREE.Color(0xff8c42);
  const finColor = new THREE.Color(0xc4501a);
  const vertexColor = new THREE.Color();

  for (let ring = 0; ring <= RINGS; ring++) {
    // ring 0 is at the nose, the last ring at the tail tip.
    const z = lerp(NOSE_Z, TAIL_TIP_Z, ring / RINGS);
    let { halfWidth, halfHeight } = getHalfSizeAtZ(z);

    // The very last ring has zero width: its left and right sides meet in a
    // line, which CLOSES the fin's back edge (otherwise you could see inside).
    if (ring === RINGS) {
      halfWidth = 0;
    }

    // Color blends from body to fin color between z = -0.6 and z = -1.05.
    const colorBlend = smoothstep01(
      Math.min(Math.max((BODY_END_Z - z) / (BODY_END_Z - STALK_Z), 0), 1),
    );
    vertexColor.copy(bodyColor).lerp(finColor, colorBlend);

    for (let side = 0; side < SIDES; side++) {
      // A point on the ellipse: angle goes once around (0..2*PI radians);
      // cos gives the x direction, sin the y direction; multiplying by the
      // half width/height stretches the circle into an ellipse.
      const angle = (side / SIDES) * Math.PI * 2;
      const vertexIndex = ring * SIDES + side;

      positions[vertexIndex * 3 + 0] = Math.cos(angle) * halfWidth; // x
      positions[vertexIndex * 3 + 1] = Math.sin(angle) * halfHeight; // y
      positions[vertexIndex * 3 + 2] = z; // z

      colors[vertexIndex * 3 + 0] = vertexColor.r;
      colors[vertexIndex * 3 + 1] = vertexColor.g;
      colors[vertexIndex * 3 + 2] = vertexColor.b;
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
  // Distance along the body for one full S-curve. Fish are ~2.8 long, so 3.0
  // means "about one S-curve along the whole body".
  uWavelength: { value: 3.0 },
};

// Base wave travel speed (rad/s). Each fish also scales phase growth by its
// swim speed (step 3.4) via the per-instance aWiggleMul attribute.
export const fishWaveSettings = {
  speed: 9.0,
};

const WAVE_HEAD_Z = 0.8; // from here forward the body stays perfectly still

function addSwimWiggleToMaterial(material) {
  material.onBeforeCompile = (shader) => {
    // Give the shader access to our uniform objects.
    shader.uniforms.uAmplitude = fishWaveUniforms.uAmplitude;
    shader.uniforms.uWavelength = fishWaveUniforms.uWavelength;

    // Per-instance attributes (InstancedBufferAttribute on the geometry, step 3.4).
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uAmplitude;
       uniform float uWavelength;
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

       transformed.x += sin(wavePhase) * uAmplitude * tailWeight * aWiggleMul;`,
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
  sharedFishMaterial = new THREE.MeshStandardMaterial({ vertexColors: true });
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
