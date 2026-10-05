// mood.js — small bridge between "how the sound feels" and flock tuning (step 5.1).
//
// Decoupling: later, audio.js will only update energy/chaos here. The flock
// in flock.js never touches a microphone — it only reads flockSettings weights.
// That keeps input (sound) separate from behavior (boids).

import { flockPresets } from './flock.js';

/**
 * Live inputs: lil-gui sliders (step 5.2) and later the microphone (phase 6).
 * Both are 0..1.
 */
export const moodState = {
  energy: 0,
  chaos: 0,
};

/** Keyboard / GUI targets for step 5.2 (step 5.3 will refine the mapping). */
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

// Linear interpolation: at t=0 return a, at t=1 return b (same idea as step 1.6 slerp, but for numbers).
function lerpNumber(a, b, t) {
  return a + (b - a) * t;
}

/** Blend two preset objects field-by-field (same keys as flockPresets.*). */
function lerpPresetWeights(from, to, t) {
  return {
    wanderWeight: lerpNumber(from.wanderWeight, to.wanderWeight, t),
    separationWeight: lerpNumber(from.separationWeight, to.separationWeight, t),
    alignmentWeight: lerpNumber(from.alignmentWeight, to.alignmentWeight, t),
    cohesionWeight: lerpNumber(from.cohesionWeight, to.cohesionWeight, t),
    maxSpeed: lerpNumber(from.maxSpeed, to.maxSpeed, t),
    perceptionRadius: lerpNumber(from.perceptionRadius, to.perceptionRadius, t),
  };
}

/**
 * Pure function: mood -> boid weights (no side effects, no flock mutation).
 * Step 5.3 will replace this simple blend with the full silence/calm/chaos table.
 *
 * @param {number} energy 0 ≈ idle wander, 1 ≈ tight schooling (when chaos is low)
 * @param {number} chaos 0 = smooth, 1 ≈ scatter preset
 */
export function moodToFlockWeights(energy, chaos) {
  const e = clamp01(energy);
  const c = clamp01(chaos);

  // Rising energy morphs idle → tight school; rising chaos pulls toward scatter.
  const calmSide = lerpPresetWeights(flockPresets.idle, flockPresets.tightSchool, e);
  return lerpPresetWeights(calmSide, flockPresets.scatter, c);
}
