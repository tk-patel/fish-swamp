// lilies.js — lily pads and lotus flowers floating on the surface (phase 9).
//
// Like the reference painting, the pads gather in clusters at the edges of
// the pond and run off the screen, which frames the koi in the middle.
// Positions are given as fractions of the visible pond (-1 .. +1 on each
// axis) and turned into world units by layout(pondSize), so the clusters stay
// in the corners whatever the window shape. Call layout() again on resize.

import * as THREE from 'three';
import { noiseGlsl } from './shaders/noise.js';
import { createDiscShadow, SHADOW_SHIFT_PER_HEIGHT } from './shadows.js';

// ---------------------------------------------------------------------------
// LILY PAD — a flat disc with a wedge-shaped notch, built as rings so it can
// be cupped (edges a bit higher than the middle) and so the shader knows how
// far from the centre each pixel is.
// ---------------------------------------------------------------------------
const PAD_RINGS = 8;
const PAD_SEGMENTS = 64;
const PAD_NOTCH_HALF_ANGLE = 0.2; // radians; the slit runs from the centre to the rim

function createPadGeometry() {
  const positions = [];
  const padCoords = []; // (radial fraction 0..1, angle) per vertex
  const indices = [];

  for (let ring = 0; ring <= PAD_RINGS; ring++) {
    const radialFraction = ring / PAD_RINGS;
    for (let segment = 0; segment <= PAD_SEGMENTS; segment++) {
      // Sweep the full circle EXCEPT the notch.
      const angle =
        PAD_NOTCH_HALF_ANGLE + (segment / PAD_SEGMENTS) * (Math.PI * 2 - 2 * PAD_NOTCH_HALF_ANGLE);
      // A slightly wavy rim: two small sine ripples around the edge, bigger
      // toward the rim (times radialFraction), so the pad is not a perfect circle.
      const wobble = 1 + radialFraction * (0.025 * Math.sin(angle * 7) + 0.015 * Math.sin(angle * 13 + 1));
      const radius = radialFraction * wobble;
      // Cupping: y grows with radius^4, so the middle is flat and only the
      // outer rim lifts.
      const height = 0.06 * Math.pow(radialFraction, 4);
      positions.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
      padCoords.push(radialFraction, angle);
    }
  }

  const rowLength = PAD_SEGMENTS + 1;
  for (let ring = 0; ring < PAD_RINGS; ring++) {
    for (let segment = 0; segment < PAD_SEGMENTS; segment++) {
      const a = ring * rowLength + segment;
      const b = a + 1;
      const c = a + rowLength;
      const d = c + 1;
      // Winding chosen so the faces point UP, toward the camera.
      indices.push(a, b, c, b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('aPadCoord', new THREE.Float32BufferAttribute(padCoords, 2));
  geometry.setIndex(indices);
  return geometry;
}

const padVertexShader = /* glsl */ `
  attribute vec2 aPadCoord;
  varying vec2 vPadCoord;
  varying vec2 vLocalXz;
  varying vec2 vWorldDirection;
  void main() {
    vPadCoord = aPadCoord;
    vLocalXz = position.xz;
    // Direction from the pad's centre in WORLD space (the pad itself is
    // rotated), used to light the side facing the sun.
    vWorldDirection = (modelMatrix * vec4(position, 0.0)).xz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const padFragmentShader = /* glsl */ `
  uniform float uSeed;
  varying vec2 vPadCoord;
  varying vec2 vLocalXz;
  varying vec2 vWorldDirection;
  ${noiseGlsl}

  void main() {
    float r = vPadCoord.x;     // 0 centre .. 1 rim
    float angle = vPadCoord.y; // around the pad

    // Colours picked from the painting: lime, light yellow-green, deep green.
    vec3 lightGreen = vec3(206.0, 231.0, 128.0) / 255.0;
    vec3 midGreen = vec3(150.0, 199.0, 70.0) / 255.0;
    vec3 darkGreen = vec3(78.0, 140.0, 48.0) / 255.0;

    // A soft watercolour wash across the pad (different per pad via uSeed).
    float wash = fbm(vLocalXz * 1.4 + uSeed * 13.0);
    vec3 color = mix(midGreen, lightGreen, smoothstep(0.38, 0.7, wash) * (1.0 - 0.6 * r));

    // Deeper green toward the rim.
    color = mix(color, darkGreen, smoothstep(0.55, 1.0, r) * 0.5);

    // VEINS: lines radiating from the centre. |sin(angle * 9)| peaks 18
    // times around the circle; the narrow smoothstep keeps only thin lines.
    // Adding a bit of the wash bends them so they look hand-drawn.
    float vein = smoothstep(0.93, 1.0, abs(sin(angle * 9.0 + wash * 0.8)));
    vein *= smoothstep(0.08, 0.25, r) * (1.0 - smoothstep(0.85, 0.96, r));
    color = mix(color, lightGreen * 1.06, vein * 0.55);

    // A dark outline along the rim, like a pen line in the painting.
    color = mix(color, darkGreen * 0.75, smoothstep(0.93, 0.99, r) * 0.75);

    // Sun from the upper right: brighten the pad half facing (+x, -z).
    vec2 sunDirection = normalize(vec2(1.0, -1.0));
    float facing = dot(normalize(vWorldDirection + 1e-4), sunDirection) * r;
    color *= 1.0 + 0.1 * facing;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// ---------------------------------------------------------------------------
// LOTUS FLOWER — three rings of curved petals around a golden centre. Built
// from real 3D geometry and lit normally, so the petals get light and shade.
// ---------------------------------------------------------------------------
function createPetalGeometry(length, maxHalfWidth, liftAngle, curl) {
  const columns = 6;
  const rows = 8;
  const positions = [];
  const colors = [];
  const indices = [];
  const baseColor = new THREE.Color('#fff4f6'); // almost white at the base
  const tipColor = new THREE.Color('#f0598a'); // strong pink tip, as in the painting
  const color = new THREE.Color();

  for (let row = 0; row <= rows; row++) {
    const v = row / rows; // 0 base .. 1 tip
    // Petal outline: sin(PI * v^0.75) is 0 at both ends and widest a bit
    // before the middle = a pointed, lens-shaped petal.
    const halfWidth = maxHalfWidth * Math.sin(Math.PI * Math.pow(v, 0.75));
    // The petal bends upward more and more toward its tip.
    const elevation = liftAngle + curl * v;
    const outward = length * v * Math.cos(elevation);
    const up = length * v * Math.sin(elevation);
    for (let column = 0; column <= columns; column++) {
      const u = (column / columns) * 2 - 1;
      // Cupped across: edges curl up (u^2) like a spoon.
      const cup = 0.35 * maxHalfWidth * u * u;
      positions.push(u * halfWidth, up + cup, outward);
      // Pink grows toward the tip and the edges.
      color.copy(baseColor).lerp(tipColor, Math.min(1, Math.pow(v, 1.6) + 0.25 * Math.abs(u) * v));
      colors.push(color.r, color.g, color.b);
    }
  }
  const rowLength = columns + 1;
  for (let row = 0; row < rows; row++) {
    for (let column = 0; column < columns; column++) {
      const a = row * rowLength + column;
      indices.push(a, a + rowLength, a + 1, a + 1, a + rowLength, a + rowLength + 1);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function createLotus() {
  const lotus = new THREE.Group();
  const petalMaterial = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    side: THREE.DoubleSide,
    // A little pink glow of its own: the blue-teal pond light would otherwise
    // turn the petals lilac. Watercolour flowers glow, they are not shaded grey.
    emissive: new THREE.Color('#ff9ab8'),
    emissiveIntensity: 0.18,
  });

  // [petal count, length, half width, lift angle, curl, yaw offset]
  // Outer petals lie open and low; inner ones stand up tighter.
  const petalRings = [
    [9, 1.25, 0.42, 0.12, 0.35, 0],
    [8, 1.05, 0.38, 0.55, 0.45, 0.35],
    [6, 0.72, 0.3, 0.75, 0.3, 0.1], // not too upright: keep the golden centre visible
  ];
  for (const [petalCount, length, halfWidth, lift, curl, yawOffset] of petalRings) {
    const geometry = createPetalGeometry(length, halfWidth, lift, curl);
    for (let i = 0; i < petalCount; i++) {
      const petal = new THREE.Mesh(geometry, petalMaterial);
      // Spread evenly around the centre; the offset staggers each ring so
      // inner petals sit in the gaps between outer ones.
      petal.rotation.y = (i / petalCount) * Math.PI * 2 + yawOffset;
      lotus.add(petal);
    }
  }

  // Golden seed head in the middle with an orange ring of stamens.
  const seedHead = new THREE.Mesh(
    new THREE.CylinderGeometry(0.3, 0.24, 0.16, 20),
    new THREE.MeshStandardMaterial({ color: '#f2c94c', roughness: 0.7 }),
  );
  seedHead.position.y = 0.34;
  lotus.add(seedHead);
  const stamens = new THREE.Mesh(
    new THREE.TorusGeometry(0.34, 0.07, 8, 24),
    new THREE.MeshStandardMaterial({ color: '#f0a03a', roughness: 0.8 }),
  );
  stamens.rotation.x = Math.PI / 2;
  stamens.position.y = 0.3;
  lotus.add(stamens);
  return lotus;
}

// ---------------------------------------------------------------------------
// LAYOUT — clusters like the painting: top-right, bottom-left, one on the
// right. (x: -1 left .. +1 right, z: -1 top .. +1 bottom of the screen;
// values beyond +-1 hang off the screen.)
// ---------------------------------------------------------------------------
const padLayout = [
  // top-right cluster
  { x: 0.93, z: -0.85, radius: 3.0 },
  { x: 0.6, z: -1.02, radius: 2.1 },
  { x: 1.03, z: -0.38, radius: 2.3 },
  // bottom-left cluster
  { x: -0.95, z: 0.8, radius: 3.2 },
  { x: -0.6, z: 1.02, radius: 2.2 },
  { x: -1.02, z: 0.3, radius: 1.9 },
  // right side, lower
  { x: 0.98, z: 0.55, radius: 1.8 },
  // small pads that carry the lotus flowers
  { x: 0.22, z: -0.62, radius: 1.8, lotusScale: 1.5 },
  { x: -0.7, z: 0.58, radius: 1.3, lotusScale: 1.05 },
];

const SURFACE_Y = 0.02; // a hair above the water surface plane

export function createLilies(floorY) {
  const group = new THREE.Group();
  const padGeometry = createPadGeometry();
  const items = [];

  padLayout.forEach((spec, index) => {
    const padMaterial = new THREE.ShaderMaterial({
      uniforms: { uSeed: { value: Math.random() * 10 } },
      vertexShader: padVertexShader,
      fragmentShader: padFragmentShader,
    });
    const pad = new THREE.Mesh(padGeometry, padMaterial);
    pad.scale.setScalar(spec.radius);
    const baseYaw = Math.random() * Math.PI * 2; // notches point every which way
    pad.rotation.y = baseYaw;
    group.add(pad);

    const heightAboveFloor = SURFACE_Y - floorY;
    const padShadow = createDiscShadow(spec.radius * 1.02, 0.4, 0.34);
    group.add(padShadow);

    let lotus = null;
    let lotusShadow = null;
    if (spec.lotusScale) {
      lotus = createLotus();
      lotus.scale.setScalar(spec.lotusScale);
      group.add(lotus);
      lotusShadow = createDiscShadow(1.6 * spec.lotusScale, 0.6, 0.3);
      group.add(lotusShadow);
    }

    items.push({ spec, pad, padShadow, lotus, lotusShadow, baseYaw, index, heightAboveFloor });
  });

  function placeShadow(shadowMesh, x, z, heightAboveFloor) {
    shadowMesh.position.set(
      x + SHADOW_SHIFT_PER_HEIGHT.x * heightAboveFloor,
      floorY + 0.03,
      z + SHADOW_SHIFT_PER_HEIGHT.y * heightAboveFloor,
    );
  }

  return {
    group,

    /** Re-place everything for the current visible pond size. */
    layout(pondSize) {
      const halfWidth = pondSize.x / 2;
      const halfLength = pondSize.z / 2;
      for (const item of items) {
        const x = item.spec.x * halfWidth;
        const z = item.spec.z * halfLength;
        item.pad.position.set(x, SURFACE_Y, z);
        placeShadow(item.padShadow, x, z, item.heightAboveFloor);
        if (item.lotus) {
          item.lotus.position.set(x, SURFACE_Y + 0.05, z);
          // The flower stands higher than the pad, so its shadow lands further away.
          placeShadow(item.lotusShadow, x, z, item.heightAboveFloor + 0.6);
        }
      }
    },

    /** Gentle drifting: pads turn a little, flowers bob. */
    update(elapsedSeconds) {
      for (const item of items) {
        // Each item gets its own timing (index) so they do not move in sync.
        item.pad.rotation.y = item.baseYaw + 0.05 * Math.sin(elapsedSeconds * 0.25 + item.index * 1.7);
        if (item.lotus) {
          item.lotus.rotation.y = 0.08 * Math.sin(elapsedSeconds * 0.2 + item.index);
          item.lotus.position.y = SURFACE_Y + 0.05 + 0.03 * Math.sin(elapsedSeconds * 0.9 + item.index);
        }
      }
    },
  };
}
