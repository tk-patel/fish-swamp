// pond.js — visible viewport as the swim area + water look (phase 7.1).

import * as THREE from 'three';

/** Shallow water column (fish stay near the pond mid-depth). */
export const pondWaterHeight = 10;

const pondPlaneY = 0;
const frustumCornerNdc = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [1, 1],
];

const rayOrigin = new THREE.Vector3();
const rayDirection = new THREE.Vector3();
const unprojectPoint = new THREE.Vector3();

/**
 * Where a screen corner's view ray hits the horizontal pond surface (y = pondPlaneY).
 * Returns null if the ray does not hit (camera parallel to the water).
 */
function intersectViewRayWithPondPlane(camera, ndcX, ndcY) {
  unprojectPoint.set(ndcX, ndcY, 0.5);
  unprojectPoint.unproject(camera);
  rayDirection.copy(unprojectPoint).sub(camera.position).normalize();
  rayOrigin.copy(camera.position);

  if (Math.abs(rayDirection.y) < 1e-5) {
    return null;
  }

  const travelDistance = (pondPlaneY - rayOrigin.y) / rayDirection.y;
  if (travelDistance <= 0) {
    return null;
  }

  return rayOrigin.clone().addScaledVector(rayDirection, travelDistance);
}

/**
 * Pond width/depth = frustum footprint on the water plane (× margin).
 * Resizes with window aspect and camera zoom (call each frame or on resize).
 */
export function computePondSizeFromCamera(camera, margin = 0.88) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  let hitCount = 0;

  for (const [ndcX, ndcY] of frustumCornerNdc) {
    const hit = intersectViewRayWithPondPlane(camera, ndcX, ndcY);
    if (!hit) {
      continue;
    }
    hitCount += 1;
    minX = Math.min(minX, hit.x);
    maxX = Math.max(maxX, hit.x);
    minZ = Math.min(minZ, hit.z);
    maxZ = Math.max(maxZ, hit.z);
  }

  if (hitCount < 4) {
    const aspect = camera.aspect || 1;
    const fallbackDepth = 28;
    return new THREE.Vector3(fallbackDepth * aspect, pondWaterHeight, fallbackDepth);
  }

  const width = Math.max((maxX - minX) * margin, 8);
  const depth = Math.max((maxZ - minZ) * margin, 8);
  return new THREE.Vector3(width, pondWaterHeight, depth);
}

const fogDeepColor = new THREE.Color(0x062a35);

/**
 * Vertical gradient: bright surface at top of screen, deep teal at bottom.
 * (CanvasTexture on scene.background — cheap and works on all GPUs.)
 */
export function applyWaterGradientBackground(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 512;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#6fd4f0');
  gradient.addColorStop(0.22, '#3aa8c4');
  gradient.addColorStop(0.55, '#1a6f82');
  gradient.addColorStop(1, '#062a35');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  scene.background = texture;

  return texture;
}

/** Murk that matches the deep end of the gradient so fish fade into the water. */
export function applyPondFog(scene, density = 0.022) {
  scene.fog = new THREE.FogExp2(fogDeepColor, density);
  return scene.fog;
}

export function getPondFogColor() {
  return fogDeepColor;
}
