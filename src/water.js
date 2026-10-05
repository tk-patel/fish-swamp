// water.js — the watercolour pond (phase 9).
//
// Two flat layers, seen from the camera straight above:
//
//   y = 0                   SURFACE: transparent, only draws faint ripple
//                           rings around fish swimming near the top.
//   ...fish swim here...
//   y = -pondWaterDepth     FLOOR: the painted water colour, fish shadows
//                           land on it (shadows.js).
//
// Both use a ShaderMaterial: we write the whole colour recipe ourselves instead
// of using Three's lighting. A painting has no real light, so a hand-made
// "paint recipe" matches the reference picture better than physical lighting.
//
// COLOUR NOTE: ShaderMaterial writes gl_FragColor straight to the screen, so
// the colours below are normal screen (sRGB) colours, the same numbers you
// would use in CSS. (/255 turns a 0..255 CSS value into GLSL's 0..1.)

import * as THREE from 'three';
import { noiseGlsl } from './shaders/noise.js';

// Shared by both layers: the vertex shader only needs to pass the WORLD x/z of
// each pixel along, so the pattern is fixed to the pond, not to the screen.
const worldXzVertexShader = /* glsl */ `
  varying vec2 vWorldXz;
  void main() {
    vec4 worldPosition = modelMatrix * vec4(position, 1.0);
    vWorldXz = worldPosition.xz;
    gl_Position = projectionMatrix * viewMatrix * worldPosition;
  }
`;

// ---------------------------------------------------------------------------
// FLOOR — the watercolour wash
// ---------------------------------------------------------------------------
const floorFragmentShader = /* glsl */ `
  uniform float uTime;
  varying vec2 vWorldXz;
  ${noiseGlsl}

  void main() {
    // Scale world units down: one blotch should be several fish wide.
    vec2 p = vWorldXz * 0.07;

    // DOMAIN WARP: look up the noise at a position that is itself pushed
    // around by noise. Straight fbm looks like cloudy smoke; warped fbm gets
    // the swirly, "pigment flowed in the water" shapes of a watercolour.
    // uTime makes the warp drift very slowly so the pond feels alive.
    vec2 warp = vec2(
      fbm(p + vec2(0.0, uTime * 0.012)),
      fbm(p + vec2(5.2, 1.3) - uTime * 0.009)
    );
    float wash = fbm(p * 1.3 + warp * 1.8);

    // Three paint colours from the reference: deep blue-teal, teal, turquoise.
    vec3 deepTeal = vec3(12.0, 70.0, 92.0) / 255.0;
    vec3 midTeal = vec3(24.0, 124.0, 140.0) / 255.0;
    vec3 lightTurquoise = vec3(72.0, 182.0, 180.0) / 255.0;

    // smoothstep(a, b, x): 0 below a, 1 above b, soft S-curve in between.
    // Low noise -> deep, middle -> mid, high -> light. Soft bands = wet edges.
    vec3 color = mix(deepTeal, midTeal, smoothstep(0.32, 0.52, wash));
    color = mix(color, lightTurquoise, smoothstep(0.56, 0.74, wash));

    // PIGMENT EDGES: when a watercolour wash dries, pigment piles up along its
    // border, leaving a slightly darker line. abs(wash - 0.54) is 0 exactly on
    // one "contour" of the noise, so we darken a thin band around it.
    float edgeLine = 1.0 - smoothstep(0.0, 0.02, abs(wash - 0.54));
    color *= 1.0 - 0.16 * edgeLine;

    // LIGHT NETWORK (fake caustics): 1 - |2n - 1| makes a sharp ridge wherever
    // the noise crosses 0.5; pow(..., 8) keeps only the thin crest. Moving the
    // input with uTime makes soft light lines wander over the floor.
    float ridgeNoise = fbm(p * 2.6 + warp * 1.2 + vec2(uTime * 0.03, -uTime * 0.02));
    float caustic = pow(1.0 - abs(ridgeNoise * 2.0 - 1.0), 8.0);
    color += vec3(0.55, 0.85, 0.8) * caustic * 0.10;

    // VIGNETTE: darker toward the edge of the pond, like the deep corners of
    // the painting. length() = distance from the pond centre in world units.
    float distanceFromCentre = length(vWorldXz * vec2(0.85, 1.25));
    color *= 1.0 - 0.22 * smoothstep(8.0, 22.0, distanceFromCentre);

    // PAPER GRAIN: a tiny random brightness change per world spot, like the
    // texture of watercolour paper showing through.
    color *= 0.97 + 0.06 * hash12(floor(vWorldXz * 18.0));

    gl_FragColor = vec4(color, 1.0);
  }
`;

/**
 * The painted pond floor. Very large so it always covers the whole screen
 * (the camera sees a wider area at floor depth than at the surface).
 */
export function createWaterFloor(floorY) {
  const material = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 } },
    vertexShader: worldXzVertexShader,
    fragmentShader: floorFragmentShader,
  });
  // PlaneGeometry is made standing up in X/Y; rotate it -90 deg about X so it
  // lies flat (facing up, toward the camera).
  const geometry = new THREE.PlaneGeometry(200, 200);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = floorY;
  mesh.renderOrder = -10; // draw first; everything else lies on top of it

  return {
    mesh,
    update(elapsedSeconds) {
      material.uniforms.uTime.value = elapsedSeconds;
    },
  };
}

// ---------------------------------------------------------------------------
// SURFACE — ripple rings around fish near the top
// ---------------------------------------------------------------------------
// GLSL arrays need a fixed size known when the shader compiles, so we reserve
// room for this many fish. Extra fish simply make no ripples.
const MAX_RIPPLE_FISH = 32;

const surfaceFragmentShader = /* glsl */ `
  #define MAX_RIPPLE_FISH ${MAX_RIPPLE_FISH}
  uniform float uTime;
  // For each fish: xy = world x/z position, z = ripple strength (0 = deep
  // fish, no ripples), w = a per-fish random number so rings are not in sync.
  uniform vec4 uFish[MAX_RIPPLE_FISH];
  uniform int uFishCount;
  varying vec2 vWorldXz;
  ${noiseGlsl}

  void main() {
    float ink = 0.0;
    for (int i = 0; i < MAX_RIPPLE_FISH; i++) {
      if (i >= uFishCount) break;
      vec4 fish = uFish[i];
      if (fish.z <= 0.001) continue;

      vec2 offset = vWorldXz - fish.xy;
      float distanceToFish = length(offset);

      // RINGS: sin(distance * k - time) is a wave running OUTWARD (as time
      // grows, the same crest is found at a bigger distance). smoothstep
      // keeps only the very top of each crest = thin lines, not stripes.
      float wave = sin(distanceToFish * 4.2 - uTime * 2.2 - fish.w * 6.28);
      float ringLine = smoothstep(0.86, 1.0, wave);

      // Only between ~1.2 and ~4 units from the fish, fading out at both ends.
      float band = smoothstep(1.0, 1.8, distanceToFish) * (1.0 - smoothstep(2.6, 4.2, distanceToFish));

      // Painted ripples are broken ARCS, not perfect circles: a noise lookup
      // by angle around the fish erases some parts of each ring.
      float angle = atan(offset.y, offset.x);
      float arcMask = smoothstep(0.42, 0.62, valueNoise(vec2(angle * 1.6 + fish.w * 40.0, uTime * 0.25)));

      ink = max(ink, ringLine * band * arcMask * fish.z);
    }
    // Pale blue-white lines, mostly see-through.
    gl_FragColor = vec4(vec3(0.82, 0.95, 0.97), ink * 0.22);
  }
`;

/**
 * Transparent surface layer that paints ripple rings above shallow fish.
 * call update(elapsedSeconds, flock) every frame.
 */
export function createWaterSurface(surfaceY, swimTopY, swimBottomY) {
  const fishUniform = [];
  for (let i = 0; i < MAX_RIPPLE_FISH; i++) {
    fishUniform.push(new THREE.Vector4(0, 0, 0, Math.random()));
  }
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uFish: { value: fishUniform },
      uFishCount: { value: 0 },
    },
    vertexShader: worldXzVertexShader,
    fragmentShader: surfaceFragmentShader,
    transparent: true,
    depthWrite: false, // a see-through layer must not hide what is behind it
  });
  const geometry = new THREE.PlaneGeometry(200, 200);
  geometry.rotateX(-Math.PI / 2);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = surfaceY;
  mesh.renderOrder = 5; // after fish and fins

  return {
    mesh,
    update(elapsedSeconds, flock) {
      material.uniforms.uTime.value = elapsedSeconds;
      const count = Math.min(flock.positions.length / 3, MAX_RIPPLE_FISH);
      material.uniforms.uFishCount.value = count;
      for (let i = 0; i < count; i++) {
        const fishY = flock.positions[i * 3 + 1];
        // 0 for fish in the lower half of the water, rising to 1 for fish
        // close to the surface: only shallow swimmers disturb the surface.
        const depthMiddle = (swimTopY + swimBottomY) * 0.5;
        const nearSurface = THREE.MathUtils.smoothstep(fishY, depthMiddle, swimTopY);
        fishUniform[i].x = flock.positions[i * 3 + 0];
        fishUniform[i].y = flock.positions[i * 3 + 2];
        fishUniform[i].z = nearSurface;
      }
    },
  };
}
