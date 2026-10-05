// Phase 6 — microphone input (starts at step 6.1 with permission only).
//
// Browsers block the mic until the user clicks something on the page
// ("user gesture"). That is why we show an overlay with a button instead of
// calling getUserMedia on page load. HTTPS (or localhost) is also required.

import { smoothValueWithAttackRelease } from './mood.js';

// Step 6.1: turn OFF the browser's "helpers" so later steps see real loudness.
export const microphoneAudioConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

// Step 6.7 / 6.10 — how volatility + spectral flux become chaos (tuned in 6.10).
export const audioMoodWeights = {
  volatilityWeight: 5.5,
  fluxWeight: 1.0,
  /** Below this smoothed energy, chaos fades out (avoids noise-only scatter). */
  energyChaosFadeEnd: 0.06,
};

// Step 6.8 — fast rise, slower fall (same idea as mood flock weights).
export const audioSignalSmoothing = {
  attackRate: 14,
  releaseRate: 2.8,
};

const analyserFftSize = 2048;
const noiseFloorCalibrationSeconds = 1;
// Step 6.10 — loudness ceiling for normalize (RMS units).
export const loudnessCeilingRms = 0.2;

// Step 6.5 — ring buffer of recent loudness for standard deviation.
const volatilityWindowFrames = 60;
const loudnessHistory = new Float32Array(volatilityWindowFrames);
let loudnessHistoryWriteIndex = 0;
let loudnessHistoryFilled = 0;

// Step 6.6 — previous spectrum for per-bin positive differences.
let previousFrequencyBytes = null;
// Step 6.10 — scale raw flux sum (can be thousands) into ~0..1.
const spectralFluxSumNormalizer = 14000;

let microphoneStream = null;
let audioContext = null;
let analyserNode = null;
let timeDomainBytes = null;
let frequencyBytes = null;

let latestRms = 0;
let noiseFloorRms = 0;
let normalizedLoudness = 0;
let isCalibratingNoiseFloor = false;
let calibrationElapsedSeconds = 0;
let calibrationRmsSum = 0;
let calibrationSampleCount = 0;

let loudnessVolatility = 0;
let spectralFlux = 0;
let targetEnergy = 0;
let targetChaos = 0;
let smoothedEnergy = 0;
let smoothedChaos = 0;

export function getMicrophoneStream() {
  return microphoneStream;
}

export function isMicrophoneAnalysisReady() {
  return analyserNode !== null;
}

export function getMicrophoneRms() {
  return latestRms;
}

export function getNormalizedLoudness() {
  return normalizedLoudness;
}

export function getLoudnessVolatility() {
  return loudnessVolatility;
}

export function getSpectralFlux() {
  return spectralFlux;
}

/** Smoothed 0..1 values for mood.js (step 6.7–6.8). */
export function getSmoothedAudioMood() {
  return { energy: smoothedEnergy, chaos: smoothedChaos };
}

export function isNoiseFloorCalibrating() {
  return isCalibratingNoiseFloor;
}

export function getNoiseFloorRms() {
  return noiseFloorRms;
}

function clamp01(value) {
  return Math.min(1, Math.max(0, value));
}

function smoothstep01(t) {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

function normalizeRmsToLoudness(rms) {
  const span = loudnessCeilingRms - noiseFloorRms;
  if (span <= 0.00001) {
    return 0;
  }
  return clamp01((rms - noiseFloorRms) / span);
}

function resetAudioFeatureState() {
  loudnessHistoryWriteIndex = 0;
  loudnessHistoryFilled = 0;
  loudnessHistory.fill(0);
  previousFrequencyBytes = null;
  loudnessVolatility = 0;
  spectralFlux = 0;
  targetEnergy = 0;
  targetChaos = 0;
  smoothedEnergy = 0;
  smoothedChaos = 0;
}

function pushLoudnessSample(loudness) {
  loudnessHistory[loudnessHistoryWriteIndex] = loudness;
  loudnessHistoryWriteIndex = (loudnessHistoryWriteIndex + 1) % volatilityWindowFrames;
  loudnessHistoryFilled = Math.min(loudnessHistoryFilled + 1, volatilityWindowFrames);
}

/** Standard deviation of the last ~60 loudness samples (step 6.5). */
function computeLoudnessVolatility() {
  if (loudnessHistoryFilled < 2) {
    return 0;
  }

  let sum = 0;
  for (let i = 0; i < loudnessHistoryFilled; i += 1) {
    sum += loudnessHistory[i];
  }
  const mean = sum / loudnessHistoryFilled;

  let varianceSum = 0;
  for (let i = 0; i < loudnessHistoryFilled; i += 1) {
    const delta = loudnessHistory[i] - mean;
    varianceSum += delta * delta;
  }
  return Math.sqrt(varianceSum / loudnessHistoryFilled);
}

function computeSpectralFlux(frequencyOut) {
  if (!previousFrequencyBytes) {
    previousFrequencyBytes = new Uint8Array(frequencyOut.length);
    previousFrequencyBytes.set(frequencyOut);
    return 0;
  }

  let positiveDiffSum = 0;
  for (let i = 0; i < frequencyOut.length; i += 1) {
    const diff = frequencyOut[i] - previousFrequencyBytes[i];
    if (diff > 0) {
      positiveDiffSum += diff;
    }
    previousFrequencyBytes[i] = frequencyOut[i];
  }

  return clamp01(positiveDiffSum / spectralFluxSumNormalizer);
}

function updateAudioTargets() {
  if (isCalibratingNoiseFloor) {
    targetEnergy = 0;
    targetChaos = 0;
    return;
  }

  pushLoudnessSample(normalizedLoudness);
  loudnessVolatility = computeLoudnessVolatility();

  targetEnergy = normalizedLoudness;

  const rawChaos = clamp01(
    audioMoodWeights.volatilityWeight * loudnessVolatility +
      audioMoodWeights.fluxWeight * spectralFlux,
  );

  // Quiet hiss should not scatter fish: fade chaos when energy is near zero.
  const energyFade = smoothstep01(
    targetEnergy / Math.max(audioMoodWeights.energyChaosFadeEnd, 0.0001),
  );
  targetChaos = rawChaos * energyFade;
}

export function beginNoiseFloorCalibration() {
  isCalibratingNoiseFloor = true;
  calibrationElapsedSeconds = 0;
  calibrationRmsSum = 0;
  calibrationSampleCount = 0;
  normalizedLoudness = 0;
  resetAudioFeatureState();
}

export function updateNoiseFloorCalibration(deltaSeconds) {
  if (!isCalibratingNoiseFloor) {
    return;
  }

  calibrationElapsedSeconds += deltaSeconds;
  calibrationRmsSum += latestRms;
  calibrationSampleCount += 1;

  if (calibrationElapsedSeconds >= noiseFloorCalibrationSeconds) {
    noiseFloorRms =
      calibrationSampleCount > 0 ? calibrationRmsSum / calibrationSampleCount : latestRms;
    isCalibratingNoiseFloor = false;
    normalizedLoudness = normalizeRmsToLoudness(latestRms);
  }
}

export function recalibrateNoiseFloor() {
  if (!analyserNode) {
    return;
  }
  beginNoiseFloorCalibration();
}

export function computeRmsFromByteTimeDomain(timeDomainBytes) {
  let sumSquares = 0;
  for (let i = 0; i < timeDomainBytes.length; i += 1) {
    const normalizedSample = (timeDomainBytes[i] - 128) / 128;
    sumSquares += normalizedSample * normalizedSample;
  }
  return Math.sqrt(sumSquares / timeDomainBytes.length);
}

export async function requestMicrophonePermission() {
  if (!navigator.mediaDevices?.getUserMedia) {
    return {
      granted: false,
      error: new Error('Microphone is not available in this browser (need HTTPS or localhost).'),
    };
  }

  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: microphoneAudioConstraints,
    });
    return { granted: true, stream: microphoneStream };
  } catch (error) {
    microphoneStream = null;
    return { granted: false, error };
  }
}

export async function startMicrophoneAnalysis(mediaStream = microphoneStream) {
  if (!mediaStream) {
    return { ok: false, error: new Error('No microphone stream — enable the mic first.') };
  }

  try {
    audioContext = new AudioContext();
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = analyserFftSize;
    sourceNode.connect(analyserNode);

    timeDomainBytes = new Uint8Array(analyserNode.fftSize);
    frequencyBytes = new Uint8Array(analyserNode.frequencyBinCount);
    resetAudioFeatureState();
    beginNoiseFloorCalibration();

    return { ok: true };
  } catch (error) {
    analyserNode = null;
    timeDomainBytes = null;
    frequencyBytes = null;
    return { ok: false, error };
  }
}

export function sampleMicrophoneAnalysis(timeDomainOut, frequencyOut) {
  if (!analyserNode) {
    return false;
  }

  analyserNode.getByteTimeDomainData(timeDomainOut);
  analyserNode.getByteFrequencyData(frequencyOut);
  latestRms = computeRmsFromByteTimeDomain(timeDomainOut);

  if (isCalibratingNoiseFloor) {
    normalizedLoudness = 0;
  } else {
    normalizedLoudness = normalizeRmsToLoudness(latestRms);
  }

  spectralFlux = computeSpectralFlux(frequencyOut);
  updateAudioTargets();

  return true;
}

/** Step 6.8 — smooth energy/chaos after targets update (call once per frame). */
export function updateSmoothedAudioMood(deltaSeconds) {
  smoothedEnergy = smoothValueWithAttackRelease(
    smoothedEnergy,
    targetEnergy,
    deltaSeconds,
    audioSignalSmoothing,
  );
  smoothedChaos = smoothValueWithAttackRelease(
    smoothedChaos,
    targetChaos,
    deltaSeconds,
    audioSignalSmoothing,
  );
}

export function getMicrophoneAnalysisBuffers() {
  return { timeDomain: timeDomainBytes, frequency: frequencyBytes };
}
