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

export function getMicrophoneStream() {
  return microphoneStream;
}

export function isMicrophoneAnalysisReady() {
  return analyserNode !== null;
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
  return true;
}

/** Buffers allocated in startMicrophoneAnalysis(); null until then. */
export function getMicrophoneAnalysisBuffers() {
  return { timeDomain: timeDomainBytes, frequency: frequencyBytes };
}
