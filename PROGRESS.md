# PROGRESS.md

**Current step:** 2.3 (next up)
**Last updated:** 2026-10-04 (finished 2.2)

Rules: tick a box only after the step is done, committed, and explained. Add a one-line log entry below the checklist. Do not start the next step until the owner says "next".

## Checklist

### Phase 0 — Setup and 3D basics
- [x] 0.1 Project skeleton
- [x] 0.2 Scene, camera, renderer, spinning cube
- [x] 0.3 Delta time
- [x] 0.4 Resize and OrbitControls
- [x] 0.5 Underwater mood (background, fog, lights)

### Phase 1 — One fish
- [x] 1.1 Fish body from primitives
- [x] 1.2 Tail and eyes
- [x] 1.3 Forward direction convention
- [x] 1.4 Move with a velocity vector
- [x] 1.5 Steering toward a target
- [x] 1.6 Smooth orientation (quaternion slerp)
- [x] 1.7 Wandering
- [x] 1.8 Stay inside the tank

### Phase 2 — Swim animation
- [x] 2.1 Tail wag with sine
- [x] 2.2 Wag speed tied to swim speed
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
- step 1.1 — new `src/fish.js` with `createFish()` returning a Group holding an ellipsoid body (sphere scaled 0.35 x 0.5 x 1.0, so ~2 units long on Z); added to the scene in main.js — commit 9338dd2 — AGENTS.md's unit rule ("1 unit ~ 1 fish body length * 2") was ambiguous; I read it as 1 unit = half a body length, i.e. fish ~2 units long. Camera is temporarily closer at (7, 2, 4); back to (0, 5, 35) at step 1.8.
- step 1.2 — flattened cone tail inside a `tailPivot` Group (joint at z = -0.9, named 'tailPivot' for step 2.1), two dark sphere eyes mirrored in X — commit d029815 — Only fish.js changed. Tail tip sits at the joint, wide base faces -Z.
- step 1.3 — documented the +Z forward convention at the top of fish.js; temporary AxesHelper on the fish and a temporary slow spin of the fish group (both in main.js) — commit 5bc9ba3 — Convention: +Z forward, +Y up, +X is the fish's left. Remove the temporary spin when step 1.4 gives the fish a velocity; the axes can stay until the owner is comfortable.
- step 1.4 — `fishVelocity` Vector3 (1.5, 0.3, 2.0); each frame `position.addScaledVector(velocity, delta)` and `lookAt(position + velocity)`; temporary spin removed — commit e2ad2f0 — Fish leaves the view after a few seconds (expected). Reload the page to see it again. The AxesHelper is still on the fish.
- step 1.5 — yellow target sphere on a radius-6 circle (with a gentle y bob); fish steers with steering = desired - velocity, clamped to maxSteeringForce (6), speed clamped to maxSpeed (4) — commit a0a93c9 — Camera moved to (0, 12, 18) so the whole circle is visible. Orientation is still a hard `lookAt` snap (fixed in 1.6).
- step 1.6 — target quaternion from `Matrix4.lookAt` (world up kept), `fish.quaternion.slerp(target, 1 - exp(-turnRate * delta))`, turnRate 5; temporary keys L (toggle lookAt vs slerp) and R (reverse velocity) — commit ab6bf0f — With the slowly changing velocity of the circle chase the two versions look similar; the difference shows when you press R. The key handler and the L/R keys are temporary.
- step 1.7 — removed the chase target; wander = random-nudged point on a sphere (r 2) placed 4 units ahead of the fish, sought with the same steering; maxSpeed 3, maxSteeringForce 5 — commit 53da745 — Added temporary debug visuals (blue wireframe wander sphere + red wander point) beyond the plan; delete later. The fish now drifts out of view after ~10 s (expected until 1.8 adds the tank bounds); reload to restart.
- step 1.8 — 40 x 20 x 30 wireframe tank; soft boundary force per axis (linear ramp over a 5-unit margin, weight 30, added to the steering sum before the clamp); camera back to (0, 5, 35); reference spheres removed (grid floor stays) — commit 16be77a — Tested in the browser: 45 s of wandering plus a teleport to near a corner; the fish never passed 90% of the half-size on any axis.
- step 2.1 — installed lil-gui; tail pivot rotated with sin(elapsed * frequency * 2PI) * amplitude; sliders for frequency (2 Hz) and amplitude (0.5 rad) — commit: e4db00a
- step 2.2 — wag frequency = base (0.8 Hz) + speed * 0.6; phase accumulated each frame (no jumps when frequency changes); read-only speed/frequency in the GUI; temporary Arrow Up/Down keys change maxSpeed (1..6). Measured: speed 0.9 -> 1.35 Hz, 2.7 -> 2.4 Hz, 5.7 -> 4.2 Hz — commit: dba9208

## Final tuned values
(Filled in at step 6.10: loudness ceiling, volatility weight, flux weight, attack/release rates, boid weights for each mood.)

## Questions / things I want to revisit
(Owner adds items here; the agent answers them in a later step or on request.)
