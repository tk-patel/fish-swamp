// Phase 6 — microphone input (starts at step 6.1 with permission only).
//
// Browsers block the mic until the user clicks something on the page
// ("user gesture"). That is why we show an overlay with a button instead of
// calling getUserMedia on page load. HTTPS (or localhost) is also required.

// Step 6.1: turn OFF the browser's audio "helpers" so later steps see real
// loudness changes. If these stayed on, auto-gain would squash quiet/loud
// differences and make the fish less responsive.
export const microphoneAudioConstraints = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
};

// Step 6.2: fftSize must be a power of two. The analyser keeps a rolling
// buffer of that many time samples, then runs an FFT each time we ask for
// frequency data. Larger = finer frequency detail, slightly more CPU.
const analyserFftSize = 2048;

/** Active MediaStream after permission is granted; null until then. */
let microphoneStream = null;

// Audio graph (step 6.2):  mic stream -> MediaStreamSource -> AnalyserNode
// We do NOT connect the analyser to speakers (destination). We only *read*
// numbers from it; playing the mic back would cause feedback.
let audioContext = null;
let analyserNode = null;

// Reused every frame so we do not allocate new arrays 60+ times per second.
let timeDomainBytes = null;
let frequencyBytes = null;

// Step 6.3: one loudness number from the waveform (updated each sampleMicrophoneAnalysis).
let latestRms = 0;

// Step 6.4: subtract room hum (floor) and map to 0..1 using a fixed "very loud" ceiling.
const noiseFloorCalibrationSeconds = 1;
// Typical shout RMS in byte-waveform form; tuned later in 6.10 if needed.
const loudnessCeilingRms = 0.22;

let noiseFloorRms = 0;
let normalizedLoudness = 0;
let isCalibratingNoiseFloor = false;
let calibrationElapsedSeconds = 0;
let calibrationRmsSum = 0;
let calibrationSampleCount = 0;

export function getMicrophoneStream() {
  return microphoneStream;
}

export function isMicrophoneAnalysisReady() {
  return analyserNode !== null;
}

/** Root-mean-square loudness from the last sample (0 = silence, ~0.1+ when speaking). */
export function getMicrophoneRms() {
  return latestRms;
}

/** Calibrated loudness in 0..1 (quiet room ≈ 0 after floor sampling). */
export function getNormalizedLoudness() {
  return normalizedLoudness;
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

function normalizeRmsToLoudness(rms) {
  const span = loudnessCeilingRms - noiseFloorRms;
  if (span <= 0.00001) {
    return 0;
  }
  return clamp01((rms - noiseFloorRms) / span);
}

/** Sample ~1 s of ambient RMS right after the mic starts (stay quiet). */
export function beginNoiseFloorCalibration() {
  isCalibratingNoiseFloor = true;
  calibrationElapsedSeconds = 0;
  calibrationRmsSum = 0;
  calibrationSampleCount = 0;
  normalizedLoudness = 0;
}

/** Call once per frame after sampleMicrophoneAnalysis (pass animation delta time). */
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

/** Press R during the app to re-measure ambient noise (stay quiet for 1 s). */
export function recalibrateNoiseFloor() {
  if (!analyserNode) {
    return;
  }
  beginNoiseFloorCalibration();
}

/**
 * RMS = "average energy" of the waveform (not just the loudest peak).
 * We convert each byte sample to roughly -1..1, square them, average, sqrt.
 * That reacts smoothly to sustained sound; a single spike matters less.
 */
export function computeRmsFromByteTimeDomain(timeDomainBytes) {
  let sumSquares = 0;
  for (let i = 0; i < timeDomainBytes.length; i += 1) {
    // 128 is the analyser's "zero" for silence in byte form.
    const normalizedSample = (timeDomainBytes[i] - 128) / 128;
    sumSquares += normalizedSample * normalizedSample;
  }
  return Math.sqrt(sumSquares / timeDomainBytes.length);
}

/**
 * Ask for microphone access (must be called from a click handler).
 * @returns {Promise<{ granted: true, stream: MediaStream } | { granted: false, error: DOMException | Error }>}
 */
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

/**
 * Build the Web Audio graph for an already-granted MediaStream.
 * Call once after permission succeeds (still inside the user's click).
 * @returns {Promise<{ ok: true } | { ok: false, error: unknown }>}
 */
export async function startMicrophoneAnalysis(mediaStream = microphoneStream) {
  if (!mediaStream) {
    return { ok: false, error: new Error('No microphone stream — enable the mic first.') };
  }

  try {
    audioContext = new AudioContext();
    // On some browsers the context starts "suspended" until a gesture; resume() is safe here.
    if (audioContext.state === 'suspended') {
      await audioContext.resume();
    }

    const sourceNode = audioContext.createMediaStreamSource(mediaStream);
    analyserNode = audioContext.createAnalyser();
    analyserNode.fftSize = analyserFftSize;

    sourceNode.connect(analyserNode);

    // Byte arrays: each sample is 0..255. Time-domain centers on 128 = silence.
    timeDomainBytes = new Uint8Array(analyserNode.fftSize);
    // Frequency bins: fftSize/2 bins from low pitch to high (also 0..255 energy).
    frequencyBytes = new Uint8Array(analyserNode.frequencyBinCount);

    beginNoiseFloorCalibration();

    return { ok: true };
  } catch (error) {
    analyserNode = null;
    timeDomainBytes = null;
    frequencyBytes = null;
    return { ok: false, error };
  }
}

/**
 * Copy the latest mic snapshot into the two buffers (call once per animation frame).
 * @param {Uint8Array} timeDomainOut - same length as analyser fftSize
 * @param {Uint8Array} frequencyOut - length frequencyBinCount
 * @returns {boolean} false if analysis was never started
 */
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

  return true;
}

/** Buffers allocated in startMicrophoneAnalysis(); null until then. */
export function getMicrophoneAnalysisBuffers() {
  return { timeDomain: timeDomainBytes, frequency: frequencyBytes };
}
