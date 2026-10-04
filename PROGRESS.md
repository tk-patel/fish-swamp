# PROGRESS.md

**Current step:** 0.1
**Last updated:** (agent fills in)

Rules: tick a box only after the step is done, committed, and explained. Add a one-line log entry below the checklist. Do not start the next step until the owner says "next".

## Checklist

### Phase 0 — Setup and 3D basics
- [ ] 0.1 Project skeleton
- [ ] 0.2 Scene, camera, renderer, spinning cube
- [ ] 0.3 Delta time
- [ ] 0.4 Resize and OrbitControls
- [ ] 0.5 Underwater mood (background, fog, lights)

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

## Final tuned values
(Filled in at step 6.10: loudness ceiling, volatility weight, flux weight, attack/release rates, boid weights for each mood.)

## Questions / things I want to revisit
(Owner adds items here; the agent answers them in a later step or on request.)
