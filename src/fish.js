// fish.js - builds the fish out of simple Three.js shapes.
//
// UNITS: 1 world unit is about half a fish body length, so our fish is
// roughly 2 units long. (The tank is 40 x 20 x 30 units, so that is a
// believable size for a fish in it.)

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

  return fish;
}
