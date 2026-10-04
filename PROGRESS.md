# PROGRESS.md

**Current step:** 1.1 (next up)
**Last updated:** 2026-10-04 (finished 0.5)

Rules: tick a box only after the step is done, committed, and explained. Add a one-line log entry below the checklist. Do not start the next step until the owner says "next".

## Checklist

### Phase 0 — Setup and 3D basics
- [x] 0.1 Project skeleton
- [x] 0.2 Scene, camera, renderer, spinning cube
- [x] 0.3 Delta time
- [x] 0.4 Resize and OrbitControls
- [x] 0.5 Underwater mood (background, fog, lights)

### Phase 1 — One fish
- [ ] 1.1 Fish body from primitives
- [ ] 1.2 Tail and eyes
- [ ] 1.3 Forward direction convention
- [ ] 1.4 Move with a velocity vector
- [ ] 1.5 Steering toward a target
- [ ] 1.6 Smooth orientation (quaternion slerp)
- [ ] 1.7 Wandering
- [ ] 1.8 Stay inside the tank

### Phase 2 — Swim animation
- [ ] 2.1 Tail wag with sine
- [ ] 2.2 Wag speed tied to swim speed
- [ ] 2.3 Why not 300 multi-part fish (measure)
- [ ] 2.4 Single-mesh fish
- [ ] 2.5 Vertex shader body wave
- [ ] 2.6 Tune the wave with sliders

### Phase 3 — Instancing
- [ ] 3.1 InstancedMesh, static positions
- [ ] 3.2 Typed-array fish state
- [ ] 3.3 Move all fish with wander
- [ ] 3.4 Per-fish phase/speed attributes
- [ ] 3.5 Per-fish color and size

### Phase 4 — Boids
- [ ] 4.1 Neighbor search
- [ ] 4.2 Separation
- [ ] 4.3 Alignment
- [ ] 4.4 Cohesion
- [ ] 4.5 Limits and balance
- [ ] 4.6 Tuning panel and presets
- [ ] 4.7 Performance check

### Phase 5 — Moods (no mic)
- [ ] 5.1 Mood object
- [ ] 5.2 Fake input (sliders/keys)
- [ ] 5.3 Mapping design (silence / calm / chaos)
- [ ] 5.4 Flee force
- [ ] 5.5 Smoothing transitions
- [ ] 5.6 Swim animation follows mood

### Phase 6 — Microphone
- [ ] 6.1 Start screen and permission
- [ ] 6.2 AudioContext and AnalyserNode
- [ ] 6.3 Volume (RMS)
- [ ] 6.4 Noise-floor calibration
- [ ] 6.5 Volatility
- [ ] 6.6 Spectral flux
- [ ] 6.7 Combine into energy and chaos
- [ ] 6.8 Smooth audio signals
- [ ] 6.9 Connect audio to mood
- [ ] 6.10 Tuning session

### Phase 7 — Polish (optional)
- [ ] 7.1 Gradient water and fog
- [ ] 7.2 Floor, rocks, plants
- [ ] 7.3 Light rays / caustics
- [ ] 7.4 Camera drift
- [ ] 7.5 Bloom
- [ ] 7.6 Better fish model (GLB)
- [ ] 7.7 Mobile and performance
- [ ] 7.8 Deploy

## Log
(One entry per finished step: `step X.Y — what changed — commit hash — anything surprising`)

- step 0.1 — Vite + three installed, blank page, `src/main.js` logs hello — commit 3137c76 — Wrote the Vite files by hand instead of `npm create vite` to avoid template extras (counter demo, etc.).
- step 0.2 — scene + perspective camera + WebGL renderer + lit spinning cube, render loop via requestAnimationFrame — commit 4b35f9a — Rotation is intentionally per-frame (naive); step 0.3 fixes it with delta time. Canvas background is black until step 0.5.
- step 0.3 — cube spin now `speed (rad/s) * deltaSeconds` using THREE.Timer — commit 44d6caa — PLAN says THREE.Clock, but Clock is deprecated since r183 (we have r186), so I used THREE.Timer, its replacement. Same concept. Our test browser ran rAF at ~120 Hz, a real-life example of why delta time matters.
- step 0.4 — resize handler (camera aspect + projection matrix + renderer size), pixel ratio capped at 2, OrbitControls with damping — commit e2e59bb — OrbitControls lives in `three/addons/...`. Verified canvas follows viewport size and uses 2x pixels on a Retina display; drag-orbit itself was not automated-tested, try it by hand.
- step 0.5 — teal background + matching FogExp2, hemisphere + directional light, cube removed, temporary grid floor (y = -10) and 5 reference spheres — commit 14cf586 — The reference spheres are my addition so fog and lighting are actually visible; delete them and the grid when they stop being useful (grid probably at 1.8 when the tank wireframe appears). `deltaSeconds` is computed but unused until step 1.4.

## Final tuned values
(Filled in at step 6.10: loudness ceiling, volatility weight, flux weight, attack/release rates, boid weights for each mood.)

## Questions / things I want to revisit
(Owner adds items here; the agent answers them in a later step or on request.)
