// Entry point: sets up the three things every 3D scene needs
// (scene, camera, renderer) and runs the render loop.

import * as THREE from 'three';
// OrbitControls is an "addon": it ships inside the three package but is not
// part of the core THREE object, so we import it from 'three/addons/...'.
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFish } from './fish.js';

// ---------------------------------------------------------------------------
// 1. SCENE - the "stage". An empty container that holds everything we want
//    to see: meshes, lights, and later fish. Nothing is drawn unless it is
//    added to the scene.
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();

// ---------------------------------------------------------------------------
// UNDERWATER MOOD, part 1: background + fog (step 0.5)
//
// Background: the color painted wherever nothing else is drawn. Before this
// it was black (the renderer default), which looks like space, not water.
// A THREE.Color can be made from a hex number: 0xRRGGBB, so 0x0a4a5c means
// red = 0x0a, green = 0x4a, blue = 0x5c -> a deep blue-green.
//
// Fog: objects far from the camera get blended toward the fog color, so they
// fade into the "murk". This is the single cheapest trick for faking water.
//   - Fog / linear:   fade starts at a `near` distance, fully gone at `far`.
//                     Easy to reason about, but the fade has hard-ish edges.
//   - FogExp2 / exponential: the fog thickens smoothly with distance, the way
//                     real haze does: blend = 1 - e^(-(density * distance)^2).
//                     You only tune one number: `density`.
// We use FogExp2 because it looks more natural.
//
// IMPORTANT: the fog color must equal the background color. If it didn't,
// far objects would fade into one color while the empty space behind them is
// another, and you'd see a visible "halo" of the wrong color.
// ---------------------------------------------------------------------------
const waterColor = new THREE.Color(0x0a4a5c);
scene.background = waterColor;
const fogDensity = 0.025; // bigger = murkier. Try 0.01 (clear) to 0.06 (soup).
scene.fog = new THREE.FogExp2(waterColor, fogDensity);

// ---------------------------------------------------------------------------
// 2. CAMERA - the "eye". PerspectiveCamera behaves like a real camera or your
//    eye: things farther away look smaller.
//
//    Arguments:
//      fov    (50)  - vertical field of view in degrees. Bigger = wider lens.
//      aspect       - width / height of the canvas. If this is wrong the
//                     picture looks stretched (resize handler below, step 0.4).
//      near   (0.1) - anything closer than this to the camera is not drawn.
//      far  (1000)  - anything farther than this is not drawn.
// ---------------------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
// By default the camera sits at (0, 0, 0) looking down the -Z axis.
// Our tank will be a box about 40 x 20 x 30 units centered on the origin, so
// we back the camera up along +Z (towards us) and lift it a little (+Y)
// to see all of it. OrbitControls (below) looks at the origin by default.
//
// TEMPORARY (step 1.1): a fish is only ~2 units long, so from the full-tank
// view at (0, 5, 35) it would be a speck. We stay close while we build one
// fish, off to the side (x = 7) so we see its long side profile instead of
// looking at its nose head-on. We go back to (0, 5, 35) at step 1.8 (the tank).
camera.position.set(7, 2, 4);

// ---------------------------------------------------------------------------
// 3. RENDERER - the "photographer". It takes the scene + camera and paints
//    the picture onto a <canvas> using WebGL (the browser's GPU API).
//    `antialias: true` smooths jagged edges.
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
// devicePixelRatio = how many real screen pixels make up one CSS pixel.
// 1 on a normal monitor, 2 on a Retina/HiDPI screen (a 2x2 block of tiny
// pixels per CSS pixel). If we ignore it, the canvas is drawn at CSS size
// and then stretched up by the browser, which looks blurry on Retina.
// We cap it at 2: phones can report 3+, and drawing 9x the pixels costs a
// lot of GPU time for a difference your eye can barely see.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// The renderer created its own <canvas> element; we put it in the page.
document.querySelector('#app').appendChild(renderer.domElement);

// ---------------------------------------------------------------------------
// RESIZE - when the window changes size we must update TWO things:
//   1. The renderer: resize the canvas so it still fills the window.
//   2. The camera's aspect ratio (width / height). The camera turns the 3D
//      world into a flat picture using a "projection matrix" (a grid of
//      numbers that squashes 3D coordinates onto a 2D screen). That matrix
//      has the aspect ratio baked in. If the window gets wider but the
//      camera still thinks it is the old shape, the cube looks stretched.
//      Changing camera.aspect does nothing by itself; we must call
//      updateProjectionMatrix() so the matrix is recalculated.
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// ORBIT CONTROLS - lets you move the camera with the mouse:
//   drag = orbit around the target, scroll = zoom, right-drag = pan.
// "Orbit" means the camera moves on a sphere around a target point
// (by default the origin, (0, 0, 0), the center of our tank) and always looks at it.
//
// Damping adds inertia: after you let go the camera glides to a stop
// instead of halting instantly. It feels much smoother, but it only works
// if we call controls.update() every frame (see animate()).
// ---------------------------------------------------------------------------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05; // smaller = longer glide

// ---------------------------------------------------------------------------
// UNDERWATER MOOD, part 2: lights
//
// Without light, a MeshStandardMaterial renders pure black. We use two:
//
// 1. HemisphereLight = soft "ambient" light from the whole sky dome.
//    You give it a SKY color (used by surfaces facing up) and a GROUND color
//    (used by surfaces facing down); surfaces facing sideways get a blend.
//    Underwater, light comes down from the bright surface, and the deep
//    below is dark and blue-green, so: pale cyan on top, dark teal below.
//    It has no direction and casts no shadows, so it gently fills in the
//    areas the sun doesn't reach (no pitch-black undersides).
//
// 2. DirectionalLight = the "sun" shining down through the water.
//    Parallel rays from one direction; its position only defines WHICH
//    direction (towards the origin). It adds the shaded/lit look that makes
//    shapes feel 3D. We keep it soft (low intensity, slightly blue-white)
//    since light is scattered underwater.
// ---------------------------------------------------------------------------
const skyColor = 0x9fe6ff; // light from above
const groundColor = 0x06232c; // light bounced up from the deep
const hemisphereLight = new THREE.HemisphereLight(skyColor, groundColor, 1.2);
scene.add(hemisphereLight);

const sunLight = new THREE.DirectionalLight(0xcfefff, 1.5);
sunLight.position.set(10, 30, 10); // high above, slightly off-center
scene.add(sunLight);

// ---------------------------------------------------------------------------
// THE FISH (step 1.1) - built in src/fish.js. We just add the returned Group
// to the scene. It sits at the origin (0, 0, 0) by default.
// ---------------------------------------------------------------------------
const fish = createFish();
scene.add(fish);

// TEMPORARY (step 1.3): AxesHelper draws three colored lines from the
// object's origin along its local axes, so you can SEE the directions:
//   RED   = local +X     GREEN = local +Y     BLUE = local +Z
// (Memory trick: R-G-B = X-Y-Z.) The argument is the length of each line.
// We add it to the FISH (not the scene) so it is a child of the fish and
// turns together with it, which shows the fish's LOCAL axes, not the world's.
// Our convention (see fish.js): the nose points along the BLUE line.
const fishAxes = new THREE.AxesHelper(2.5);
fish.add(fishAxes);

// ---------------------------------------------------------------------------
// TEMPORARY REFERENCE OBJECTS (sense of depth) - remove once fish exist.
// An empty blue-green void has no scale, so you can't tell how far anything
// is. These give your eye something to measure against:
//   - GridHelper: a flat grid of lines acting as the tank floor. The tank is
//     20 tall and centered on y = 0, so its floor is at y = -10.
//     Args: total size (120), number of divisions (60 -> 2-unit squares),
//     color of the center lines, color of the other lines.
//   - A few spheres at increasing distance, so you can watch the nearer ones
//     look crisp and lit while the far ones melt into the fog.
// ---------------------------------------------------------------------------
const referenceFloor = new THREE.GridHelper(120, 60, 0x4fb8c8, 0x1d7a8a);
referenceFloor.position.y = -10;
scene.add(referenceFloor);

const referenceSphereGeometry = new THREE.SphereGeometry(1.5, 24, 16);
const referenceSphereMaterial = new THREE.MeshStandardMaterial({ color: 0xffa94d });
const referenceSphereZPositions = [15, 0, -15, -30, -45];
referenceSphereZPositions.forEach((z, index) => {
  const sphere = new THREE.Mesh(referenceSphereGeometry, referenceSphereMaterial);
  // Alternate left/right so they don't hide behind each other.
  const x = index % 2 === 0 ? -5 : 5;
  sphere.position.set(x, -4, z);
  scene.add(sphere);
});

// ---------------------------------------------------------------------------
// TIMER - measures real time between frames.
// (The plan says THREE.Clock, but Clock is deprecated in the Three.js version
// we installed. THREE.Timer is its replacement and works the same way for us:
// "how many seconds passed since the last frame?")
// `connect(document)` makes the timer notice when the browser tab is hidden,
// so when you come back it doesn't report a huge, fake "delta" of minutes.
// ---------------------------------------------------------------------------
const timer = new THREE.Timer();
timer.connect(document);

// ---------------------------------------------------------------------------
// RENDER LOOP - a movie is many still pictures shown quickly. Each pass of
// this function draws one picture ("frame").
// requestAnimationFrame asks the browser: "call this function right before
// you paint the next frame". The browser usually does that 60 times per
// second on a 60 Hz monitor, but 144 on a 144 Hz one!
// ---------------------------------------------------------------------------
function animate() {
  // Schedule the NEXT call first, so the loop keeps going forever.
  requestAnimationFrame(animate);

  // Ask the timer to look at the clock now, so getDelta() is up to date.
  timer.update();

  // DELTA TIME = seconds since the previous frame.
  //   60 Hz screen  -> about 0.0167 s (1/60)
  //   144 Hz screen -> about 0.0069 s (1/144)
  // Always move things as `speed (units per second) * deltaSeconds`
  // (see step 0.3).
  const deltaSeconds = timer.getDelta();

  // TEMPORARY (step 1.3): turn the fish around its local Y (up) axis, 0.8
  // radians per second, to watch the axes and the nose rotate with it.
  // The blue line (+Z) and the nose should always stay together.
  // Delta time again: speed per second * seconds since last frame.
  fish.rotation.y += 0.8 * deltaSeconds;

  // Let OrbitControls apply the damping glide and move the camera.
  // Must happen before render so this frame uses the new camera position.
  controls.update();

  // Take the picture: draw `scene` as seen by `camera`.
  renderer.render(scene, camera);
}

animate();
