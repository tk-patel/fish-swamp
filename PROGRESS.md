# PROGRESS.md

**Current step:** Phase 7 polish — finished 7.1 (reworked), 7.2, 7.3, 7.6
**Last updated:** 2026-10-04 (7.2, 7.3, 7.6 done)

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
- [x] 2.3 Why not 300 multi-part fish (measure)
- [x] 2.4 Single-mesh fish
- [x] 2.5 Vertex shader body wave
- [x] 2.6 Tune the wave with sliders

### Phase 3 — Instancing
- [x] 3.1 InstancedMesh, static positions
- [x] 3.2 Typed-array fish state
- [x] 3.3 Move all fish with wander
- [x] 3.4 Per-fish phase/speed attributes
- [x] 3.5 Per-fish color and size

### Phase 4 — Boids
- [x] 4.1 Neighbor search
- [x] 4.2 Separation
- [x] 4.3 Alignment
- [x] 4.4 Cohesion
- [x] 4.5 Limits and balance
- [x] 4.6 Tuning panel and presets
- [x] 4.7 Performance check

### Phase 5 — Moods (no mic)
- [x] 5.1 Mood object
- [x] 5.2 Fake input (sliders/keys)
- [x] 5.3 Mapping design (silence / calm / chaos)
- [x] 5.4 Flee force
- [x] 5.5 Smoothing transitions
- [x] 5.6 Swim animation follows mood

### Phase 6 — Microphone
- [x] 6.1 Start screen and permission
- [x] 6.2 AudioContext and AnalyserNode
- [x] 6.3 Volume (RMS)
- [x] 6.4 Noise-floor calibration
- [x] 6.5 Volatility
- [x] 6.6 Spectral flux
- [x] 6.7 Combine into energy and chaos
- [x] 6.8 Smooth audio signals
- [x] 6.9 Connect audio to mood
- [x] 6.10 Tuning session

### Phase 7 — Polish (optional)
- [x] 7.1 Gradient water and fog
- [x] 7.2 Floor, rocks, plants
- [x] 7.3 Light rays / caustics
- [ ] 7.4 Camera drift
- [ ] 7.5 Bloom
- [x] 7.6 Better fish model (built in code, no GLB)
- [ ] 7.7 Mobile and performance
- [ ] 7.8 Deploy

### Phase 8 — Salmon pond makeover
- [ ] 8.1 Clean turquoise pond, top-down camera, screen = pond
- [ ] 8.2 Hidden controls, toggled with C
- [ ] 8.3 Salmon instead of koi
- [ ] 8.4 Mood tuning for the new pond

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
- step 2.3 — bottom-left readout (FPS, draw calls, triangles); temporary ?stress=N URL parameter spawns N extra multi-part fish with their own tail wags. Measured on the owner's machine setup used for testing (120 Hz display): 1 fish = 9 calls / 120 FPS; 200 extra = ~790 calls / 120 FPS; 1000 extra = ~3930 calls / 58 FPS. Default page keeps only one fish. The ?stress code stays until step 3.1 so we can compare single-mesh (2.4) and instanced (3.1) numbers — commit: 22decd7
- step 2.4 — createFish() now returns ONE Mesh built from a custom BufferGeometry (40 rings x 16 sides, egg body -> thin stalk -> flat fin, vertex colors, shared geometry+material). Eyes dropped. The CPU tail wag (2.1/2.2), its lil-gui panel and the arrow keys were removed (no tail pivot any more; lil-gui stays installed for 2.6). ?stress=1000: 3933 calls / 58 FPS (4-mesh fish) -> ~997 calls / 120 FPS (single mesh). The fish does not wiggle again until 2.5 — commit: d0597b2
- step 2.5 — onBeforeCompile injects GLSL after <begin_vertex> in MeshStandardMaterial: transformed.x += sin(z * k + uTime * speed) * amplitude * tailWeight (linear ramp, head still at z>=0.8, full at tail tip); uTime uniform updated in animate(); constants amplitude 0.35, wavelength 3.0, speed 9 rad/s — sign is + (not - as written generically in PLAN) because our nose is +Z and the wave must travel head -> tail; all fish share one uniform so they wiggle in lockstep until 3.4 — commit: 5e5bef4
- step 2.6 — wave tuning panel (lil-gui 'Swim wave': amplitude, wavelength, speed); tail weight now 1 - smoothstep(tailTip, headZ, z) instead of a linear ramp; the shader uses uniforms uAmplitude / uWavelength / uPhase; uTime replaced by an accumulated uPhase (phase += speed * delta on the CPU) so moving the speed slider does not make the body snap — commit: 47ba044
- step 3.1 — createFishInstancedMesh(300): random positions/headings in tank, shared geo+material; removed single swimming fish, ?stress=, axes helper, wander debug; wander/steer code kept but paused until 3.3 — (commit pending)
- step 3.2 — src/flock.js: Float32Array positions/velocities/orientations/wanderOffsets; matrices written from arrays — (commit pending)
- step 3.3 — flock.update(): per-fish wander, tank bounds, velocity steering, quaternion slerp → setMatrixAt each frame; main.js steering block removed — (commit pending)
- step 3.4 — InstancedBufferAttribute aPhase + aWiggleMul; per-fish phase advanced in flock from swim speed; dropped global uPhase — (commit pending)
- step 3.5 — setColorAt random orange palette; per-fish scale 0.7–1.3 on instance matrix — (commit pending)
- step 4.1 — findNeighbors() with dist² < r²; debug watch fish (magenta), neighbors (cyan), wire perception sphere; N key cycles watch index — (commit pending)
- step 4.2 — separation steering (away vector / dist²), averaged, weighted 1.8, summed with wander + bounds before clamp — (commit pending)
- step 4.3 — alignment: average neighbor velocity, steer toward it (weight 1.0) — (commit pending)
- step 4.4 — cohesion: steer toward neighbor center of mass (weight 1.0) — 9c8e4e3
- step 4.5 — flockSettings min/max speed, enforceSpeedLimits, tuned weights, cohesion steer fix — d332dd9
- step 4.6 — lil-gui Flocking folder + idle/tightSchool/scatter presets — 418e84d
- step 4.7 — ?fish=N count param, stats show fish count; perf notes below — (commit pending)
- step 5.1 — `src/mood.js`: moodState { energy, chaos } + pure moodToFlockWeights(); main applies each frame — a5d9879
- step 5.2 — Mood lil-gui folder + keys 1/2/3 and moodPresets silence/calm/chaos — d20dbd6
- step 5.3 — moodAnchors table + smoothstep blends; fleeWeight on flockSettings (used in 5.4) — 7c67ebc
- step 5.4 — jittering threat point + flee steering scaled by fleeWeight — 3258b6c
- step 5.5 — exponential smooth on mood weights (attackRate / releaseRate) — 6b31e55
- step 5.6 — uMood uniform + moodSpeedMul; swim phase and amplitude follow chaos — e8d954f
- step 6.1 — mic overlay + getUserMedia (raw audio constraints); deny/skip paths; fish keep running — 35f4d26
- step 6.2 — AudioContext + AnalyserNode; per-frame sampleMicrophoneAnalysis; console debug peaks — 2f2120e
- step 6.3 — RMS from time-domain bytes; on-screen volume bar — 87fbcf7
- step 6.4 — 1 s noise floor + normalize to 0..1; R to recalibrate — 8640241
- step 6.5–6.10 — volatility/flux bars, energy+chaos, smooth + mic→mood, tuning constants — 39aa60a
- step 7.1 — pond bounds from camera frustum; gradient background + fog; tank wireframe/grid removed — 2ff2bc2
- step 7.1 rework — fixed shallow pond (46 x 6 x 30) instead of frustum-derived bounds, angled camera, light fog (0.008), vertical gradient; removed depth shrink/darken and the always-on watch-fish debug tint + perception sphere; default fish 160; vertical damping + smaller vertical boundary margin for shallow water — 7cb3fed
- step 7.2 — `src/environment.js`: dune floor (sine heights + vertex colors), 12 low-poly rocks + pebbles (noise-displaced icosahedrons, seeded random), ~330 seaweed blades as one InstancedMesh with a vertex-shader sway — 448718a
- step 7.3 — `src/caustics.js`: procedural caustic pattern added in the fragment shader of floor and rocks; 9 additive-blended light-shaft cones — 59c1576
- step 7.6 — fish rebuilt in code as ONE merged mesh: shaped body with belly/patch brightness, forked tail, dorsal + pectoral fins, eyes; grey vertex colors x koi-palette instance colors; DoubleSide material — d40862e. No GLB: the project has no model file; swapping later only touches createFishGeometry().

## Phase 4 performance (step 4.7)
Brute-force neighbors = ~n² distance checks per frame (each fish scans all others). GPU stays cheap (one fish draw call); CPU is the limit.

Test: `npm run dev` then open `?fish=300`, `?fish=600`, `?fish=1000` and read bottom-left FPS.

| fish | FPS (fill in on your machine) | notes |
|------|-------------------------------|-------|
| 300  |                               | target: smooth (50+) |
| 600  |                               | |
| 1000 |                               | if under 50 FPS, next step would be a uniform spatial grid |

Why no grid yet: at 300 fish the sim should stay smooth on a typical laptop; only add a spatial hash if your 1000-fish test drops below ~50 FPS. A grid buckets fish into cells so each fish only checks nearby buckets instead of all n.

## Final tuned values (step 6.10)
Audio (`src/audio.js`):
- `loudnessCeilingRms`: **0.2**
- `spectralFluxSumNormalizer`: **14000**
- `audioMoodWeights.volatilityWeight`: **5.5**
- `audioMoodWeights.fluxWeight`: **1.0**
- `audioMoodWeights.energyChaosFadeEnd`: **0.06**
- `calmBuildup`: rise **0.32**/s, silence fall **0.09**/s, chaos drain **4.2**
- `audioCalmSmoothing`: attack **5**, release **0.85** (schooling eases in/out)
- `audioChaosSmoothing`: attack **22**, release **2.5** (scatter snaps fast)
- Flock mood weight release (`mood.js`): **1.35**
- Volatility UI scale in main: **×8** on std-dev for bar display

**Behavior:** steady hum / soft voice builds **calmness** → fish school and stay tight; silence decays calm slowly → loose flock then wander; clap/shout spikes **chaos** and drains calm → scatter.

Mood flock anchors unchanged from step 5.3 (`mood.js` `moodAnchors`).

**Sound test cheat sheet:** silence → wander; steady hum/speech → school (energy↑ chaos↓); clap/shout/desk tap → scatter (chaos↑). **R** = recalibrate noise floor (stay quiet 1 s). **M** = manual mood sliders. Keys **1/2/3** only when manual mode on.

## Questions / things I want to revisit
(Owner adds items here; the agent answers them in a later step or on request.)
