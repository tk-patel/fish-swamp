// Entry point: sets up the three things every 3D scene needs
// (scene, camera, renderer) and runs the render loop.

import * as THREE from 'three';
// OrbitControls is an "addon": it ships inside the three package but is not
// part of the core THREE object, so we import it from 'three/addons/...'.
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
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
import { createLightShafts } from './caustics.js';
import { createPondEnvironment } from './environment.js';
import { applyPondFog, applyWaterGradientBackground, createPondSize } from './pond.js';
// lil-gui draws a small control panel (sliders, checkboxes) in the corner of
// the page. We use it to tweak numbers live instead of edit-save-reload.
import GUI from 'lil-gui';

// ---------------------------------------------------------------------------
// 1. SCENE - the "stage". An empty container that holds everything we want
//    to see: meshes, lights, and later fish. Nothing is drawn unless it is
//    added to the scene.
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();

// Step 7.1 — gradient water behind the pond + light fog (see pond.js).
applyWaterGradientBackground(scene);
applyPondFog(scene, 0.008);

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
// Pond view: we float above the water and look down at an angle, like
// leaning over the edge of a shallow pond. The target (0, -3, 0) is the
// middle of the water column, so the floor and the fish are both in frame.
camera.position.set(0, 24, 30);
camera.lookAt(0, -3, 0);

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
controls.target.set(0, -3, 0);
controls.minPolarAngle = 0.1;
controls.maxPolarAngle = 1.35; // stop just before the camera drops to water level
controls.minDistance = 14;
controls.maxDistance = 75;
controls.enablePan = true;

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
const skyColor = 0xcff3ff; // light from above
const groundColor = 0x3a5a48; // light bounced up from the sandy, plant-green floor
const hemisphereLight = new THREE.HemisphereLight(skyColor, groundColor, 1.5);
scene.add(hemisphereLight);

const sunLight = new THREE.DirectionalLight(0xfff6e0, 2.0);
sunLight.position.set(8, 50, 12);
scene.add(sunLight);

// ---------------------------------------------------------------------------
// FISH SCHOOL (steps 3.1–3.3) — InstancedMesh + typed-array flock in flock.js
// ---------------------------------------------------------------------------
// Step 4.7: try ?fish=300, ?fish=600, ?fish=1000 and watch FPS (O(n²) neighbor loops).
const fishCount = Number(new URLSearchParams(window.location.search).get('fish')) || 160;

// ---------------------------------------------------------------------------
// POND (phase 7) — a fixed, shallow box of water (see pond.js).
// Soft boundaries (step 1.8) turn fish back near the invisible banks, the
// surface and the floor.
// ---------------------------------------------------------------------------
// Step 7.2 — sand floor, rocks and swaying plants (see environment.js).
const pondEnvironment = createPondEnvironment();
scene.add(pondEnvironment.group);

// Step 7.3 — see-through light beams from the surface (caustics live in the floor material).
const lightShafts = createLightShafts();
scene.add(lightShafts.group);

const pondSize = createPondSize();
const flock = createFlock(fishCount, pondSize);
scene.add(flock.mesh);

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
const statsBox = document.createElement('div');
statsBox.style.cssText =
  'position:fixed;left:8px;bottom:8px;padding:6px 8px;background:rgba(0,0,0,0.55);' +
  'color:#cfefff;font:12px/1.4 monospace;pointer-events:none;white-space:pre;';
document.body.appendChild(statsBox);

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
  }
});

let elapsedSeconds = 0; // total running time, drives plant sway
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
  elapsedSeconds += deltaSeconds;
  pondEnvironment.update(elapsedSeconds);
  lightShafts.update(elapsedSeconds);

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

    audioMeterPanel.style.display = 'block';
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
