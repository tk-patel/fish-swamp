// pond.js — the shape of the pond + the water look (phase 7).
//
// The pond is a SHALLOW box of water. World layout (units):
//   y = 0                  water surface
//   y = -pondWaterDepth    pond floor (sand, rocks and plants live here, step 7.2)
//   x: -pondWidth/2 .. +pondWidth/2     z: -pondLength/2 .. +pondLength/2
//
// Earlier (first 7.1 attempt) the swim area was recomputed from the camera
// every frame. That made the pond "breathe" whenever you orbited, and a deep
// column looked dark and empty from above. A fixed, shallow box is simpler
// and lets us SEE the floor through the water.

import * as THREE from 'three';

export const pondWidth = 46; // x
export const pondLength = 30; // z
export const pondWaterDepth = 6; // y — shallow: you can see the bottom

/** Full pond size as a Vector3 (x = width, y = depth, z = length) for the flock. */
export function createPondSize() {
  return new THREE.Vector3(pondWidth, pondWaterDepth, pondLength);
}

// Fog color = the color the far water fades into. The background gradient
// ends in the same color so the horizon blends instead of showing a seam.
const fogColor = new THREE.Color(0x2b8596);

/**
 * Vertical gradient behind the scene: brighter at the top (light coming from
 * the surface), settling into the fog color lower down.
 * A CanvasTexture is just a 2D drawing (here: a gradient) used as an image.
 */
export function applyWaterGradientBackground(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 4; // only the vertical direction changes, so 4px wide is plenty
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#6fd0e0');
  gradient.addColorStop(0.5, '#3d9fb2');
  gradient.addColorStop(1, '#2b8596');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  scene.background = texture;
  return texture;
}

/**
 * Light murk. FogExp2 blends things toward fogColor the farther they are:
 * factor = 1 - exp(-(density * distance)^2). Low density = clear shallow water.
 */
export function applyPondFog(scene, density = 0.008) {
  scene.fog = new THREE.FogExp2(fogColor, density);
  return scene.fog;
}
