// shaders/noise.js — small GLSL helpers shared by the watercolour shaders
// (water floor, lily pads, ripples). Step 9.1.
//
// WHY NOISE?  Hand-painted watercolour is never one flat colour: pigment
// pools, fades and leaves soft blotches. "Noise" is a function that returns a
// smooth, random-looking value for every point, so we can use it as a
// recipe for those blotches without loading any image.
//
// It is a plain JS string; shaders paste it in with ${noiseGlsl}.
export const noiseGlsl = /* glsl */ `
  // hash: turn a 2D point into a pseudo-random number 0..1. Same input always
  // gives the same output (so the pattern does not flicker), but neighbouring
  // inputs give unrelated outputs. The constants are arbitrary "scramblers".
  float hash12(vec2 p) {
    p = fract(p * vec2(123.34, 456.21));
    p += dot(p, p + 45.32);
    return fract(p.x * p.y);
  }

  // VALUE NOISE: put a random number on every whole-number grid corner, then
  // blend the 4 corners around our point. The blend weight f*f*(3-2f) is the
  // smoothstep S-curve, which hides the grid lines.
  float valueNoise(vec2 p) {
    vec2 cell = floor(p);
    vec2 f = fract(p);
    vec2 blend = f * f * (3.0 - 2.0 * f);
    float a = hash12(cell);
    float b = hash12(cell + vec2(1.0, 0.0));
    float c = hash12(cell + vec2(0.0, 1.0));
    float d = hash12(cell + vec2(1.0, 1.0));
    return mix(mix(a, b, blend.x), mix(c, d, blend.x), blend.y);
  }

  // FBM ("fractal Brownian motion"): add several layers of noise, each one
  // twice as detailed and half as strong. Big soft shapes + medium + fine
  // detail = something that looks natural, like clouds or a paint wash.
  float fbm(vec2 p) {
    float sum = 0.0;
    float amplitude = 0.5;
    for (int octave = 0; octave < 5; octave++) {
      sum += amplitude * valueNoise(p);
      p = p * 2.03 + vec2(17.1, 9.2); // the odd offset stops layers lining up
      amplitude *= 0.5;
    }
    return sum;
  }
`;
