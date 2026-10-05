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
import { fishWaveUniforms, koiWaveGlsl, KOI_NOSE_Z, KOI_STALK_Z } from './fish.js';

// SUN DIRECTION (fake): for every 1 unit an object is above the floor, its
// shadow moves this far on the floor. -x = screen left, +z = screen down, so
// shadows fall down-left: the sun is up and to the right, as in the painting.
export const SHADOW_SHIFT_PER_HEIGHT = new THREE.Vector2(-0.32, 0.42);

const shadowColor = /* glsl */ `vec3(4.0, 34.0, 46.0) / 255.0`; // deep teal ink

// ---------------------------------------------------------------------------
// FISH SHADOWS — one InstancedMesh, one flat rectangle per koi. The fragment
// shader "cuts out" a koi silhouette inside the rectangle with maths.
// ---------------------------------------------------------------------------
// Rectangle that covers the whole koi in its local x/z (with spare room for
// the tail swing and the blur).
const SHADOW_HALF_WIDTH = 1.5;
const SHADOW_FRONT_Z = 1.9;
const SHADOW_BACK_Z = -3.5;

const fishShadowVertexShader = /* glsl */ `
  ${koiWaveGlsl}
  attribute float aShadowBlur;
  varying vec2 vLocalXz;
  varying float vBlur;
  void main() {
    // 'position' is in the fish's local space, flat on the floor plane.
    vLocalXz = position.xz;
    // Bend the silhouette with the SAME swim wave as the koi. We move the
    // lookup point the opposite way (minus) instead of moving vertices, so
    // the rectangle can stay a simple 2-triangle quad.
    vLocalXz.x -= koiBodyOffsetX(position.z);
    vBlur = aShadowBlur;
    gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position, 1.0);
  }
`;

const fishShadowFragmentShader = /* glsl */ `
  varying vec2 vLocalXz;
  varying float vBlur;

  // Same body outline as koiProfile() in fish.js (round head, long taper).
  float koiProfile(float t) {
    if (t < 0.32) {
      float k = t / 0.32;
      return sqrt(max(0.0, 1.0 - (1.0 - k) * (1.0 - k)));
    }
    float k = (t - 0.32) / 0.68;
    return mix(1.0, 0.15, pow(k, 1.4));
  }

  // "softInside(distance)" = 1 well inside a shape, 0 well outside, with a
  // soft ramp of width vBlur across the edge. Negative distance = inside.
  float softInside(float signedDistance) {
    return 1.0 - smoothstep(-vBlur, vBlur, signedDistance);
  }

  void main() {
    float x = vLocalXz.x;
    float z = vLocalXz.y;

    // BODY: how far is this point outside the koi outline at this z?
    float t = clamp((${KOI_NOSE_Z.toFixed(2)} - z) / ${(KOI_NOSE_Z - KOI_STALK_Z).toFixed(2)}, 0.0, 1.0);
    float bodyHalfWidth = 0.46 * koiProfile(t);
    float body = softInside(abs(x) - bodyHalfWidth);
    // Cut off in front of the nose and behind the stalk.
    body *= softInside(z - ${KOI_NOSE_Z.toFixed(2)}) * softInside(${KOI_STALK_Z.toFixed(2)} - z);

    // TAIL: the see-through fan casts a lighter shadow (0.45). Same fan
    // shape as fish.js: narrow root, flaring out over its length.
    float tailV = (-1.45 - z) / 1.65;
    float tailHalfWidth = 0.1 + 0.9 * smoothstep(0.0, 0.7, tailV);
    float tail = softInside(abs(x) - tailHalfWidth) * softInside(-tailV) * softInside(tailV - 1.0);

    // PECTORAL FINS: two light ovals behind the head.
    vec2 finOffset = vec2(abs(x) - 0.75, z - 0.15);
    float fins = softInside(length(finOffset / vec2(0.42, 0.32)) - 1.0);

    float shade = max(body, max(tail * 0.45, fins * 0.4));
    gl_FragColor = vec4(${shadowColor}, shade * 0.5);
  }
`;

export function createFishShadows(fishMesh, count, floorY) {
  const geometry = new THREE.PlaneGeometry(
    SHADOW_HALF_WIDTH * 2,
    SHADOW_FRONT_Z - SHADOW_BACK_Z,
  );
  geometry.rotateX(-Math.PI / 2); // lie flat, facing up
  // After rotating, the plane spans z from -length/2 to +length/2. Slide it so
  // it covers SHADOW_BACK_Z .. SHADOW_FRONT_Z (the koi's nose is at +z).
  geometry.translate(0, 0, (SHADOW_FRONT_Z + SHADOW_BACK_Z) / 2);

  // Share the koi's phase attributes so the shadow wiggles in sync.
  geometry.setAttribute('aPhase', fishMesh.geometry.getAttribute('aPhase'));
  geometry.setAttribute('aWiggleMul', fishMesh.geometry.getAttribute('aWiggleMul'));
  const blur = new Float32Array(count);
  const blurAttribute = new THREE.InstancedBufferAttribute(blur, 1);
  blurAttribute.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('aShadowBlur', blurAttribute);

  const material = new THREE.ShaderMaterial({
    uniforms: { ...fishWaveUniforms },
    vertexShader: fishShadowVertexShader,
    fragmentShader: fishShadowFragmentShader,
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

        // Higher fish = softer shadow edge.
        blur[i] = 0.08 + 0.05 * heightAboveFloor;
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
