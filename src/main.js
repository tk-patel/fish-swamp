// Entry point: sets up the three things every 3D scene needs
// (scene, camera, renderer) and runs the render loop.

import * as THREE from 'three';
// OrbitControls is an "addon": it ships inside the three package but is not
// part of the core THREE object, so we import it from 'three/addons/...'.
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createFish } from './fish.js';

// ---------------------------------------------------------------------------
// 1. SCENE - the "stage". An empty container that holds everything we want
//    to see: meshes, lights, and later fish. Nothing is drawn unless it is
//    added to the scene.
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();

// ---------------------------------------------------------------------------
// UNDERWATER MOOD, part 1: background + fog (step 0.5)
//
// Background: the color painted wherever nothing else is drawn. Before this
// it was black (the renderer default), which looks like space, not water.
// A THREE.Color can be made from a hex number: 0xRRGGBB, so 0x0a4a5c means
// red = 0x0a, green = 0x4a, blue = 0x5c -> a deep blue-green.
//
// Fog: objects far from the camera get blended toward the fog color, so they
// fade into the "murk". This is the single cheapest trick for faking water.
//   - Fog / linear:   fade starts at a `near` distance, fully gone at `far`.
//                     Easy to reason about, but the fade has hard-ish edges.
//   - FogExp2 / exponential: the fog thickens smoothly with distance, the way
//                     real haze does: blend = 1 - e^(-(density * distance)^2).
//                     You only tune one number: `density`.
// We use FogExp2 because it looks more natural.
//
// IMPORTANT: the fog color must equal the background color. If it didn't,
// far objects would fade into one color while the empty space behind them is
// another, and you'd see a visible "halo" of the wrong color.
// ---------------------------------------------------------------------------
const waterColor = new THREE.Color(0x0a4a5c);
scene.background = waterColor;
const fogDensity = 0.025; // bigger = murkier. Try 0.01 (clear) to 0.06 (soup).
scene.fog = new THREE.FogExp2(waterColor, fogDensity);

// ---------------------------------------------------------------------------
// 2. CAMERA - the "eye". PerspectiveCamera behaves like a real camera or your
//    eye: things farther away look smaller.
//
//    Arguments:
//      fov    (50)  - vertical field of view in degrees. Bigger = wider lens.
//      aspect       - width / height of the canvas. If this is wrong the
//                     picture looks stretched (resize handler below, step 0.4).
//      near   (0.1) - anything closer than this to the camera is not drawn.
//      far  (1000)  - anything farther than this is not drawn.
// ---------------------------------------------------------------------------
const camera = new THREE.PerspectiveCamera(
  50,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);
// By default the camera sits at (0, 0, 0) looking down the -Z axis.
// Our tank will be a box about 40 x 20 x 30 units centered on the origin, so
// we back the camera up along +Z (towards us) and lift it a little (+Y)
// to see all of it. OrbitControls (below) looks at the origin by default.
//
// TEMPORARY (step 1.1): a fish is only ~2 units long, so from the full-tank
// view at (0, 5, 35) it would be a speck. We stay closer while we build one
// fish. (Step 1.5: moved back and up a little to see more of the area.)
// Step 1.8: back to the full-tank view (0, 5, 35) so the whole 40 x 20 x 30
// tank fits on screen. The fish is small from here; scroll to zoom in.
camera.position.set(0, 5, 35);

// ---------------------------------------------------------------------------
// 3. RENDERER - the "photographer". It takes the scene + camera and paints
//    the picture onto a <canvas> using WebGL (the browser's GPU API).
//    `antialias: true` smooths jagged edges.
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
// devicePixelRatio = how many real screen pixels make up one CSS pixel.
// 1 on a normal monitor, 2 on a Retina/HiDPI screen (a 2x2 block of tiny
// pixels per CSS pixel). If we ignore it, the canvas is drawn at CSS size
// and then stretched up by the browser, which looks blurry on Retina.
// We cap it at 2: phones can report 3+, and drawing 9x the pixels costs a
// lot of GPU time for a difference your eye can barely see.
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
// The renderer created its own <canvas> element; we put it in the page.
document.querySelector('#app').appendChild(renderer.domElement);

// ---------------------------------------------------------------------------
// RESIZE - when the window changes size we must update TWO things:
//   1. The renderer: resize the canvas so it still fills the window.
//   2. The camera's aspect ratio (width / height). The camera turns the 3D
//      world into a flat picture using a "projection matrix" (a grid of
//      numbers that squashes 3D coordinates onto a 2D screen). That matrix
//      has the aspect ratio baked in. If the window gets wider but the
//      camera still thinks it is the old shape, the cube looks stretched.
//      Changing camera.aspect does nothing by itself; we must call
//      updateProjectionMatrix() so the matrix is recalculated.
// ---------------------------------------------------------------------------
window.addEventListener('resize', () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

// ---------------------------------------------------------------------------
// ORBIT CONTROLS - lets you move the camera with the mouse:
//   drag = orbit around the target, scroll = zoom, right-drag = pan.
// "Orbit" means the camera moves on a sphere around a target point
// (by default the origin, (0, 0, 0), the center of our tank) and always looks at it.
//
// Damping adds inertia: after you let go the camera glides to a stop
// instead of halting instantly. It feels much smoother, but it only works
// if we call controls.update() every frame (see animate()).
// ---------------------------------------------------------------------------
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.05; // smaller = longer glide

// ---------------------------------------------------------------------------
// UNDERWATER MOOD, part 2: lights
//
// Without light, a MeshStandardMaterial renders pure black. We use two:
//
// 1. HemisphereLight = soft "ambient" light from the whole sky dome.
//    You give it a SKY color (used by surfaces facing up) and a GROUND color
//    (used by surfaces facing down); surfaces facing sideways get a blend.
//    Underwater, light comes down from the bright surface, and the deep
//    below is dark and blue-green, so: pale cyan on top, dark teal below.
//    It has no direction and casts no shadows, so it gently fills in the
//    areas the sun doesn't reach (no pitch-black undersides).
//
// 2. DirectionalLight = the "sun" shining down through the water.
//    Parallel rays from one direction; its position only defines WHICH
//    direction (towards the origin). It adds the shaded/lit look that makes
//    shapes feel 3D. We keep it soft (low intensity, slightly blue-white)
//    since light is scattered underwater.
// ---------------------------------------------------------------------------
const skyColor = 0x9fe6ff; // light from above
const groundColor = 0x06232c; // light bounced up from the deep
const hemisphereLight = new THREE.HemisphereLight(skyColor, groundColor, 1.2);
scene.add(hemisphereLight);

const sunLight = new THREE.DirectionalLight(0xcfefff, 1.5);
sunLight.position.set(10, 30, 10); // high above, slightly off-center
scene.add(sunLight);

// ---------------------------------------------------------------------------
// THE FISH (step 1.1) - built in src/fish.js. We just add the returned Group
// to the scene. It sits at the origin (0, 0, 0) by default.
// ---------------------------------------------------------------------------
const fish = createFish();
scene.add(fish);
// TEMPORARY (step 1.3): AxesHelper draws three colored lines from the
// object's origin along its local axes, so you can SEE the directions:
//   RED   = local +X     GREEN = local +Y     BLUE = local +Z
// (Memory trick: R-G-B = X-Y-Z.) The argument is the length of each line.
// We add it to the FISH (not the scene) so it is a child of the fish and
// turns together with it, which shows the fish's LOCAL axes, not the world's.
// Our convention (see fish.js): the nose points along the BLUE line.
const fishAxes = new THREE.AxesHelper(2.5);
fish.add(fishAxes);

// ---------------------------------------------------------------------------
// FISH VELOCITY (step 1.4)
//
// A THREE.Vector3 is just three numbers (x, y, z). The same type is used for
// two different ideas, which is a common source of confusion:
//   - a POINT in space:  "the fish is AT (2, 1, 0)"       -> fish.position
//   - an ARROW / change: "the fish moves BY (2, 1, 0)/sec" -> velocity
//
// VELOCITY = speed AND direction in one arrow:
//   - the arrow's direction is where the fish is heading
//   - the arrow's length is how fast (units per second)
// Here: 1.5 units/sec along X, 0.3 up, 2.0 along Z (the STARTING velocity;
// from step 1.5 on, steering changes it every frame).
// Its length is sqrt(1.5^2 + 0.3^2 + 2.0^2) = about 2.5 units per second,
// which is the SPEED. `velocity.length()` gives you that number.
// ---------------------------------------------------------------------------
const fishVelocity = new THREE.Vector3(1.5, 0.3, 2.0);

// A reusable scratch Vector3 for "the point the fish should look at".
// We make it once, outside the render loop, and refill it each frame,
// because creating new objects 60 times a second adds up (garbage collection).
const fishLookTarget = new THREE.Vector3();

// ---------------------------------------------------------------------------
// STEERING (steps 1.5 and 1.7)
//
// The two limits that shape how the fish moves:
//   maxSpeed         - the fastest the fish can swim (units per second).
//   maxSteeringForce - how hard the fish can turn/accelerate, measured as
//                      "how much its velocity arrow may change per second".
//                      Small = lazy, wide turns (a big whale).
//                      Large = sharp, twitchy turns (a minnow).
// ---------------------------------------------------------------------------
const maxSpeed = 3;
const maxSteeringForce = 5;

// Scratch vectors, reused every frame (same reason as fishLookTarget).
const desiredVelocity = new THREE.Vector3();
const steeringForce = new THREE.Vector3();

// ---------------------------------------------------------------------------
// THE TANK (step 1.8) - the box the fish must stay inside.
// 40 wide (X) x 20 tall (Y) x 30 deep (Z), centered on the origin, so the
// walls are at x = +-20, y = +-10, z = +-15. The camera also goes back to
// the full-tank view (set where the camera is created).
//
// Two ways to keep fish inside:
//   HARD CLAMP: if position is outside, force it back to the wall.
//     Simple and a guaranteed rule, but the fish slams into an invisible wall
//     and gets stuck sliding along it, and the heading snaps. Looks fake.
//   SOFT BOUNDARY (what we use): near a wall, add a steering force pointing
//     inward that gets STRONGER the closer the fish is. The fish sees the wall
//     coming and curves away early, like a real fish. It is just one more
//     steering arrow, added to the same sum as wander.
// ---------------------------------------------------------------------------
const tankSize = new THREE.Vector3(40, 20, 30);
const tankHalfSize = tankSize.clone().multiplyScalar(0.5); // (20, 10, 15)

// TEMPORARY wireframe so we can see the tank. BoxGeometry has two triangles
// per face; EdgesGeometry keeps only the real box edges (12 lines) so we do
// not see the diagonal lines through each face. LineSegments draws them.
const tankWireframe = new THREE.LineSegments(
  new THREE.EdgesGeometry(new THREE.BoxGeometry(tankSize.x, tankSize.y, tankSize.z)),
  new THREE.LineBasicMaterial({ color: 0x7fe0ff }),
);
scene.add(tankWireframe);

// How close to a wall before the fish starts to feel it (units). Further than
// this from every wall = no boundary force at all.
const boundaryMargin = 5;

// How strongly the boundary pushes, compared to the fish's own wishes.
// It is much bigger than maxSteeringForce (5) on purpose: right next to the
// wall the boundary must WIN against the wander/seek pull, which can be up
// to about 6. The final total is still clamped to maxSteeringForce, so the
// fish turns at its normal rate; this number only decides who gets priority.
const boundaryWeight = 30;

const boundaryForce = new THREE.Vector3(); // scratch, reused every frame

// For ONE axis: how hard should the fish be pushed back from the walls?
//   coordinate: the fish's position on this axis (e.g. its x)
//   halfExtent: distance from the center to the wall on this axis (e.g. 20)
// Returns a number from -1 to +1:
//   0   = far from both walls (no push)
//   -1  = touching the + wall (push fully towards -)
//   +1  = touching the - wall (push fully towards +)
function getAxisBoundaryPush(coordinate, halfExtent) {
  // How far past the start of the "danger zone" is the fish? The zone begins
  // `boundaryMargin` units before the wall.
  const distanceIntoZone = Math.abs(coordinate) - (halfExtent - boundaryMargin);
  if (distanceIntoZone <= 0) {
    return 0; // still in the safe middle: no push
  }
  // 0 at the edge of the zone, 1 at the wall, and beyond the wall we keep
  // it at 1 (Math.min), so a fish that overshoots is still pushed hard.
  const strength = Math.min(distanceIntoZone / boundaryMargin, 1);
  // Push TOWARDS the center: opposite to the side the fish is on.
  // Math.sign gives +1 for positive numbers and -1 for negative ones.
  return -Math.sign(coordinate) * strength;
}

// ---------------------------------------------------------------------------
// WANDER (step 1.7) - swimming around "on its own", with no target.
//
// The naive idea: every frame steer in a random direction. That fails: the
// random direction changes 60 times a second, so the fish just trembles in
// place (jitter). Real wandering has MEMORY: the fish keeps going roughly the
// way it was going and its "mind" drifts slowly.
//
// Craig Reynolds' trick (the same author as the seek from step 1.5):
//   1. Imagine an invisible sphere floating a little way IN FRONT of the fish
//      (its center is `wanderDistance` ahead along the current heading).
//   2. Keep a "wander point" on the surface of that sphere. This is where the
//      fish currently feels like going. Then just SEEK that point, exactly
//      like the old target chase.
//   3. Every frame, nudge the wander point a tiny random amount, and push it
//      back onto the sphere's surface. Because it only moves a little each
//      frame, the change is smooth: the fish drifts into gentle curves and
//      lazy turns instead of twitching.
//
// The sphere's size controls the character:
//   wanderRadius   - bigger sphere = the point can be far off to the side =
//                    sharper turns.
//   wanderDistance - further away = the pull is more "straight ahead" =
//                    straighter paths.
//   wanderJitter   - how fast the point wanders around the sphere (units per
//                    second) = how often it changes its mind.
// ---------------------------------------------------------------------------
const wanderDistance = 4;
const wanderRadius = 2;
const wanderJitter = 6;

// The wander point, stored as an OFFSET from the sphere's center. Its length
// is always wanderRadius (so it sits on the surface). Start pointing +Z.
const wanderOffset = new THREE.Vector3(0, 0, wanderRadius);

// Scratch vectors for working out where the wander point is in the world.
const wanderSphereCenter = new THREE.Vector3();
const wanderPoint = new THREE.Vector3();

// TEMPORARY debug visuals (delete when you no longer need them):
//   - a wireframe sphere showing the invisible wander sphere
//   - a small red dot showing the current wander point the fish is seeking
const wanderSphereDebug = new THREE.Mesh(
  new THREE.SphereGeometry(wanderRadius, 16, 12),
  new THREE.MeshBasicMaterial({ color: 0x66ccff, wireframe: true }),
);
scene.add(wanderSphereDebug);
const wanderPointDebug = new THREE.Mesh(
  new THREE.SphereGeometry(0.2, 12, 8),
  new THREE.MeshBasicMaterial({ color: 0xff3355 }),
);
scene.add(wanderPointDebug);

// ---------------------------------------------------------------------------
// SMOOTH ORIENTATION (step 1.6)
//
// Why isn't lookAt enough? `fish.lookAt(x)` replaces the fish's rotation with
// the one facing x, instantly. While the velocity changes slowly (like now)
// that looks fine, but ANY sudden change in velocity (a collision, a flee
// force, the keypress below) makes the nose snap. Fish bodies are heavy: we
// want the body to ease towards the new heading instead.
//
// QUATERNIONS in plain terms: a rotation can be stored as three Euler angles
// (x, y, z - "turn this much around X, then Y, then Z" - which is what
// fish.rotation holds), or as a QUATERNION: four numbers that describe
// "rotate by this angle around this axis" in one go. Euler angles are easy to
// read but bad to blend: the order matters, and in some poses two of the
// three axes line up ("gimbal lock") so you lose a way to rotate and the
// interpolation takes weird detours. Quaternions have no such problem and
// blend cleanly along the shortest path. That's why Three.js stores every
// object's rotation as a quaternion internally (fish.quaternion), and
// fish.rotation is just a friendlier view of it.
// You never need to read the four numbers; you only combine and slerp them.
// ---------------------------------------------------------------------------
const turnRate = 5; // bigger = snappier turns. Try 1 (lazy) to 20 (almost instant).
const worldUp = new THREE.Vector3(0, 1, 0);
const lookMatrix = new THREE.Matrix4(); // scratch, reused every frame
const targetQuaternion = new THREE.Quaternion(); // scratch, reused every frame

// TEMPORARY keys for comparing the two versions side by side:
//   L = toggle between abrupt lookAt and smooth slerp
//   R = REVERSE the fish's velocity (a sudden 180-degree change of mind)
let useSmoothTurning = true;
window.addEventListener('keydown', (event) => {
  if (event.key === 'l' || event.key === 'L') {
    useSmoothTurning = !useSmoothTurning;
    console.log(useSmoothTurning ? 'turning: smooth (slerp)' : 'turning: abrupt (lookAt)');
  }
  if (event.key === 'r' || event.key === 'R') {
    fishVelocity.negate(); // (x, y, z) -> (-x, -y, -z)
  }
});

// ---------------------------------------------------------------------------
// TEMPORARY REFERENCE FLOOR (sense of depth).
// An empty blue-green void has no scale, so you can't tell how far anything
// is. GridHelper gives your eye something to measure against: a flat grid of
// lines acting as the tank floor. The tank is 20 tall and centered on y = 0,
// so its floor is at y = -10.
//   Args: total size (120), number of divisions (60 -> 2-unit squares),
//   color of the center lines, color of the other lines.
// ---------------------------------------------------------------------------
const referenceFloor = new THREE.GridHelper(120, 60, 0x4fb8c8, 0x1d7a8a);
referenceFloor.position.y = -10;
scene.add(referenceFloor);

// (Step 1.8: the reference spheres were removed - there is a fish and a tank
// to look at now, and spheres floating inside the tank would look like
// obstacles the fish swims through.)

// ---------------------------------------------------------------------------
// PERFORMANCE READOUT (step 2.3) - a small text box in the bottom-left corner.
//   FPS        = frames per second actually achieved (60 is the goal).
//   draw calls = how many times per frame the CPU tells the GPU "draw this
//                mesh". renderer.info.render.calls counts them for us.
//   triangles  = how many triangles the GPU had to draw per frame.
//
// WHY DRAW CALLS MATTER: each separate Mesh costs one draw call, and each
// draw call has a fixed CPU cost (the browser must validate state, send
// commands to the graphics driver, ...). The GPU itself can draw millions of
// triangles easily, but the CPU can only SEND maybe a few thousand draw calls
// per frame before the frame rate drops. So "many small meshes" is slow
// even if every mesh is tiny.
// ---------------------------------------------------------------------------
const statsBox = document.createElement('div');
statsBox.style.cssText =
  'position:fixed;left:8px;bottom:8px;padding:6px 8px;background:rgba(0,0,0,0.55);' +
  'color:#cfefff;font:12px/1.4 monospace;pointer-events:none;white-space:pre;';
document.body.appendChild(statsBox);

let framesSinceStatsUpdate = 0;
let secondsSinceStatsUpdate = 0;

// ---------------------------------------------------------------------------
// STRESS TEST (step 2.3) - TEMPORARY. Open the page as
//   http://localhost:5173/?stress=200
// to add 200 EXTRA fish and watch the numbers above. Without the "?stress="
// part you get just the one swimming fish. These extra fish do not swim
// around; they just hover, which is enough to show the cost of rendering
// them. (Step 2.3 measured this with the 4-mesh fish; since step 2.4 each
// fish is ONE mesh, so the draw calls are 4x lower. Compare!)
// ---------------------------------------------------------------------------
const stressFishCount = Number(new URLSearchParams(window.location.search).get('stress')) || 0;
for (let i = 0; i < stressFishCount; i++) {
  const extraFish = createFish();
  // Random spot inside the tank: Math.random() is 0..1, so (r - 0.5) is
  // -0.5..0.5, and times the tank size gives a random point in the box.
  extraFish.position.set(
    (Math.random() - 0.5) * tankSize.x,
    (Math.random() - 0.5) * tankSize.y,
    (Math.random() - 0.5) * tankSize.z,
  );
  extraFish.rotation.y = Math.random() * Math.PI * 2; // random heading
  scene.add(extraFish);
}

// ---------------------------------------------------------------------------
// TIMER - measures real time between frames.
// (The plan says THREE.Clock, but Clock is deprecated in the Three.js version
// we installed. THREE.Timer is its replacement and works the same way for us:
// "how many seconds passed since the last frame?")
// `connect(document)` makes the timer notice when the browser tab is hidden,
// so when you come back it doesn't report a huge, fake "delta" of minutes.
// ---------------------------------------------------------------------------
const timer = new THREE.Timer();
timer.connect(document);

// ---------------------------------------------------------------------------
// RENDER LOOP - a movie is many still pictures shown quickly. Each pass of
// this function draws one picture ("frame").
// requestAnimationFrame asks the browser: "call this function right before
// you paint the next frame". The browser usually does that 60 times per
// second on a 60 Hz monitor, but 144 on a 144 Hz one!
// ---------------------------------------------------------------------------
function animate() {
  // Schedule the NEXT call first, so the loop keeps going forever.
  requestAnimationFrame(animate);

  // Ask the timer to look at the clock now, so getDelta() is up to date.
  timer.update();

  // DELTA TIME = seconds since the previous frame.
  //   60 Hz screen  -> about 0.0167 s (1/60)
  //   144 Hz screen -> about 0.0069 s (1/144)
  // Always move things as `speed (units per second) * deltaSeconds`
  // (see step 0.3).
  const deltaSeconds = timer.getDelta();

  // --- WANDER: pick the point the fish feels like swimming to --------------
  // a) Nudge the wander point by a small random vector. Math.random() is
  //    0..1, so (Math.random() - 0.5) * 2 is a random number from -1 to +1,
  //    one per axis. The size of the nudge is wanderJitter (units/second)
  //    scaled by time.
  //    Why Math.sqrt(deltaSeconds) and not deltaSeconds? Random nudges
  //    cancel each other partly (like a drunk stumbling left and right), so
  //    after N steps you've drifted about sqrt(N) steps, not N. Scaling
  //    each nudge by sqrt(delta) makes the wandering look the same at 60 Hz
  //    and 144 Hz.
  const wanderNudge = wanderJitter * Math.sqrt(deltaSeconds);
  wanderOffset.x += (Math.random() - 0.5) * 2 * wanderNudge;
  wanderOffset.y += (Math.random() - 0.5) * 2 * wanderNudge;
  wanderOffset.z += (Math.random() - 0.5) * 2 * wanderNudge;

  // b) Push the point back onto the sphere's surface: keep its direction,
  //    but force its length to be exactly wanderRadius.
  wanderOffset.setLength(wanderRadius);

  // c) Where is the sphere? Its center is `wanderDistance` ahead of the fish
  //    along the direction the fish is currently moving
  //    (velocity normalized = a direction of length 1).
  wanderSphereCenter
    .copy(fishVelocity)
    .normalize()
    .multiplyScalar(wanderDistance)
    .add(fish.position);

  // d) The wander point in the world = sphere center + offset.
  wanderPoint.copy(wanderSphereCenter).add(wanderOffset);

  // (Debug visuals follow the numbers we just computed.)
  wanderSphereDebug.position.copy(wanderSphereCenter);
  wanderPointDebug.position.copy(wanderPoint);

  // --- STEER the fish toward the wander point (Reynolds' "seek") ----------
  // The seek from step 1.5, unchanged except the goal is now the wander
  // point instead of a chase target.
  // We do NOT point the fish at the goal and teleport its direction.
  // A real fish can't turn instantly; it needs time to change its heading.
  // So we keep the CURRENT velocity and only nudge it, using 3 ideas:
  //
  // 1. DESIRED velocity: "if I could, I'd go straight at the goal at full
  //    speed". Direction = (goal - me), normalized to length 1 (a pure
  //    direction), then multiplied by maxSpeed.
  desiredVelocity
    .subVectors(wanderPoint, fish.position)
    .normalize()
    .multiplyScalar(maxSpeed);

  // 2. STEERING = desired - current. It is the arrow that takes the current
  //    velocity arrow to the desired one: "what correction do I need?"
  //    If I'm already going the right way and speed, it is ~zero.
  //    If I'm swimming away from the target, it is big and points sideways
  //    or backwards, pulling the fish around in a curve.
  steeringForce.subVectors(desiredVelocity, fishVelocity);

  // 2b. STAY IN THE TANK (step 1.8): add the boundary push to the same sum.
  //     Steering forces are just arrows, so combining behaviors = adding
  //     arrows (the flock will add separation, alignment, ... the same way).
  //     Each axis is independent, so near a corner two or three axes push at
  //     once and the fish is nudged away from all the nearby walls.
  boundaryForce.set(
    getAxisBoundaryPush(fish.position.x, tankHalfSize.x),
    getAxisBoundaryPush(fish.position.y, tankHalfSize.y),
    getAxisBoundaryPush(fish.position.z, tankHalfSize.z),
  );
  steeringForce.addScaledVector(boundaryForce, boundaryWeight);

  // 3. LIMIT the steering to maxSteeringForce. Without this the fish would
  //    apply the whole correction at once and snap to the desired velocity,
  //    which is exactly the instant turn we wanted to avoid. clampLength(0, m)
  //    shortens the arrow if it is longer than m (keeping its direction).
  steeringForce.clampLength(0, maxSteeringForce);

  // Apply the steering as an acceleration: velocity += steering * time.
  // Same units trick as before: (change per second) * seconds.
  fishVelocity.addScaledVector(steeringForce, deltaSeconds);

  // Finally cap the speed so the fish can never exceed maxSpeed.
  fishVelocity.clampLength(0, maxSpeed);

  // MOVE the fish: new position = old position + velocity * time passed.
  // velocity is "units per second", deltaSeconds is "seconds", so
  // velocity * deltaSeconds is "units to move in THIS frame". E.g. at
  // 2.5 units/s and a 60 Hz frame (0.0167 s) the fish moves ~0.04 units.
  // addScaledVector(v, s) does exactly `position += v * s` in one call,
  // without creating a temporary vector.
  fish.position.addScaledVector(fishVelocity, deltaSeconds);

  // POINT the fish along its velocity. Our convention is that the nose is
  // local +Z (see fish.js). The point one velocity-arrow ahead of the fish
  // is exactly "where it is going": position + velocity.
  fishLookTarget.copy(fish.position).add(fishVelocity);

  if (useSmoothTurning) {
    // SMOOTH version (step 1.6): work out the rotation we WANT, then move the
    // fish's current rotation only PART of the way there each frame.
    //
    // a) Build the target rotation without touching the fish yet.
    //    Matrix4.lookAt(eye, target, up) builds a rotation matrix (a 3x3
    //    grid of numbers describing a rotation, here inside a 4x4 matrix)
    //    whose Z axis points from `target` to `eye`. Object3D.lookAt uses it
    //    with the two swapped, so we do the same: this makes the +Z axis
    //    (the nose) point from the fish towards the look-ahead point.
    //    `up` = (0, 1, 0) tells it which way is "up" so the fish keeps its
    //    back on top and does not roll onto its side.
    lookMatrix.lookAt(fishLookTarget, fish.position, worldUp);
    //    Convert that matrix into a quaternion (see the QUATERNIONS notes
    //    near the top of this block's setup, "SMOOTH ORIENTATION").
    targetQuaternion.setFromRotationMatrix(lookMatrix);

    // b) slerp = "spherical linear interpolation": the quaternion version of
    //    lerp (linear interpolation, "a bit of the way from A to B").
    //    slerp(target, t) moves the current rotation a fraction t of the way
    //    to `target` along the shortest turn. t = 0 means don't move,
    //    t = 1 means jump all the way (which is what plain lookAt does).
    //
    //    t must depend on delta time, or turning speed would depend on the
    //    frame rate. 1 - exp(-rate * delta) is the standard fix: each
    //    second the remaining angle shrinks by the same proportion, no
    //    matter how many frames that second is cut into. (This exact trick
    //    returns in step 5.5 for smoothing the moods.)
    const turnBlend = 1 - Math.exp(-turnRate * deltaSeconds);
    fish.quaternion.slerp(targetQuaternion, turnBlend);
  } else {
    // ABRUPT version (what we had in steps 1.4 and 1.5): jump straight to
    // facing the look-ahead point. Press L in the browser to switch.
    fish.lookAt(fishLookTarget);
  }

  // Let OrbitControls apply the damping glide and move the camera.
  // Must happen before render so this frame uses the new camera position.
  controls.update();

  // Take the picture: draw `scene` as seen by `camera`.
  renderer.render(scene, camera);

  // Update the readout twice a second (updating text every frame would
  // itself cost time and be unreadable). FPS = frames / seconds elapsed.
  framesSinceStatsUpdate += 1;
  secondsSinceStatsUpdate += deltaSeconds;
  if (secondsSinceStatsUpdate >= 0.5) {
    const fps = framesSinceStatsUpdate / secondsSinceStatsUpdate;
    statsBox.textContent =
      `FPS:        ${fps.toFixed(0)}\n` +
      `draw calls: ${renderer.info.render.calls}\n` +
      `triangles:  ${renderer.info.render.triangles}`;
    framesSinceStatsUpdate = 0;
    secondsSinceStatsUpdate = 0;
  }
}

animate();
