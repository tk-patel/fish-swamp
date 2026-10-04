// Entry point: sets up the three things every 3D scene needs
// (scene, camera, renderer) and runs the render loop.

import * as THREE from 'three';
// OrbitControls is an "addon": it ships inside the three package but is not
// part of the core THREE object, so we import it from 'three/addons/...'.
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { fishWaveUniforms, fishWaveSettings } from './fish.js';
import { applyFlockPreset, createFlock, flockPresets, flockSettings } from './flock.js';
// lil-gui draws a small control panel (sliders, checkboxes) in the corner of
// the page. We use it to tweak numbers live instead of edit-save-reload.
import GUI from 'lil-gui';

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
// view at (0, 5, 35) it would be a speck. We stay closer while we build one
// fish. (Step 1.5: moved back and up a little to see more of the area.)
// Step 1.8: back to the full-tank view (0, 5, 35) so the whole 40 x 20 x 30
// tank fits on screen. The fish is small from here; scroll to zoom in.
camera.position.set(0, 5, 35);

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
// FISH SCHOOL (steps 3.1–3.3) — InstancedMesh + typed-array flock in flock.js
// ---------------------------------------------------------------------------
// Step 4.7: try ?fish=300, ?fish=600, ?fish=1000 and watch FPS (O(n²) neighbor loops).
const fishCount = Number(new URLSearchParams(window.location.search).get('fish')) || 300;

// ---------------------------------------------------------------------------
// THE TANK (step 1.8) - the box the fish must stay inside.
// 40 wide (X) x 20 tall (Y) x 30 deep (Z), centered on the origin, so the
// walls are at x = +-20, y = +-10, z = +-15. The camera also goes back to
// the full-tank view (set where the camera is created).
//
// Two ways to keep fish inside:
//   HARD CLAMP: if position is outside, force it back to the wall.
//     Simple and a guaranteed rule, but the fish slams into an invisible wall
//     and gets stuck sliding along it, and the heading snaps. Looks fake.
//   SOFT BOUNDARY (what we use): near a wall, add a steering force pointing
//     inward that gets STRONGER the closer the fish is. The fish sees the wall
//     coming and curves away early, like a real fish. It is just one more
//     steering arrow, added to the same sum as wander.
// ---------------------------------------------------------------------------
const tankSize = new THREE.Vector3(40, 20, 30);

// TEMPORARY wireframe so we can see the tank. BoxGeometry has two triangles
// per face; EdgesGeometry keeps only the real box edges (12 lines) so we do
// not see the diagonal lines through each face. LineSegments draws them.
const tankWireframe = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(tankSize.x, tankSize.y, tankSize.z)),
  new THREE.LineBasicMaterial({ color: 0x7fe0ff }),
);
scene.add(tankWireframe);

const flock = createFlock(fishCount, tankSize);
scene.add(flock.mesh);
scene.add(flock.perceptionSphereDebug);

// Step 4.1 debug: N cycles which fish is highlighted (magenta) and tints neighbors cyan.
window.addEventListener('keydown', (event) => {
  if (event.key === 'n' || event.key === 'N') {
    flock.cycleWatchFish();
    console.log(`watching fish #${flock.watchFishIndex()}, neighbors: ${flock.neighborCount()}`);
  }
});

// ---------------------------------------------------------------------------
// TEMPORARY REFERENCE FLOOR (sense of depth).
// An empty blue-green void has no scale, so you can't tell how far anything
// is. GridHelper gives your eye something to measure against: a flat grid of
// lines acting as the tank floor. The tank is 20 tall and centered on y = 0,
// so its floor is at y = -10.
//   Args: total size (120), number of divisions (60 -> 2-unit squares),
//   color of the center lines, color of the other lines.
// ---------------------------------------------------------------------------
const referenceFloor = new THREE.GridHelper(120, 60, 0x4fb8c8, 0x1d7a8a);
referenceFloor.position.y = -10;
scene.add(referenceFloor);

// (Step 1.8: the reference spheres were removed - there is a fish and a tank
// to look at now, and spheres floating inside the tank would look like
// obstacles the fish swims through.)

// ---------------------------------------------------------------------------
// PERFORMANCE READOUT (step 2.3) - a small text box in the bottom-left corner.
//   FPS        = frames per second actually achieved (60 is the goal).
//   draw calls = how many times per frame the CPU tells the GPU "draw this
//                mesh". renderer.info.render.calls counts them for us.
//   triangles  = how many triangles the GPU had to draw per frame.
//
// WHY DRAW CALLS MATTER: each separate Mesh costs one draw call, and each
// draw call has a fixed CPU cost (the browser must validate state, send
// commands to the graphics driver, ...). The GPU itself can draw millions of
// triangles easily, but the CPU can only SEND maybe a few thousand draw calls
// per frame before the frame rate drops. So "many small meshes" is slow
// even if every mesh is tiny.
//
// Step 3.1: all 300 fish are ONE InstancedMesh = one fish draw call (plus
// the tank wireframe, grid floor, lights, ...).
// ---------------------------------------------------------------------------
const statsBox = document.createElement('div');
statsBox.style.cssText =
  'position:fixed;left:8px;bottom:8px;padding:6px 8px;background:rgba(0,0,0,0.55);' +
  'color:#cfefff;font:12px/1.4 monospace;pointer-events:none;white-space:pre;';
document.body.appendChild(statsBox);

// ---------------------------------------------------------------------------
// TUNING PANEL (step 2.6) - lil-gui. `gui.add(object, 'property', min, max,
// step)` makes a slider that edits object.property live. Our shader reads the
// uniform objects every frame, so moving a slider changes the fish instantly.
//
//   amplitude  - how far the tail swings sideways. 0 = a stiff fish.
//   wavelength - how much of the S-curve fits along the body. Small = tight
//                ripples (an eel / snake), large = one gentle bend (a tuna).
//                Roughly: wavelength near the body length (~3) looks natural.
//   speed      - how fast the wave travels = how quickly the tail beats.
// ---------------------------------------------------------------------------
const gui = new GUI();
const waveFolder = gui.addFolder('Swim wave');
waveFolder.add(fishWaveUniforms.uAmplitude, 'value', 0, 1, 0.01).name('amplitude');
waveFolder.add(fishWaveUniforms.uWavelength, 'value', 0.5, 8, 0.1).name('wavelength');
waveFolder.add(fishWaveSettings, 'speed', 0, 25, 0.1).name('speed (rad/s)');

// Step 4.6 — live flock tuning (presets in flock.js flockPresets).
const flockFolder = gui.addFolder('Flocking');
flockFolder.add(flockSettings, 'separationWeight', 0, 4, 0.05).name('separation');
flockFolder.add(flockSettings, 'alignmentWeight', 0, 3, 0.05).name('alignment');
flockFolder.add(flockSettings, 'cohesionWeight', 0, 3, 0.05).name('cohesion');
flockFolder.add(flockSettings, 'wanderWeight', 0, 3, 0.05).name('wander');
flockFolder.add(flockSettings, 'maxSpeed', 0.5, 5, 0.1).name('max speed');
flockFolder.add(flockSettings, 'minSpeed', 0.2, 2, 0.05).name('min speed');
flockFolder.add(flockSettings, 'maxSteeringForce', 1, 10, 0.25).name('max steer');
flockFolder.add(flockSettings, 'perceptionRadius', 2, 16, 0.5).name('perception');
const presetActions = {
  idle: () => applyFlockPreset(flockPresets.idle),
  tightSchool: () => applyFlockPreset(flockPresets.tightSchool),
  scatter: () => applyFlockPreset(flockPresets.scatter),
};
flockFolder.add(presetActions, 'idle').name('preset: idle');
flockFolder.add(presetActions, 'tightSchool').name('preset: tight school');
flockFolder.add(presetActions, 'scatter').name('preset: scatter');

let framesSinceStatsUpdate = 0;
let secondsSinceStatsUpdate = 0;

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

  flock.update(deltaSeconds);

  // Let OrbitControls apply the damping glide and move the camera.
  // Must happen before render so this frame uses the new camera position.
  controls.update();

  // Take the picture: draw `scene` as seen by `camera`.
  renderer.render(scene, camera);

  // Update the readout twice a second (updating text every frame would
  // itself cost time and be unreadable). FPS = frames / seconds elapsed.
  framesSinceStatsUpdate += 1;
  secondsSinceStatsUpdate += deltaSeconds;
  if (secondsSinceStatsUpdate >= 0.5) {
    const fps = framesSinceStatsUpdate / secondsSinceStatsUpdate;
    statsBox.textContent =
      `FPS:        ${fps.toFixed(0)}\n` +
      `fish:       ${fishCount}\n` +
      `draw calls: ${renderer.info.render.calls}\n` +
      `triangles:  ${renderer.info.render.triangles}`;
    framesSinceStatsUpdate = 0;
    secondsSinceStatsUpdate = 0;
  }
}

animate();
