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

/** Active MediaStream after permission is granted; null until then (step 6.2 hooks this up). */
let microphoneStream = null;

export function getMicrophoneStream() {
  return microphoneStream;
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
