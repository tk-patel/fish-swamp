# PLAN.md — 3D Fish School That Reacts to Sound

**Stack (decision):** Vite + vanilla JavaScript + Three.js, plus `lil-gui` for live tuning sliders.
Why vanilla Three.js and not React Three Fiber: you see the real 3D concepts (scene, camera, render loop, matrices) with no framework hiding them. Everything you learn transfers to R3F later.

**How to use this plan:** Do one step, read the agent's explanation, try the experiments, then say "next". Each step is one git commit, so `git show` displays exactly what changed.

Each step has: **Goal**, **Learn**, **Tasks**, **Done when** (what you see in the browser).

---

## PHASE 0 — Setup and the 3D basics

### 0.1 Project skeleton
- **Goal:** A running empty page.
- **Learn:** What Vite does (dev server, ES modules, hot reload).
- **Tasks:** Create a Vite vanilla JS project. Install `three`. Make `index.html` with a full-screen `<canvas>` or container and `src/main.js` that logs "hello". Add `.gitignore`, init git.
- **Done when:** `npm run dev` opens a blank page and the console shows the log.

### 0.2 The three things every 3D scene needs
- **Goal:** Render one spinning cube.
- **Learn:** Scene, Camera, Renderer, and the render loop (`requestAnimationFrame`). What a mesh is (geometry + material).
- **Tasks:** Create scene, perspective camera, WebGLRenderer; add a `BoxGeometry` + `MeshStandardMaterial` cube and a light; rotate the cube each frame.
- **Done when:** A cube spins on screen.

### 0.3 Delta time
- **Goal:** Make the cube spin at the same speed on any screen refresh rate.
- **Learn:** Why frame-based movement is wrong; `THREE.Clock`, `getDelta()`, units per second.
- **Tasks:** Replace per-frame rotation with `rotation.y += speed * delta`. Comment why.
- **Done when:** Same visible speed; agent explains what would happen on a 144Hz monitor without it.

### 0.4 Resize and camera controls
- **Goal:** Responsive canvas and the ability to look around.
- **Learn:** Aspect ratio, projection matrix update, `devicePixelRatio`, OrbitControls.
- **Tasks:** Handle window resize (camera aspect + renderer size). Add `OrbitControls` with damping.
- **Done when:** Resizing keeps the cube undistorted; mouse drag orbits, scroll zooms.

### 0.5 Underwater mood (basic)
- **Goal:** Look like water, not a void.
- **Learn:** Scene background color, `Fog` (linear vs exponential), hemisphere + directional light.
- **Tasks:** Blue-green background, matching `FogExp2`, a hemisphere light and a soft directional light. Remove the cube.
- **Done when:** Empty scene that feels underwater; objects fade into fog with distance. Add a temporary reference grid or floor plane so there is a sense of depth.

---

## PHASE 1 — One fish, built and moving

### 1.1 Fish body from primitives
- **Goal:** A fish body.
- **Learn:** Geometry vs mesh, `scale` for non-uniform shapes, local vs world space.
- **Tasks:** In `src/fish.js` export `createFish()` returning a `THREE.Group`. Body = sphere scaled into an ellipsoid (long on Z, narrow on X).
- **Done when:** A fish-shaped blob floats in the scene; you can orbit around it.

### 1.2 Tail and eyes
- **Goal:** Make it read as a fish.
- **Learn:** Parent/child transforms (children move with the group), pivot points.
- **Tasks:** Add a flattened cone as tail at the back of the body, two small spheres as eyes. Place the tail so its pivot is at the joint with the body (important for step 2.1).
- **Done when:** Recognizable fish. Moving the group moves all parts.

### 1.3 Forward direction convention
- **Goal:** Decide and show which way the fish faces.
- **Learn:** Local axes, why a "forward" axis must be chosen once; `Object3D.lookAt`; `AxesHelper`.
- **Tasks:** Confirm the nose points to local **+Z**. Add a temporary `AxesHelper` to visualize. Rotate the group manually to see it follow.
- **Done when:** Axes visible, nose along +Z, and agent documents the convention in a code comment.

### 1.4 Move forward with a velocity vector
- **Goal:** Fish swims in a straight line.
- **Learn:** `Vector3`, position + velocity * delta, speed vs direction.
- **Tasks:** Store `velocity` (Vector3). Each frame `position.addScaledVector(velocity, delta)`. Point the fish along its velocity.
- **Done when:** Fish glides in a line and eventually leaves the view (expected).

### 1.5 Steering toward a target
- **Goal:** Fish turns smoothly toward a point.
- **Learn:** Desired velocity vs current velocity, steering force = desired - current, max speed, max force. Why we do not just snap the direction.
- **Tasks:** Add a target (small visible sphere). Compute steering and apply to velocity, clamp speed. Show target moving on a circle so you can watch the fish chase it.
- **Done when:** Fish curves smoothly toward the moving target.

### 1.6 Smooth orientation
- **Goal:** Fish body turns gracefully, not jerkily.
- **Learn:** Quaternions in plain terms, `slerp`, why Euler angles cause trouble (gimbal lock).
- **Tasks:** Compute the target rotation from velocity, `slerp` the fish quaternion toward it each frame.
- **Done when:** Turns look smooth; agent shows what `lookAt` alone looked like for comparison.

### 1.7 Wandering
- **Goal:** Fish moves "on its own" with no target.
- **Learn:** Wander steering (a point on a small sphere ahead, nudged randomly), smooth noise vs random jitter.
- **Tasks:** Replace the target chase with wander behavior. Remove the visible target.
- **Done when:** Fish meanders organically without jitter.

### 1.8 Stay inside the tank
- **Goal:** Fish never leaves the visible area.
- **Learn:** Soft boundary (force grows near walls) vs hard clamp.
- **Tasks:** Define a box (about 40 x 20 x 30). Add a steering force back inward when near a wall. Show the box as a temporary wireframe.
- **Done when:** Fish turns around before touching the walls, indefinitely.

---

## PHASE 2 — Making the fish look like it swims

### 2.1 Tail wag (the easy way)
- **Goal:** Tail swings side to side.
- **Learn:** Sine waves: amplitude, frequency, phase; `Math.sin(time * freq) * amp`.
- **Tasks:** Rotate the tail's Y around its joint using a sine of elapsed time.
- **Done when:** Tail wags. Experiment sliders: speed and amplitude.

### 2.2 Tie wag speed to swim speed
- **Goal:** Faster fish wag faster.
- **Learn:** Mapping one value to another (`map`/`lerp`), why animation should respond to motion.
- **Tasks:** Frequency = base + speed * factor.
- **Done when:** Visible change when fish speed changes (use a temporary key to speed up or slow down).

### 2.3 Why we will not use this for 300 fish
- **Goal:** Understand the problem before the fix.
- **Learn:** Draw calls and CPU cost; why separate meshes with separate animation do not scale.
- **Tasks:** Spawn 200 of the multi-part fish. Display FPS (`stats.js` or simple counter) and renderer `info.render.calls`. Observe. Then remove the extra fish, keeping one.
- **Done when:** You have seen real numbers and understand why the next steps exist.

### 2.4 A single-mesh fish
- **Goal:** One geometry for the whole fish.
- **Learn:** Why instancing needs one mesh; custom `BufferGeometry` or merged geometry, vertex positions.
- **Tasks:** Make the fish one mesh (a stretched, tapered body shape; tail is just the back end of it). Keep eyes out for now (can be painted later).
- **Done when:** One-mesh fish moves like before.

### 2.5 Vertex shader wiggle (a wave through the body)
- **Goal:** Whole body undulates, head steady, tail swings the most.
- **Learn:** What a vertex shader is, uniforms, `onBeforeCompile` to inject GLSL into a standard material, applying a sine to vertex x based on its z position.
- **Tasks:** Add a `uTime` uniform. In the injected GLSL: `offsetX = sin(z * waveLength - uTime * speed) * amplitude * tailWeight(z)`. Keep it simple and heavily commented.
- **Done when:** Fish body ripples like a real swimmer.

### 2.6 Tune the wave
- **Goal:** Make it look natural.
- **Learn:** Why the amplitude must grow toward the tail (smoothstep), wavelength, and the traveling-wave idea (`z * k - t * w`).
- **Tasks:** Add `lil-gui` sliders for amplitude, wavelength, speed.
- **Done when:** You can tweak the sliders live and explain what each one does.

---

## PHASE 3 — Many fish with instancing

### 3.1 InstancedMesh with static positions
- **Goal:** Render 300 fish in one draw call.
- **Learn:** `InstancedMesh`, instance matrices, `setMatrixAt`, `instanceMatrix.needsUpdate`.
- **Tasks:** Create an `InstancedMesh` of 300 fish at random positions in the tank.
- **Done when:** A cloud of motionless fish; the draw-call counter shows 1 for fish.

### 3.2 Data-oriented fish state
- **Goal:** Per-fish position and velocity stored efficiently.
- **Learn:** Why use typed arrays (`Float32Array`) instead of 300 objects.
- **Tasks:** In `src/flock.js` keep `positions[]` and `velocities[]` as typed arrays. Each frame, write matrices from them.
- **Done when:** Same visuals, new internals. Agent explains the data layout.

### 3.3 Move all fish with wander
- **Goal:** Port steps 1.4 to 1.8 to every fish.
- **Learn:** Looping over instances, reusing temp vectors to avoid garbage collection.
- **Tasks:** Apply wander and bounds to all fish. Orientation from velocity per instance.
- **Done when:** 300 fish wander independently at 60 FPS.

### 3.4 Per-fish swim phase and speed in the shader
- **Goal:** Fish do not wiggle in lockstep.
- **Learn:** `InstancedBufferAttribute`, per-instance attributes in GLSL.
- **Tasks:** Add `aPhase` attribute (random) and use it in the wiggle. Optionally `aSpeed` to scale the wiggle with the fish's actual speed.
- **Done when:** Each fish has its own rhythm.

### 3.5 Per-fish color and size variation
- **Goal:** Visual variety.
- **Learn:** `instanceColor`, scaling in the instance matrix.
- **Tasks:** Random hue within a palette, random scale (0.7 to 1.3).
- **Done when:** Natural-looking variety.

---

## PHASE 4 — Boids (flocking)

### 4.1 Neighbor search (brute force)
- **Goal:** For each fish, find fish within a perception radius.
- **Learn:** O(n^2) cost, perception radius, why we skip far fish.
- **Tasks:** Implement the neighbor loop with squared distances (explain why squared). Draw debug: highlight one fish and its neighbors.
- **Done when:** You can see neighbors light up around the chosen fish.

### 4.2 Separation
- **Goal:** Fish do not crowd each other.
- **Learn:** Repulsion force inversely proportional to distance.
- **Tasks:** Add the separation force with a weight. Sum with wander and bounds.
- **Done when:** Fish keep personal space; clumps spread out.

### 4.3 Alignment
- **Goal:** Neighbors point the same way.
- **Learn:** Average neighbor velocity; steering toward it.
- **Tasks:** Add alignment with its own weight.
- **Done when:** Small groups swim in the same direction.

### 4.4 Cohesion
- **Goal:** Fish stay together.
- **Learn:** Center of neighbors; steering toward it.
- **Tasks:** Add cohesion with its own weight.
- **Done when:** Visible schools form, drift, split and merge.

### 4.5 Limits and balance
- **Goal:** Stable, pleasant motion.
- **Learn:** Max speed, max steering force, min speed (fish should not stop), weight balancing.
- **Tasks:** Clamp speed to a range; clamp total steering. Tune defaults.
- **Done when:** No jitter, no stalling, no explosive speeds.

### 4.6 Tuning panel
- **Goal:** Control the flock live.
- **Learn:** How each weight changes the character of the flock.
- **Tasks:** `lil-gui` folder: separation, alignment, cohesion, wander, maxSpeed, perception radius.
- **Done when:** You can make it feel like "idle", "tight school" and "scatter" by hand. Write the three slider presets in a code comment. These become the targets for Phase 5.

### 4.7 Performance check
- **Goal:** Know the limits.
- **Learn:** Profiling basics (Performance tab), when O(n^2) hurts, what a spatial hash grid is.
- **Tasks:** Measure at 300, 600, 1000 fish. Do NOT implement the grid unless FPS drops under 50; if so, implement a simple uniform grid and explain it.
- **Done when:** You know the fish count that runs smoothly on your machine and why.

---

## PHASE 5 — Moods (without the mic yet)

### 5.1 The mood object
- **Goal:** A tiny interface between sound and fish.
- **Learn:** Separating inputs from behavior (decoupling).
- **Tasks:** `src/mood.js` exports a state `{ energy: 0..1, chaos: 0..1 }` and a function that converts it into boid weights. Keep it a pure function.
- **Done when:** Changing the two numbers in code changes the flock behavior.

### 5.2 Fake input with sliders/keys
- **Goal:** Test behaviors before the mic exists.
- **Learn:** Why you build and test with fake data first.
- **Tasks:** Two `lil-gui` sliders for energy and chaos (plus keys 1/2/3 for presets: silence, calm, chaos).
- **Done when:** You can drive the fish with your hands.

### 5.3 Mapping design
- **Goal:** Define the behavior table.
- **Learn:** `lerp`, `smoothstep`, blending between states instead of switching.
- **Tasks:** Implement:
  - Silence (energy low): wander high, cohesion/alignment low.
  - Calm (energy up, chaos low): cohesion + alignment high, separation moderate, speed moderate.
  - Chaos (chaos high): cohesion ~0, high separation, flee force on, higher max speed.
- **Done when:** Sliding between states smoothly morphs the behavior.

### 5.4 The flee force
- **Goal:** Real scatter behavior.
- **Learn:** Radial force from a point, randomized threat point so scatter looks organic and not like an explosion from the exact center.
- **Tasks:** Add flee force scaled by chaos. Threat point jitters slowly around the tank center.
- **Done when:** High chaos makes the school burst outward; lowering chaos regroups them.

### 5.5 Smoothing the transitions
- **Goal:** No sudden snaps.
- **Learn:** Exponential smoothing: `value += (target - value) * (1 - exp(-rate * delta))`. Different attack/release speeds (fast to scatter, slow to recover).
- **Tasks:** Smooth weights over time with separate rise and fall rates.
- **Done when:** Fish react quickly to chaos and calm down gradually.

### 5.6 Swim animation follows mood
- **Goal:** Animation reacts too.
- **Learn:** Passing a global uniform (`uMood`) to the shader.
- **Tasks:** Higher chaos -> faster, bigger wiggle (panic). Calm -> slow, smooth wiggle.
- **Done when:** Fish visibly flap faster when scattering.

---

## PHASE 6 — The microphone

### 6.1 Start screen and permission
- **Goal:** Ask for the mic politely.
- **Learn:** Why browsers require a user gesture; `getUserMedia`; HTTPS/localhost rule; error handling when denied.
- **Tasks:** "Enable microphone" button -> request permission -> hide overlay. Constraints: `echoCancellation: false, noiseSuppression: false, autoGainControl: false`. Show a friendly message if denied; fish keep wandering.
- **Done when:** Permission prompt appears and the app handles allow and deny.

### 6.2 AudioContext and AnalyserNode
- **Goal:** Get a live audio stream into JS.
- **Learn:** Audio graph (source -> analyser), `fftSize`, time-domain vs frequency-domain data.
- **Tasks:** `src/audio.js`: create context, `MediaStreamSource`, `AnalyserNode`. Expose a function that fills two typed arrays each frame.
- **Done when:** Console logs non-zero data when you speak.

### 6.3 Volume (RMS)
- **Goal:** One number for "how loud".
- **Learn:** Root mean square, why not just max, dB vs linear.
- **Tasks:** Compute RMS from the time-domain data. Add a small on-screen bar.
- **Done when:** The bar jumps when you talk and sits low in silence.

### 6.4 Noise-floor calibration
- **Goal:** Work in any room.
- **Learn:** Ambient noise, baseline subtraction, normalizing to 0..1.
- **Tasks:** On start, sample ~1 second of RMS, store the average as floor. Normalize: `(rms - floor) / (ceiling - floor)` clamped. Add a "recalibrate" key.
- **Done when:** Quiet room reads about 0 on any mic setup.

### 6.5 Volatility (is it steady or spiky?)
- **Goal:** First signal that separates calm from chaos.
- **Learn:** Rolling window (ring buffer), standard deviation.
- **Tasks:** Keep the last ~60 frames of normalized loudness; compute std dev. Show on screen as a second bar.
- **Done when:** Humming a steady note = low volatility; clapping/shouting = high.

### 6.6 Spectral flux (how fast is the sound changing?)
- **Goal:** Second signal that catches sudden sounds.
- **Learn:** Frequency spectrum, difference between consecutive frames.
- **Tasks:** Using `getByteFrequencyData`, sum positive per-bin differences vs the previous frame; normalize. Third bar.
- **Done when:** Claps give sharp spikes; humming stays flat.

### 6.7 Combine into energy and chaos
- **Goal:** The two numbers the mood system expects.
- **Learn:** Weighted feature combination, clamping, why we keep it simple at first.
- **Tasks:** `energy = loudness`. `chaos = clamp(a * volatility + b * flux)`, and chaos is faded out when energy is near 0. Weights in constants at the top of `audio.js`.
- **Done when:** Debug panel shows sensible energy/chaos for: silence, humming, talking, music, clap, shout.

### 6.8 Smooth the audio signals
- **Goal:** Stable output, still responsive.
- **Learn:** Attack/release envelopes for audio (fast up, slow down).
- **Tasks:** Apply the smoothing helper from 5.5 to energy and chaos.
- **Done when:** No flicker in the debug bars.

### 6.9 Connect audio to mood
- **Goal:** The big moment.
- **Learn:** One-line integration is the reward of having decoupled earlier.
- **Tasks:** Replace the fake sliders' values with real audio values (keep the sliders as a toggleable "manual mode").
- **Done when:** Silence = idle fish; calm sound = school; clap or shout = scatter.

### 6.10 Tuning session
- **Goal:** Make it feel good.
- **Learn:** How to tune by testing with real sounds, one parameter at a time.
- **Tasks:** Test: silence, humming, speaking, music, clapping, shouting, tapping the desk. Adjust thresholds and weights. Record the final values in `PROGRESS.md`.
- **Done when:** It behaves the way you described at the beginning in all six test sounds.

---

## PHASE 7 — Polish (all optional, pick in any order)

### 7.1 Gradient water background and better fog
- Shader/gradient background (light from the top, dark at the bottom). Learn: full-screen gradient with a large sphere or CSS gradient behind a transparent canvas.

### 7.2 Floor, rocks and plants
- Simple low-poly sea floor, a few rocks, swaying seaweed using the same sine-wave vertex trick from 2.5. Learn: reuse of a technique.

### 7.3 Light rays / caustics
- Fake light shafts with a few transparent cones, or an animated caustic texture on the floor. Learn: additive blending, scrolling textures.

### 7.4 Gentle camera drift
- Slow automatic orbit when the user is not interacting. Learn: easing and idle-timers.

### 7.5 Bloom / post-processing
- `EffectComposer` + `UnrealBloomPass`. Learn: post-processing pipeline and its performance cost.

### 7.6 Better fish model
- Swap the generated fish for a low-poly GLB, keep the shader wiggle. Learn: `GLTFLoader`, using a loaded geometry in `InstancedMesh`.

### 7.7 Mobile and performance
- Lower the fish count on small screens, cap the pixel ratio at 2, test the mic on a phone. Learn: adaptive quality.

### 7.8 Deploy
- Deploy to Vercel/Netlify/Cloudflare Pages (HTTPS is required for the mic). Learn: `vite build` and static hosting.

---

## Step template for the agent's reply
See `AGENTS.md` ("What to say after every step"). Every step must end with a commit and a `PROGRESS.md` update.
