// pond.js — the shape of the pond + the water look (phase 7, reshaped in 8.1).
//
// The pond is a SHALLOW box of water seen from directly above. There is no
// floor mesh, no rocks and no plants any more — only water. World layout:
//   y = 0                  water surface
//   y = -pondWaterDepth    bottom of the swim column
//   x: -width/2 .. +width/2     z: -length/2 .. +length/2
//
// The x/z size is NOT a fixed constant: it is worked out from what the camera
// can actually see (see computePondSizeFromCamera). That way the screen edges
// ARE the pond banks: a fish can never reach the edge of the picture, no
// matter how the window is resized.

import * as THREE from 'three';

// y — shallow water. Exported because the camera and the flock both care how
// deep the swim column is.
export const pondWaterDepth = 6;

/**
 * How big is the visible pond? Returns a Vector3 (x = width, y = depth,
 * z = length) sized so the whole screen is water: the camera looks straight
 * down at the surface (y = 0) and we match the pond to the camera's view.
 *
 * Side view of the camera frustum (the visible "cone" of the lens):
 *
 *        camera   (y = camera.position.y above the surface)
 *          |
 *          |\
 *          | \   <- half of the vertical field of view (fov / 2)
 *          |  \
 *          |   \
 *          |    \
 *   -------+-----+-------   water surface (y = 0)
 *          <-----> halfVisibleLength
 *
 * A field of view is an ANGLE. Half of that angle, seen from a distance,
 * covers a half-height of `distance * tan(halfAngle)` (plain trigonometry:
 * tan = opposite / adjacent). Here distance = camera height above the water.
 *
 * We measure at the SURFACE because that plane is nearest to the camera, so it
 * is the SMALLEST visible area. If the pond fits the surface, any fish deeper
 * down is well inside the frame too.
 */
export function computePondSizeFromCamera(camera) {
  const halfVisibleLength =
    camera.position.y * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
  const halfVisibleWidth = halfVisibleLength * camera.aspect;

  return new THREE.Vector3(2 * halfVisibleWidth, pondWaterDepth, 2 * halfVisibleLength);
}

// Fog color = the color the far water fades into. The background gradient
// ends in the same color so the horizon blends instead of showing a seam.
const fogColor = new THREE.Color(0x1fa8bf);

/**
 * Vertical gradient behind the scene: brighter at the top (sunlit shallow
 * water), settling into the fog color lower down.
 * A CanvasTexture is just a 2D drawing (here: a gradient) used as an image.
 */
export function applyWaterGradientBackground(scene) {
  const canvas = document.createElement('canvas');
  canvas.width = 4; // only the vertical direction changes, so 4px wide is plenty
  canvas.height = 256;
  const context = canvas.getContext('2d');
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, '#8ff0e6');
  gradient.addColorStop(0.5, '#3fd0d4');
  gradient.addColorStop(1, '#1fa8bf');
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
export function applyPondFog(scene, density = 0.01) {
  scene.fog = new THREE.FogExp2(fogColor, density);
  return scene.fog;
}
