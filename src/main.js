// Entry point: sets up the three things every 3D scene needs
// (scene, camera, renderer) and runs the render loop.

import * as THREE from 'three';
import { fishWaveUniforms, fishWaveSettings } from './fish.js';
import { applyFlockPreset, createFlock, flockPresets, flockSettings } from './flock.js';
import {
  getCalmness,
  getLoudnessVolatility,
  getMicrophoneAnalysisBuffers,
  getNormalizedLoudness,
  getSmoothedAudioMood,
  getSpectralFlux,
  isMicrophoneAnalysisReady,
  isNoiseFloorCalibrating,
  requestMicrophonePermission,
  recalibrateNoiseFloor,
  sampleMicrophoneAnalysis,
  startMicrophoneAnalysis,
  updateNoiseFloorCalibration,
  updateSmoothedAudioMood,
} from './audio.js';
import { applyMoodPreset, moodState, moodToFlockWeights, moodToSwimMood, smoothedFlockWeights, smoothedSwimMood, swimMoodToSpeedMultiplier, updateSmoothedFlockWeights, updateSmoothedSwimMood } from './mood.js';
import { computePondSizeFromCamera, pondWaterDepth } from './pond.js';
import { createWaterFloor, createWaterSurface } from './water.js';
import { createFishShadows } from './shadows.js';
import { createLilies } from './lilies.js';
// lil-gui draws a small control panel (sliders, checkboxes) in the corner of
// the page. We use it to tweak numbers live instead of edit-save-reload.
import GUI from 'lil-gui';

// ---------------------------------------------------------------------------
// 1. SCENE - the "stage". An empty container that holds everything we want
//    to see: meshes, lights, and later fish. Nothing is drawn unless it is
//    added to the scene.
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();

scene.background = new THREE.Color('#0a3e54'); // only visible for a moment before the painted floor draws

// ---------------------------------------------------------------------------
// 2. CAMERA - the "eye". PerspectiveCamera behaves like a real camera or your
//    eye: things farther away look smaller.
//
//    Arguments:
//      fov    (45)  - vertical field of view in degrees. Bigger = wider lens.
//      aspect       - width / height of the canvas. If this is wrong the
//                     picture looks stretched (resize handler below, step 0.4).
//      near   (0.1) - anything closer than this to the camera is not drawn.
//      far  (1000)  - anything farther than this is not drawn.
// ---------------------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(
  45,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
// Step 8.1 / 9.1 — the camera is FIXED. It sits straight above the middle of
// the pond at y = 22 and looks straight down, so the screen shows a top-down
// map of the water. There are no camera controls any more: the view cannot be
// moved or zoomed. We moved it closer than the old y = 34 because the koi are
// bigger and fewer now — a lower camera fills the frame with fewer, larger fish.
//
// Straight-down note: the camera's default "up" is +Y, but a camera looking
// down -Y cannot use "up" = +Y to decide which way is up on screen (the two
// point along the same line). We set "up" to world -Z instead, so the top of
// the screen is the far (+Z) end of the pond. Then lookAt locks the gaze.
camera.position.set(0, 22, 0);
camera.up.set(0, 0, -1);
camera.lookAt(0, 0, 0);

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
// MICROPHONE START SCREEN (step 6.1)
// The 3D scene runs immediately; this overlay sits on top until the user
// clicks. Only a click counts as a "user gesture" for getUserMedia.
// ---------------------------------------------------------------------------
const micOverlay = document.querySelector('#mic-overlay');
const micEnableButton = document.querySelector('#mic-enable-btn');
const micSkipButton = document.querySelector('#mic-skip-btn');
const micMessage = document.querySelector('#mic-message');

function hideMicOverlay() {
  micOverlay.classList.add('is-hidden');
}

function showMicError(friendlyText) {
  micMessage.textContent = friendlyText;
}

micSkipButton.addEventListener('click', () => {
  hideMicOverlay();
});

micEnableButton.addEventListener('click', async () => {
  micEnableButton.disabled = true;
  micMessage.textContent = '';

  const result = await requestMicrophonePermission();

  if (result.granted) {
    const analysis = await startMicrophoneAnalysis(result.stream);
    if (!analysis.ok) {
      micEnableButton.disabled = false;
      showMicError(
        analysis.error?.message ?? 'Microphone is on, but audio analysis failed to start.',
      );
      return;
    }
    hideMicOverlay();
    return;
  }

  micEnableButton.disabled = false;
  const err = result.error;
  if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
    showMicError(
      'Microphone access was blocked. You can allow it in the browser address bar and try again, or continue without the mic — the fish will keep swimming.',
    );
  } else if (err?.name === 'NotFoundError') {
    showMicError('No microphone was found on this device. Continue without the mic or plug one in and try again.');
  } else {
    showMicError(err?.message ?? 'Could not open the microphone. Try again or continue without it.');
  }
});

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
//
// Step 8.1 / 9.1 — the swim area is derived from the camera view, so a resize
// also changes how much water is visible. After updating the aspect we recompute
// the pond size ONCE and hand it to both the flock (so the fish use exactly the
// screen) and the lilies (so the pads stay in the corners). `lilies` is created
// later in this file, but this callback only runs on a real resize event — long
// after module load — so the reference is safe.
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  const nextPondSize = computePondSizeFromCamera(camera);
  flock.setPondSize(nextPondSize);
  lilies.layout(nextPondSize);
});

// ---------------------------------------------------------------------------
// UNDERWATER MOOD, part 2: lights
//
// Without light, a MeshStandardMaterial renders pure black. We use two:
//
// 1. HemisphereLight = soft "ambient" light from the whole sky dome.
//    You give it a SKY color (used by surfaces facing up) and a GROUND color
//    (used by surfaces facing down); surfaces facing sideways get a blend.
//    From above, light comes down from the bright turquoise surface, and the
//    water below bounces that same turquoise back up, so: pale cyan on top,
//    turquoise below (no sandy or plant-green floor any more, step 8.1).
//    It has no direction and casts no shadows, so it gently fills in the
//    areas the sun doesn't reach (no pitch-black undersides).
//
// 2. DirectionalLight = the "sun" shining down through the water.
//    Parallel rays from one direction; its position only defines WHICH
//    direction (towards the origin). It adds the shaded/lit look that makes
//    shapes feel 3D. We keep it soft (low intensity, slightly blue-white)
//    since light is scattered underwater.
// ---------------------------------------------------------------------------
const skyColor = 0xcff3ff; // light from above
const groundColor = 0x2a8f96; // light bounced up from the turquoise water below
const hemisphereLight = new THREE.HemisphereLight(skyColor, groundColor, 1.5);
scene.add(hemisphereLight);

const sunLight = new THREE.DirectionalLight(0xfff6e0, 2.0);
sunLight.position.set(8, 50, 12);
scene.add(sunLight);

// ---------------------------------------------------------------------------
// FISH SCHOOL (steps 3.1–3.3) — InstancedMesh + typed-array flock in flock.js
// ---------------------------------------------------------------------------
// Step 9.1 — 20–25 koi keeps the pond calm and uncluttered; ?fish=N still works.
// (Step 4.7 debug reminder: try ?fish=300, ?fish=600, ?fish=1000 and watch FPS.)
const fishCount = Number(new URLSearchParams(window.location.search).get('fish')) || 22;

// ---------------------------------------------------------------------------
// POND (phase 7, reshaped in 8.1) — a shallow column of water whose x/z size
// is derived from what the camera can see (see pond.js). Soft boundaries
// (step 1.8) turn fish back near the invisible banks, the surface and the
// bottom, so the screen edges act as the pond banks.
// ---------------------------------------------------------------------------
// Computed AFTER the camera position and aspect are set, so the frustum math
// sees the final view. The resize handler recomputes it on every window change.
const pondSize = computePondSizeFromCamera(camera);
const flock = createFlock(fishCount, pondSize);
scene.add(flock.mesh);

// ---------------------------------------------------------------------------
// POND LAYERS (phase 9) — the watercolour look. We stack a few flat pieces at
// different heights so the camera (looking straight down) sees them layered:
// the painted floor is deepest, the koi and their shadows sit in between, the
// ripple surface and the lily pads float on top. Each module returns its own
// mesh plus an update() function we call every frame.
// ---------------------------------------------------------------------------
const pondFloorY = -pondWaterDepth;
// The flock keeps fish 1.5 units away from the surface and the floor
// (verticalBoundaryMargin in flock.js), so this is the real swim range.
const swimTopY = -1.5;
const swimBottomY = pondFloorY + 1.5;

const waterFloor = createWaterFloor(pondFloorY);
scene.add(waterFloor.mesh);

// The fish shadows share the koi's own instance buffers, so one call here
// keeps every shadow glued under its fish (see shadows.js).
const fishShadows = createFishShadows(flock.mesh, fishCount, pondFloorY);
scene.add(fishShadows.mesh);

const waterSurface = createWaterSurface(0, swimTopY, swimBottomY);
scene.add(waterSurface.mesh);

const lilies = createLilies(pondFloorY);
scene.add(lilies.group);
lilies.layout(pondSize);

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
// Step 3.1: all 300 fish are ONE InstancedMesh = one fish draw call (plus lights, ...).
// ---------------------------------------------------------------------------
// Step 8.2 — one boolean drives every debug panel. While it is false the page
// looks like a plain pond: the stats box, the audio meters and the lil-gui
// panel are all hidden. Pressing C flips it and every panel follows. Keeping a
// single flag means the panels can never disagree about whether they show.
let areControlsVisible = false;

const statsBox = document.createElement('div');
statsBox.style.cssText =
  'position:fixed;left:8px;bottom:8px;padding:6px 8px;background:rgba(0,0,0,0.55);' +
  'color:#cfefff;font:12px/1.4 monospace;pointer-events:none;white-space:pre;';
// Step 8.2 — start hidden; setControlsVisible() is the only thing that turns
// it on (the CSS above still says how it looks, we just don't show it yet).
statsBox.style.display = 'none';
document.body.appendChild(statsBox);

// Step 8.2 — tiny hint so the owner discovers the key. It sits at the bottom
// right, ignores clicks (pointer-events:none) and fades out 6 seconds after
// load via a CSS opacity transition, so it never gets in the way of the pond.
const controlsHint = document.createElement('div');
controlsHint.textContent = 'press C for controls';
controlsHint.style.cssText =
  'position:fixed;right:12px;bottom:10px;color:rgba(255,255,255,0.75);' +
  'font:12px system-ui,sans-serif;pointer-events:none;transition:opacity 1.5s;';
document.body.appendChild(controlsHint);
setTimeout(() => {
  controlsHint.style.opacity = '0';
}, 6000);

// ---------------------------------------------------------------------------
// AUDIO METERS (steps 6.3–6.7) — loudness, volatility, flux, energy, chaos.
// ---------------------------------------------------------------------------
const audioMeterPanel = document.createElement('div');
audioMeterPanel.style.cssText =
  'position:fixed;left:8px;bottom:72px;display:none;width:168px;padding:6px 8px;' +
  'background:rgba(0,0,0,0.55);color:#cfefff;font:12px/1.4 monospace;pointer-events:none;';

function audioMeterRow(label, fillId, color) {
  return (
    `<div style="margin-top:5px">` +
    `<div style="margin-bottom:2px;font-size:11px">${label}</div>` +
    `<div style="height:8px;background:rgba(255,255,255,0.12);border-radius:2px;overflow:hidden">` +
    `<div id="${fillId}" style="height:100%;width:0%;background:${color};border-radius:2px"></div>` +
    `</div></div>`
  );
}

audioMeterPanel.innerHTML =
  '<div id="audio-meter-status" style="font-size:11px;margin-bottom:2px">audio</div>' +
  audioMeterRow('loudness', 'audio-bar-loudness', '#3db8d4') +
  audioMeterRow('volatility', 'audio-bar-volatility', '#9fe6ff') +
  audioMeterRow('flux', 'audio-bar-flux', '#7fe0ff') +
  audioMeterRow('calm (school)', 'audio-bar-energy', '#5ce0a8') +
  audioMeterRow('chaos', 'audio-bar-chaos', '#ffb4a8');
document.body.appendChild(audioMeterPanel);

const audioMeterStatus = audioMeterPanel.querySelector('#audio-meter-status');
const audioBarFills = {
  loudness: audioMeterPanel.querySelector('#audio-bar-loudness'),
  volatility: audioMeterPanel.querySelector('#audio-bar-volatility'),
  flux: audioMeterPanel.querySelector('#audio-bar-flux'),
  energy: audioMeterPanel.querySelector('#audio-bar-energy'),
  chaos: audioMeterPanel.querySelector('#audio-bar-chaos'),
};

function setAudioBar(fillElement, value01) {
  const widthPercent = Math.min(100, Math.max(0, value01 * 100));
  fillElement.style.width = `${widthPercent}%`;
}

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
// Step 8.2 — hidden on load; setControlsVisible() shows it when C is pressed.
gui.hide();
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

// Step 5.2 / 6.9 — mood sliders; when manual mode is off, mic drives moodState.
const moodFolder = gui.addFolder('Mood');
const moodInputMode = { manualMode: false };
const moodEnergyController = moodFolder.add(moodState, 'energy', 0, 1, 0.01).name('energy');
const moodChaosController = moodFolder.add(moodState, 'chaos', 0, 1, 0.01).name('chaos');

function setMoodManualMode(enabled) {
  moodInputMode.manualMode = Boolean(enabled);
  if (moodInputMode.manualMode) {
    moodEnergyController.enable();
    moodChaosController.enable();
  } else {
    moodEnergyController.disable();
    moodChaosController.disable();
  }
}

const manualMoodController = moodFolder
  .add(moodInputMode, 'manualMode')
  .name('manual mood (M)')
  .onChange((value) => setMoodManualMode(value));

setMoodManualMode(false);

function refreshMoodGuiDisplays() {
  moodEnergyController.updateDisplay();
  moodChaosController.updateDisplay();
}

function setMoodPreset(presetName) {
  applyMoodPreset(presetName);
  refreshMoodGuiDisplays();
}

const moodPresetActions = {
  silence: () => setMoodPreset('silence'),
  calm: () => setMoodPreset('calm'),
  chaos: () => setMoodPreset('chaos'),
};
moodFolder.add(moodPresetActions, 'silence').name('silence (key 1)');
moodFolder.add(moodPresetActions, 'calm').name('calm (key 2)');
moodFolder.add(moodPresetActions, 'chaos').name('chaos (key 3)');

// Step 8.2 — show or hide every debug panel from one place. `gui.show()` /
// `gui.hide()` do the lil-gui panel; the stats box is plain CSS display.
function setControlsVisible(visible) {
  areControlsVisible = visible;

  if (visible) {
    gui.show();
  } else {
    gui.hide();
  }

  statsBox.style.display = visible ? 'block' : 'none';

  // The audio panel only makes sense once the mic is running: animate() brings
  // it back on while controls are visible. Hiding it here turns it off now.
  if (!visible) {
    audioMeterPanel.style.display = 'none';
  }
}

window.addEventListener('keydown', (event) => {
  if (event.key === '1') {
    setMoodPreset('silence');
  } else if (event.key === '2') {
    setMoodPreset('calm');
  } else if (event.key === '3') {
    setMoodPreset('chaos');
  } else if ((event.key === 'r' || event.key === 'R') && isMicrophoneAnalysisReady()) {
    recalibrateNoiseFloor();
  } else if (event.key === 'm' || event.key === 'M') {
    setMoodManualMode(!moodInputMode.manualMode);
    manualMoodController.updateDisplay();
  } else if ((event.key === 'c' || event.key === 'C') && !event.repeat) {
    // `event.repeat` is true while a key is held down and the OS sends the
    // auto-repeat presses. Ignoring those keeps a held C from flickering the
    // panels on and off many times a second.
    setControlsVisible(!areControlsVisible);
  }
});

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

// Step 9.1 — a running clock in SECONDS SINCE LOAD. The water, shadows and
// lily animations all want "how long has the page been up?", not the per-frame
// delta, so we accumulate deltaSeconds into this one number and pass it around.
let elapsedSeconds = 0;

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
  elapsedSeconds += deltaSeconds;

  // Painted floor + lilies are pure decoration: they only need the running
  // clock (drifting light, bobbing flowers), so we tick them right here.
  waterFloor.update(elapsedSeconds);
  lilies.update(elapsedSeconds);

  if (isMicrophoneAnalysisReady()) {
    const { timeDomain, frequency } = getMicrophoneAnalysisBuffers();
    sampleMicrophoneAnalysis(timeDomain, frequency);
    updateNoiseFloorCalibration(deltaSeconds);
    updateSmoothedAudioMood(deltaSeconds);

    if (!moodInputMode.manualMode && !isNoiseFloorCalibrating()) {
      const audioMood = getSmoothedAudioMood();
      moodState.energy = audioMood.energy;
      moodState.chaos = audioMood.chaos;
      moodEnergyController.updateDisplay();
      moodChaosController.updateDisplay();
    }

    // Step 8.2 — respect the C toggle. This runs every frame while the mic is
    // live, so without the check it would re-show the panel 60 times a second
    // even after setControlsVisible(false) had hidden it.
    audioMeterPanel.style.display = areControlsVisible ? 'block' : 'none';
    if (isNoiseFloorCalibrating()) {
      audioMeterStatus.textContent = 'calibrating… (quiet, R)';
      setAudioBar(audioBarFills.loudness, 0);
      setAudioBar(audioBarFills.volatility, 0);
      setAudioBar(audioBarFills.flux, 0);
      setAudioBar(audioBarFills.energy, 0);
      setAudioBar(audioBarFills.chaos, 0);
    } else {
      audioMeterStatus.textContent = moodInputMode.manualMode ? 'mic (manual mood)' : 'mic → fish';
      const audioMood = getSmoothedAudioMood();
      setAudioBar(audioBarFills.loudness, getNormalizedLoudness());
      setAudioBar(audioBarFills.volatility, getLoudnessVolatility() * 8);
      setAudioBar(audioBarFills.flux, getSpectralFlux());
      setAudioBar(audioBarFills.energy, getCalmness());
      setAudioBar(audioBarFills.chaos, audioMood.chaos);
    }
  }

  // Step 5.1/5.5 — mood targets weights; smoothing avoids snaps (fast attack, slow release).
  const moodTargetWeights = moodToFlockWeights(moodState.energy, moodState.chaos);
  updateSmoothedFlockWeights(moodTargetWeights, deltaSeconds);
  Object.assign(flockSettings, smoothedFlockWeights);

  updateSmoothedSwimMood(moodToSwimMood(moodState.energy, moodState.chaos), deltaSeconds);
  fishWaveUniforms.uMood.value = smoothedSwimMood.uMood;
  fishWaveSettings.moodSpeedMul = swimMoodToSpeedMultiplier(smoothedSwimMood.uMood);

  flock.update(deltaSeconds);
  // Both read the flock's freshly-updated positions, so they run right after
  // it: shadows slide the koi's silhouette (offset by height) onto the floor,
  // and the surface paints ripple rings only around shallow swimmers.
  fishShadows.update(flock);
  waterSurface.update(elapsedSeconds, flock);

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
