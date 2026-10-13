// water.js — the watercolour pond floor (phase 9).
//
// A flat painted layer at y = -pondWaterDepth. Fish shadows land on it
// (shadows.js). The camera looks straight down, so this is the "water"
// colour you see under the koi.
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
