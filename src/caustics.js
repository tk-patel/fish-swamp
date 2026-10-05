// caustics.js — step 7.3: sunlight patterns on the pond floor + light shafts.
//
// CAUSTICS = the bright, wobbling web of lines you see on a pool floor. Ripples
// on the water surface act like thousands of tiny lenses that focus sunlight
// into bright lines. We do not simulate that; we FAKE it with a math pattern
// that looks similar, computed per pixel in the fragment shader and ADDED to
// the surface color as extra light.
//
// LIGHT SHAFTS = a few see-through cones from the surface down to the floor,
// drawn with ADDITIVE blending (new color is added on top of what is already
// on screen, so overlapping beams get brighter — exactly how light behaves).

import * as THREE from 'three';
import { pondLength, pondWaterDepth, pondWidth } from './pond.js';

export const causticUniforms = {
  uCausticTime: { value: 0 },
  uCausticStrength: { value: 0.5 },
};

/**
 * Adds the animated caustic pattern to a MeshStandardMaterial (floor, rocks).
 * Same onBeforeCompile trick as the fish wiggle (2.5) and plant sway (7.2),
 * but this time we edit the FRAGMENT shader (runs per pixel).
 */
export function addCausticsToMaterial(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uCausticTime = causticUniforms.uCausticTime;
    shader.uniforms.uCausticStrength = causticUniforms.uCausticStrength;

    // VERTEX: remember where this point is in the WORLD. The caustic pattern
    // is drawn in world coordinates so it stays continuous across the floor
    // and rocks instead of restarting on every object.
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>
         varying vec3 vCausticWorldPosition;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         vCausticWorldPosition = (modelMatrix * vec4(transformed, 1.0)).xyz;`,
      );

    // FRAGMENT: define the pattern function, then add it to the final color.
    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>
         uniform float uCausticTime;
         uniform float uCausticStrength;
         varying vec3 vCausticWorldPosition;

         // A well-known procedural "water caustic" pattern. Idea: take the
         // position, repeatedly wobble it with sin/cos (each pass bends the
         // coordinates more), and measure how much the wobbled points bunch up.
         // Where they bunch up it is bright; elsewhere dark. The result is a
         // web of glowing lines. Changing uCausticTime moves the wobble, so
         // the web slowly swims around.
         float causticPattern(vec2 position2d, float time) {
           const float TAU = 6.28318530718;
           // mod(..., TAU): repeat the pattern so it tiles seamlessly.
           vec2 p = mod(position2d * TAU, TAU) - 250.0;
           vec2 wobbled = p;
           float brightness = 1.0;
           const float intensity = 0.005;
           for (int pass = 0; pass < 4; pass++) {
             float t = time * (1.0 - (3.5 / float(pass + 1)));
             wobbled = p + vec2(
               cos(t - wobbled.x) + sin(t + wobbled.y),
               sin(t - wobbled.y) + cos(t + wobbled.x)
             );
             brightness += 1.0 / length(vec2(
               p.x / (sin(wobbled.x + t) / intensity),
               p.y / (cos(wobbled.y + t) / intensity)
             ));
           }
           brightness /= 4.0;
           brightness = 1.17 - pow(brightness, 1.4);
           // pow(.., 8) squeezes everything dark except the sharpest lines.
           return pow(abs(brightness), 8.0);
         }`,
      )
      .replace(
        '#include <opaque_fragment>',
        `// 0.06: one pattern tile covers ~16 world units. Two copies at
         // different scales/speeds look less repetitive than one.
         float causticA = causticPattern(vCausticWorldPosition.xz * 0.06, uCausticTime * 0.5 + 23.0);
         float causticB = causticPattern(vCausticWorldPosition.xz * 0.095 + 0.37, uCausticTime * 0.7 + 7.0);
         float causticLight = (causticA + causticB) * 0.5;
         // Slightly warm-white light added ON TOP of the lit surface.
         outgoingLight += vec3(1.0, 0.97, 0.85) * causticLight * uCausticStrength;
         #include <opaque_fragment>`,
      );
  };
}

// ---------------------------------------------------------------------------
// LIGHT SHAFTS
// ---------------------------------------------------------------------------
const lightShaftVertexShader = /* glsl */ `
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;

  void main() {
    vUv = uv; // uv.y goes 0 (bottom of the cone) to 1 (top)
    vNormalView = normalize(normalMatrix * normal);
    vec4 viewPosition = modelViewMatrix * vec4(position, 1.0);
    vViewPosition = viewPosition.xyz;
    gl_Position = projectionMatrix * viewPosition;
  }
`;

const lightShaftFragmentShader = /* glsl */ `
  uniform float uTime;
  uniform float uPhase;
  uniform float uStrength;
  uniform vec3 uColor;
  varying vec2 vUv;
  varying vec3 vNormalView;
  varying vec3 vViewPosition;

  void main() {
    // SOFT EDGES: a hard-edged cone looks like a plastic prop. dot(normal, toCamera)
    // is 1 where the surface faces us (the middle of the beam) and 0 at the
    // silhouette edge, so squaring it fades the beam out toward its sides.
    float facing = abs(dot(normalize(vNormalView), normalize(-vViewPosition)));
    float softEdge = facing * facing;

    // Beams are brightest near the surface and fade as they go deeper.
    float depthFade = smoothstep(0.0, 1.0, vUv.y);

    // Slow breathing, different for every beam (uPhase).
    float breathing = 0.65 + 0.35 * sin(uTime * 0.6 + uPhase);

    gl_FragColor = vec4(uColor, uStrength * softEdge * depthFade * breathing);
  }
`;

export function createLightShafts(shaftCount = 9) {
  const group = new THREE.Group();
  const shaftHeight = pondWaterDepth; // surface to floor
  // Cone wider at the bottom than the top: light spreads as it travels.
  const geometry = new THREE.CylinderGeometry(1.2, 3.2, shaftHeight, 24, 1, true);
  const shaftMaterials = [];

  for (let i = 0; i < shaftCount; i++) {
    const material = new THREE.ShaderMaterial({
      vertexShader: lightShaftVertexShader,
      fragmentShader: lightShaftFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uPhase: { value: Math.random() * Math.PI * 2 },
        uStrength: { value: 0.3 + Math.random() * 0.15 },
        uColor: { value: new THREE.Color(0.75, 0.95, 1.0) },
      },
      transparent: true,
      blending: THREE.AdditiveBlending,
      // depthWrite false: a see-through glow must not hide things behind it.
      depthWrite: false,
    });
    shaftMaterials.push(material);

    const shaft = new THREE.Mesh(geometry, material);
    shaft.position.set(
      (Math.random() - 0.5) * pondWidth,
      -pondWaterDepth / 2,
      (Math.random() - 0.5) * pondLength,
    );
    // Lean all beams the same way: they come from one sun (see sunLight in main.js).
    shaft.rotation.set(0.23, 0, -0.16);
    group.add(shaft);
  }

  return {
    group,
    update(elapsedSeconds) {
      for (const material of shaftMaterials) {
        material.uniforms.uTime.value = elapsedSeconds;
      }
    },
  };
}
