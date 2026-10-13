// shadows.js — soft painted shadows on the pond floor (phase 9).
//
// In the reference painting every koi and lily pad has a soft dark twin on
// the pond bottom, shifted to one side. That shift is what makes the water
// look clear and shallow: your eye reads "the fish floats ABOVE the floor".
//
// We fake it instead of using Three's real shadow maps:
//   - a flat see-through shape lies on the floor under each object;
//   - it is pushed sideways in proportion to the object's HEIGHT above the
//     floor (higher fish = shadow further away, like sunlight at an angle);
//   - higher objects get softer (blurrier) shadow edges.
// Cheaper than shadow maps, and much easier to make look like a painting.

import * as THREE from 'three';
import { fishWaveUniforms, koiTextureGlsl, koiTextureUniforms, koiWaveGlsl } from './fish.js';

// SUN DIRECTION (fake): for every 1 unit an object is above the floor, its
// shadow moves this far on the floor. -x = screen left, +z = screen down, so
// shadows fall down-left: the sun is up and to the right, as in the painting.
export const SHADOW_SHIFT_PER_HEIGHT = new THREE.Vector2(-0.32, 0.42);

const shadowColor = /* glsl */ `vec3(4.0, 34.0, 46.0) / 255.0`; // deep teal ink

// ---------------------------------------------------------------------------
// FISH SHADOWS (step 9.3) — the shadow REUSES the koi's own geometry and
// painted texture. Same vertices, same swim bend (koiSwimPosition), same
// picture — but we only keep the picture's ALPHA (its shape) and paint it
// dark teal. So the shadow always matches the koi exactly, fins and all.
//
// Soft edges for free: texture2D(..., bias) asks the GPU for a SMALLER mipmap
// (a pre-shrunk, blurrier copy of the picture). Higher fish → bigger bias →
// blurrier shadow.
// ---------------------------------------------------------------------------
const fishShadowVertexShader = /* glsl */ `
  ${koiWaveGlsl}
  attribute vec2 aAtlasCell;
  attribute float aShadowBlur;
  varying vec2 vUv;
  varying vec2 vAtlasCell;
  varying float vKind;
  varying float vBlur;
  void main() {
    vUv = uv;
    vAtlasCell = aAtlasCell;
    vKind = aFin.w;
    vBlur = aShadowBlur;
    vec3 bent = koiSwimPosition(position);
    bent.y = 0.0; // squash fins and body onto the floor plane
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(bent, 1.0);
  }
`;

const fishShadowFragmentShader = /* glsl */ `
  ${koiTextureGlsl}
  varying vec2 vUv;
  varying vec2 vAtlasCell;
  varying float vKind;
  varying float vBlur;
  void main() {
    float shape = koiSample(vUv, vAtlasCell, vKind, vBlur).a;
    // Fins are thin and see-through, so their shadow is lighter.
    float strength = vKind > 0.5 ? 0.25 : 0.45;
    gl_FragColor = vec4(${shadowColor}, shape * strength);
  }
`;

export function createFishShadows(fishMesh, count, floorY) {
  // Same geometry object as the koi (shared GPU buffers). We only add one
  // extra per-fish value the koi shader ignores: how blurry the shadow is.
  const geometry = fishMesh.geometry;
  const blur = new Float32Array(count);
  const blurAttribute = new THREE.InstancedBufferAttribute(blur, 1);
  blurAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aShadowBlur', blurAttribute);

  const material = new THREE.ShaderMaterial({
    uniforms: { ...fishWaveUniforms, ...koiTextureUniforms },
    vertexShader: fishShadowVertexShader,
    fragmentShader: fishShadowFragmentShader,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: false,
  });

  const mesh = new THREE.InstancedMesh(geometry, material, count);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5; // right after the floor, before fish

  // Scratch objects reused every frame (no garbage for the browser to clean).
  const placement = new THREE.Object3D();
  const fishQuaternion = new THREE.Quaternion();
  const forward = new THREE.Vector3();

  return {
    mesh,
    /** Call every frame after flock.update(). */
    update(flock) {
      for (let i = 0; i < count; i++) {
        const fishX = flock.positions[i * 3 + 0];
        const fishY = flock.positions[i * 3 + 1];
        const fishZ = flock.positions[i * 3 + 2];
        const heightAboveFloor = Math.max(0, fishY - floorY);

        // Which way is the fish facing, seen from above? Rotate local
        // forward (+Z) by the fish's rotation, then atan2(x, z) gives the
        // angle around the vertical axis ("yaw"). The shadow is flat on the
        // floor, so yaw is the only rotation it needs.
        fishQuaternion.fromArray(flock.orientations, i * 4);
        forward.set(0, 0, 1).applyQuaternion(fishQuaternion);
        const yaw = Math.atan2(forward.x, forward.z);

        placement.position.set(
          fishX + SHADOW_SHIFT_PER_HEIGHT.x * heightAboveFloor,
          floorY + 0.02, // a hair above the floor so they do not flicker
          fishZ + SHADOW_SHIFT_PER_HEIGHT.y * heightAboveFloor,
        );
        placement.rotation.set(0, yaw, 0);
        // A tiny bit larger when far above the floor (light spreads out).
        placement.scale.setScalar(flock.scales[i] * (1 + 0.03 * heightAboveFloor));
        placement.updateMatrix();
        mesh.setMatrixAt(i, placement.matrix);

        // Higher fish = softer shadow edge (mipmap bias, ~1 = half-size copy).
        blur[i] = 1.5 + 0.45 * heightAboveFloor;
      }
      mesh.instanceMatrix.needsUpdate = true;
      blurAttribute.needsUpdate = true;
    },
  };
}

// ---------------------------------------------------------------------------
// ROUND SHADOWS for lily pads and lotus flowers (lilies.js).
// ---------------------------------------------------------------------------
const discShadowVertexShader = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const discShadowFragmentShader = /* glsl */ `
  uniform float uSoftness; // 0..1 fraction of the radius used for the soft edge
  uniform float uStrength;
  varying vec2 vUv;
  void main() {
    // uv runs 0..1 across the square; distance from its centre, scaled so
    // the square's edge is at 1.
    float distanceFromCentre = length(vUv - 0.5) * 2.0;
    float shade = 1.0 - smoothstep(1.0 - uSoftness, 1.0, distanceFromCentre);
    gl_FragColor = vec4(${shadowColor}, shade * uStrength);
  }
`;

/** A soft round shadow of the given radius, lying flat (place it yourself). */
export function createDiscShadow(radius, softness = 0.45, strength = 0.38) {
  const geometry = new THREE.PlaneGeometry(radius * 2, radius * 2);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.ShaderMaterial({
    uniforms: { uSoftness: { value: softness }, uStrength: { value: strength } },
    vertexShader: discShadowVertexShader,
    fragmentShader: discShadowFragmentShader,
    transparent: true,
    depthWrite: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = -5;
  return mesh;
}
