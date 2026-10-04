// fish.js - builds the fish out of simple Three.js shapes.
//
// UNITS: 1 world unit is about half a fish body length, so our fish is
// roughly 2 units long. (The tank is 40 x 20 x 30 units, so that is a
// believable size for a fish in it.)
//
// ===========================================================================
// FORWARD DIRECTION CONVENTION  (decided in step 1.3 - never change this!)
//
//   In the fish's LOCAL space:
//     +Z = FORWARD (the nose points this way, the tail trails towards -Z)
//     +Y = UP      (the back of the fish; the belly is -Y)
//     +X = the fish's LEFT side (-X is its right side)
//
//   Why is +X the fish's left? Standing at +Z and looking at the origin,
//   +X is on YOUR right. A fish facing +Z is facing TOWARDS you, so its
//   left is on your right. (Face a friend: your right hand is on their
//   left.) The fish is symmetric, so this rarely matters, but it explains
//   what you will see in the axes helper.
//
//   Why +Z? Because Object3D.lookAt(target) rotates an object so that its
//   local +Z axis points at the target (for non-camera objects). With +Z as
//   the nose, `fish.lookAt(somewhere)` makes the fish face `somewhere`
//   with no extra rotation maths. Velocity-based steering (steps 1.4-1.6)
//   and the instanced flock (phase 3) all depend on this one decision.
//
//   The geometry below already follows it: the eyes are at z = +0.6 (near
//   the nose) and the tail joint is at z = -0.9 (the back end).
// ===========================================================================

import * as THREE from 'three';

/**
 * Creates one fish and returns it as a THREE.Group.
 *
 * A Group is an invisible "folder" in 3D space. It has its own position,
 * rotation and scale, and everything inside it (the body now, tail and eyes
 * in step 1.2) moves, turns and scales together with it. To move the whole
 * fish later we move the Group, never the individual parts.
 */
export function createFish() {
  const fish = new THREE.Group();

  // ---- Body ---------------------------------------------------------------
  // GEOMETRY: SphereGeometry(radius, widthSegments, heightSegments).
  // The two segment numbers say how many triangles the sphere is built from
  // around and from top to bottom. More = rounder but more work for the GPU.
  // 32 x 16 is smooth enough for a body this small.
  const bodyGeometry = new THREE.SphereGeometry(1, 32, 16);

  // MATERIAL: orange so it stands out against the blue-green water.
  const bodyMaterial = new THREE.MeshStandardMaterial({ color: 0xff8c42 });

  const body = new THREE.Mesh(bodyGeometry, bodyMaterial);

  // SCALE turns the round ball into an ellipsoid (an egg / rugby-ball shape).
  // Scale multiplies each axis of the mesh independently:
  //   x = 0.35 -> narrow (fish are flat from side to side)
  //   y = 0.5  -> a bit taller than it is wide
  //   z = 1.0  -> the long axis. The sphere has radius 1, so the body is
  //               2 units long, from z = -1 (tail end) to z = +1 (nose).
  // We decided the long axis is Z because the fish's "forward" will be +Z
  // (made official in step 1.3).
  body.scale.set(0.35, 0.5, 1.0);

  // LOCAL vs WORLD SPACE:
  // body.position is measured in the fish Group's LOCAL space: (0, 0, 0)
  // means "the center of the fish", wherever the fish happens to be in the
  // world. The Group's own position is in WORLD space (the scene's
  // coordinates). Think of an address: "second room on the left" (local)
  // only becomes a real-world location once you know which building (the
  // Group) it is in.
  fish.add(body);

  // ---- Tail ---------------------------------------------------------------
  // PIVOT POINT: an object rotates around its own origin (0, 0, 0). A door
  // swings around its hinge, not around its middle. For a tail to wag, the
  // "hinge" must be where the tail joins the body. A mesh's origin sits at
  // the center of its geometry, so if we rotated the tail mesh directly it
  // would spin around its own middle and look wrong.
  //
  // The trick: put the tail mesh INSIDE an empty Group (the "pivot"), and
  // offset the mesh within it so that its joint end sits exactly at the
  // pivot's origin. Then rotating the PIVOT swings the tail around the joint.
  // (Step 2.1 will do exactly that with a sine wave.)
  const tailPivot = new THREE.Group();
  tailPivot.name = 'tailPivot'; // a label so later code can find it
  // The body's back end is at z = -1. We put the joint just inside it
  // (z = -0.9) so there is no visible gap between the body and the tail.
  tailPivot.position.set(0, 0, -0.9);
  fish.add(tailPivot);

  // A cone is the simplest triangle-like fin shape. ConeGeometry(radius,
  // height, radialSegments) is a cone standing upright: tip at +Y, round
  // base at -Y, centered on its own middle.
  const tailLength = 0.8; // how far the fin sticks out behind the joint
  const tailRadius = 0.5; // half the height of the fin
  const tailGeometry = new THREE.ConeGeometry(tailRadius, tailLength, 16);
  const tailMaterial = new THREE.MeshStandardMaterial({ color: 0xe0661f });
  const tailMesh = new THREE.Mesh(tailGeometry, tailMaterial);

  // We want: tip touching the joint, wide base at the very back (-Z).
  // The cone's tip points along +Y, so we tilt it 90 degrees around X
  // (Math.PI / 2 radians = 90 degrees). A rotation of +90 degrees around X
  // turns the +Y direction into +Z, so the tip now points forward, towards
  // the body, and the base faces backwards.
  tailMesh.rotation.x = Math.PI / 2;

  // FLATTEN: a fish tail is a thin vertical blade, not a round cone.
  // Scale is applied BEFORE the rotation above, in the cone's own axes
  // (cone x = across, y = length, z = depth). After the 90-degree tilt, the
  // cone's x axis stays world X, and its z axis becomes world -Y. So:
  //   x = 0.1 -> only 10% as wide: thin from side to side
  //   z = 1.0 -> keeps the full height of the fin (up and down)
  tailMesh.scale.set(0.1, 1.0, 1.0);

  // The cone is centered on its own middle, so shift it half its length
  // backwards: now its tip is exactly at the pivot's origin (the joint) and
  // the fin extends from there towards -Z.
  tailMesh.position.z = -tailLength / 2;
  tailPivot.add(tailMesh);

  // ---- Eyes ---------------------------------------------------------------
  // Two small dark spheres, one on each side of the head, mirrored in X.
  const eyeGeometry = new THREE.SphereGeometry(0.08, 12, 8);
  const eyeMaterial = new THREE.MeshStandardMaterial({ color: 0x111111 });

  // Where? Near the nose (z = 0.6), a little above the middle (y = 0.1).
  // The body surface there is about 0.27 units out from the center on X, so
  // x = 0.25 puts the eye center just inside the skin: half the ball sticks
  // out and reads as an eye.
  const eyeX = 0.25;
  const eyeY = 0.1;
  const eyeZ = 0.6;

  const rightEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  rightEye.position.set(eyeX, eyeY, eyeZ);
  fish.add(rightEye);

  // Mirror image: same numbers, but flip the sign of X. We reuse the same
  // geometry and material objects; only the position differs.
  const leftEye = new THREE.Mesh(eyeGeometry, eyeMaterial);
  leftEye.position.set(-eyeX, eyeY, eyeZ);
  fish.add(leftEye);

  return fish;
}
