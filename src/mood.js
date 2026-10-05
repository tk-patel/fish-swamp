// mood.js — small bridge between "how the sound feels" and flock tuning (step 5.1).
//
// Decoupling: later, audio.js will only update energy/chaos here. The flock
// in flock.js never touches a microphone — it only reads flockSettings weights.
// That keeps input (sound) separate from behavior (boids).

/**
 * Live inputs: lil-gui sliders (step 5.2) and later the microphone (phase 6).
 * Both are 0..1.
 */
export const moodState = {
  energy: 0,
  chaos: 0,
};

/** Keyboard / GUI targets (step 5.2). */
export const moodPresets = {
  silence: { energy: 0, chaos: 0 },
  calm: { energy: 1, chaos: 0 },
  chaos: { energy: 0, chaos: 1 },
};

/** Copy a named preset into moodState (mutates moodState only). */
export function applyMoodPreset(presetName) {
  const preset = moodPresets[presetName];
  if (!preset) {
    return;
  }
  moodState.energy = preset.energy;
  moodState.chaos = preset.chaos;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

// Linear blend between two numbers (introduced in step 1.6 for quaternions; same idea here).
function lerpNumber(a, b, t) {
  return a + (b - a) * t;
}

// smoothstep: like lerp but eases in/out at the ends (S-curve). Avoids harsh "snaps"
// when energy or chaos cross small threshold values on the sliders.
function smoothstep01(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

/**
 * Step 5.3 behavior table — three anchor moods, not the raw flock GUI presets.
 *   silence: high wander, low school forces
 *   calm:    strong alignment + cohesion, moderate separation and speed
 *   chaos:   weak cohesion, strong separation, faster swim, flee (wired in step 5.4)
 */
const moodAnchors = {
  silence: {
    wanderWeight: 1.35,
    separationWeight: 1.0,
    alignmentWeight: 0.35,
    cohesionWeight: 0.3,
    maxSpeed: 2.0,
    perceptionRadius: 6.5,
    fleeWeight: 0,
  },
  calm: {
    wanderWeight: 0.45,
    separationWeight: 1.15,
    alignmentWeight: 1.55,
    cohesionWeight: 1.65,
    maxSpeed: 2.45,
    perceptionRadius: 10,
    fleeWeight: 0,
  },
  chaos: {
    wanderWeight: 1.45,
    separationWeight: 2.65,
    alignmentWeight: 0.12,
    cohesionWeight: 0.04,
    maxSpeed: 3.35,
    perceptionRadius: 6,
    fleeWeight: 1.25,
  },
};

function lerpAnchorWeights(from, to, t) {
  return {
    wanderWeight: lerpNumber(from.wanderWeight, to.wanderWeight, t),
    separationWeight: lerpNumber(from.separationWeight, to.separationWeight, t),
    alignmentWeight: lerpNumber(from.alignmentWeight, to.alignmentWeight, t),
    cohesionWeight: lerpNumber(from.cohesionWeight, to.cohesionWeight, t),
    maxSpeed: lerpNumber(from.maxSpeed, to.maxSpeed, t),
    perceptionRadius: lerpNumber(from.perceptionRadius, to.perceptionRadius, t),
    fleeWeight: lerpNumber(from.fleeWeight, to.fleeWeight, t),
  };
}

/**
 * Pure function: mood -> boid tuning (no side effects).
 *
 * @param {number} energy 0 = quiet / silence anchor, 1 = lively / calm schooling
 * @param {number} chaos 0 = smooth, 1 = panicked / chaos anchor
 */
export function moodToFlockWeights(energy, chaos) {
  const e = smoothstep01(energy);
  const c = smoothstep01(chaos);

  // Rising energy morphs silence → calm while chaos stays low.
  const quietToCalm = lerpAnchorWeights(moodAnchors.silence, moodAnchors.calm, e);
  // Rising chaos pulls whatever we have toward the chaos anchor (scatter + flee).
  return lerpAnchorWeights(quietToCalm, moodAnchors.chaos, c);
}

/** Fields mood writes into flockSettings (also smoothed in step 5.5). */
export const moodFlockWeightKeys = [
  'wanderWeight',
  'separationWeight',
  'alignmentWeight',
  'cohesionWeight',
  'maxSpeed',
  'perceptionRadius',
  'fleeWeight',
];

// Step 5.5: fast attack when chaos rises, slower release when calming down.
export const moodWeightSmoothing = {
  attackRate: 14,
  releaseRate: 2.2,
};

const initialSmoothedWeights = moodToFlockWeights(0, 0);
export const smoothedFlockWeights = { ...initialSmoothedWeights };

/**
 * Ease current smoothed weights toward the target from moodToFlockWeights.
 * Uses separate rise/fall rates so scatter hits quickly but recovery is gradual.
 */
export function updateSmoothedFlockWeights(targetWeights, deltaSeconds) {
  for (const key of moodFlockWeightKeys) {
    const current = smoothedFlockWeights[key];
    const target = targetWeights[key];
    const rate =
      target > current ? moodWeightSmoothing.attackRate : moodWeightSmoothing.releaseRate;
    const blend = 1 - Math.exp(-rate * deltaSeconds);
    smoothedFlockWeights[key] = current + (target - current) * blend;
  }
}
