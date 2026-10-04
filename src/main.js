// Entry point: sets up the three things every 3D scene needs
// (scene, camera, renderer) and runs the render loop.

import * as THREE from 'three';

// ---------------------------------------------------------------------------
// 1. SCENE - the "stage". An empty container that holds everything we want
//    to see: meshes, lights, and later fish. Nothing is drawn unless it is
//    added to the scene.
// ---------------------------------------------------------------------------
const scene = new THREE.Scene();

// ---------------------------------------------------------------------------
// 2. CAMERA - the "eye". PerspectiveCamera behaves like a real camera or your
//    eye: things farther away look smaller.
//
//    Arguments:
//      fov    (50)  - vertical field of view in degrees. Bigger = wider lens.
//      aspect       - width / height of the canvas. If this is wrong the
//                     picture looks stretched (we fix resizing in step 0.4).
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
// The cube is also at (0, 0, 0), so we back the camera up along +Z
// (towards us) to avoid sitting inside the cube.
camera.position.z = 5;

// ---------------------------------------------------------------------------
// 3. RENDERER - the "photographer". It takes the scene + camera and paints
//    the picture onto a <canvas> using WebGL (the browser's GPU API).
//    `antialias: true` smooths jagged edges.
// ---------------------------------------------------------------------------
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
// The renderer created its own <canvas> element; we put it in the page.
document.querySelector('#app').appendChild(renderer.domElement);

// ---------------------------------------------------------------------------
// A MESH = geometry + material.
//   Geometry: the SHAPE (a list of points/triangles). BoxGeometry(1, 1, 1)
//             is a cube 1 unit wide, tall and deep.
//   Material: the SURFACE LOOK (color, shininess...). MeshStandardMaterial
//             reacts to lights, so it needs a light to be visible.
//   Mesh:     glues the two together so the renderer can draw it.
// ---------------------------------------------------------------------------
const cubeGeometry = new THREE.BoxGeometry(1, 1, 1);
const cubeMaterial = new THREE.MeshStandardMaterial({ color: 0x44aaff });
const cube = new THREE.Mesh(cubeGeometry, cubeMaterial);
scene.add(cube);

// ---------------------------------------------------------------------------
// LIGHT - without one, a MeshStandardMaterial renders pure black.
// A DirectionalLight is like the sun: parallel rays from one direction.
// Its position only sets the direction the light comes from (towards the
// origin by default). Here: from the upper-right, in front.
// ---------------------------------------------------------------------------
const sunLight = new THREE.DirectionalLight(0xffffff, 3);
sunLight.position.set(3, 4, 5);
scene.add(sunLight);

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

// Spin speed in RADIANS PER SECOND (a full turn = 2 * PI ~ 6.28 radians).
// 0.6 rad/s is what 0.01 rad/frame gave us on a 60 Hz screen (0.01 * 60).
// Notice the unit is "per second", not "per frame". That is the whole point.
const spinSpeed = 0.6;

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
  const deltaSeconds = timer.getDelta();

  // Movement = speed (units per second) * time passed (seconds).
  // Same idea as distance = speed * time from school physics.
  //
  // Why not the old `rotation += 0.01` per frame? That ties speed to the
  // number of frames. On a 144 Hz monitor there are 2.4x more frames each
  // second, so the cube would spin 2.4x faster (and slower on a laggy
  // machine). With delta time, a faster screen just takes smaller steps
  // more often, and the cube covers the same angle per real second.
  cube.rotation.x += spinSpeed * deltaSeconds;
  cube.rotation.y += spinSpeed * deltaSeconds;

  // Take the picture: draw `scene` as seen by `camera`.
  renderer.render(scene, camera);
}

animate();
