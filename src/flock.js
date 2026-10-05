// flock.js — per-fish state in typed arrays + wander/bounds (steps 3.2–3.3).
//
// Layout: fish i lives at index i in each array.
//   positions[i*3 + 0|1|2]     = x, y, z
//   velocities[i*3 + 0|1|2]    = vx, vy, vz  (units per second)
//   orientations[i*4 + 0|1|2|3] = quaternion (x, y, z, w) for smooth turning
//   wanderOffsets[i*3 + ...]   = point on wander sphere (length = wanderRadius)
//
// Why typed arrays instead of 300 { position, velocity } objects?
// One contiguous block of memory, no GC from allocating objects each frame,
// and the same data layout we'll use when we add boids in phase 4.

import * as THREE from 'three';
import { createFishInstancedMesh, fishWaveSettings } from './fish.js';

const boundaryMargin = 5;
const boundaryWeight = 30;
const wanderDistance = 4;
const wanderRadius = 2;
const wanderJitter = 6;
const turnRate = 5;

// Step 4.6 presets (hand-tuned; Phase 5 moods will target these):
//   idle:        wander 1.2, sep 1.2, align 0.6, coh 0.5, maxSpeed 2.2, perception 7
//   tightSchool: wander 0.4, sep 1.0, align 1.4, coh 1.6, maxSpeed 2.5, perception 10
//   scatter:     wander 1.5, sep 2.5, align 0.2, coh 0.1, maxSpeed 3.2, perception 6
export const flockPresets = {
  idle: {
    wanderWeight: 1.2,
    separationWeight: 1.2,
    alignmentWeight: 0.6,
    cohesionWeight: 0.5,
    maxSpeed: 2.2,
    perceptionRadius: 7,
  },
  tightSchool: {
    wanderWeight: 0.4,
    separationWeight: 1.0,
    alignmentWeight: 1.4,
    cohesionWeight: 1.6,
    maxSpeed: 2.5,
    perceptionRadius: 10,
  },
  scatter: {
    wanderWeight: 1.5,
    separationWeight: 2.5,
    alignmentWeight: 0.2,
    cohesionWeight: 0.1,
    maxSpeed: 3.2,
    perceptionRadius: 6,
  },
};

export function applyFlockPreset(preset) {
  Object.assign(flockSettings, preset);
}

// Step 4.5: speed floor + ceiling and gentler boid weights to reduce jitter/stalls.
export const flockSettings = {
  minSpeed: 0.9,
  maxSpeed: 2.8,
  maxSteeringForce: 4.5,
  separationWeight: 1.6,
  alignmentWeight: 0.85,
  cohesionWeight: 0.75,
  wanderWeight: 1.0,
  perceptionRadius: 8,
  fleeWeight: 0, // step 5.3 mapping; step 5.4 applies flee steering from this
};

function getPerceptionRadiusSq() {
  const r = flockSettings.perceptionRadius;
  return r * r;
}

// Scratch objects — one set for the whole flock loop (no per-fish allocation).
const position = new THREE.Vector3();
const velocity = new THREE.Vector3();
const fishQuaternion = new THREE.Quaternion();
const desiredVelocity = new THREE.Vector3();
const steeringForce = new THREE.Vector3();
const boundaryForce = new THREE.Vector3();
const separationSum = new THREE.Vector3();
const separationDelta = new THREE.Vector3();
const boidSteering = new THREE.Vector3();
const alignmentAverage = new THREE.Vector3();
const cohesionCenter = new THREE.Vector3();
const fleeAway = new THREE.Vector3();
const wanderOffset = new THREE.Vector3();
const wanderSphereCenter = new THREE.Vector3();
const wanderPoint = new THREE.Vector3();
const lookTarget = new THREE.Vector3();
const lookMatrix = new THREE.Matrix4();
const targetQuaternion = new THREE.Quaternion();
const worldUp = new THREE.Vector3(0, 1, 0);
const instancePlacement = new THREE.Object3D();
const fishColorScratch = new THREE.Color();

/** Orange–gold palette (HSL); instanceColor tints the mesh vertex colors. */
function randomFishColor() {
  const hue = 0.04 + Math.random() * 0.1;
  const sat = 0.65 + Math.random() * 0.25;
  const light = 0.42 + Math.random() * 0.18;
  return fishColorScratch.setHSL(hue, sat, light).clone();
}

function getAxisBoundaryPush(coordinate, halfExtent) {
  const distanceIntoZone = Math.abs(coordinate) - (halfExtent - boundaryMargin);
  if (distanceIntoZone <= 0) {
    return 0;
  }
  const strength = Math.min(distanceIntoZone / boundaryMargin, 1);
  return -Math.sign(coordinate) * strength;
}

function randomInTank(positions, index, tankSize) {
  positions[index * 3 + 0] = (Math.random() - 0.5) * tankSize.x;
  positions[index * 3 + 1] = (Math.random() - 0.5) * tankSize.y;
  positions[index * 3 + 2] = (Math.random() - 0.5) * tankSize.z;
}

function randomUnitVelocity(velocities, index) {
  // Random direction on the sphere, then scale to a random speed up to maxSpeed.
  const theta = Math.random() * Math.PI * 2;
  const phi = Math.acos(2 * Math.random() - 1);
  const speed = flockSettings.maxSpeed * (0.4 + Math.random() * 0.6);
  velocities[index * 3 + 0] = Math.sin(phi) * Math.cos(theta) * speed;
  velocities[index * 3 + 1] = Math.sin(phi) * Math.sin(theta) * speed;
  velocities[index * 3 + 2] = Math.cos(phi) * speed;
}

function randomWanderOffset(wanderOffsets, index) {
  wanderOffset.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5);
  wanderOffset.normalize().multiplyScalar(wanderRadius);
  wanderOffsets[index * 3 + 0] = wanderOffset.x;
  wanderOffsets[index * 3 + 1] = wanderOffset.y;
  wanderOffsets[index * 3 + 2] = wanderOffset.z;
}

function orientationFromVelocity(orientations, index, vx, vy, vz, px, py, pz) {
  if (vx * vx + vy * vy + vz * vz < 1e-8) {
    return;
  }
  lookTarget.set(px + vx, py + vy, pz + vz);
  position.set(px, py, pz);
  lookMatrix.lookAt(lookTarget, position, worldUp);
  targetQuaternion.setFromRotationMatrix(lookMatrix);
  targetQuaternion.toArray(orientations, index * 4);
}

/**
 * Brute-force neighbor search for one fish: O(n). Returns how many indices were
 * written to `outNeighborIndices` (fish itself is never included).
 */
export function findNeighbors(fishIndex, positions, count, outNeighborIndices) {
  const pi = fishIndex * 3;
  const ax = positions[pi];
  const ay = positions[pi + 1];
  const az = positions[pi + 2];
  let neighborCount = 0;

  for (let j = 0; j < count; j++) {
    if (j === fishIndex) {
      continue;
    }
    const pj = j * 3;
    const dx = positions[pj] - ax;
    const dy = positions[pj + 1] - ay;
    const dz = positions[pj + 2] - az;
    const distanceSq = dx * dx + dy * dy + dz * dz;
    if (distanceSq < getPerceptionRadiusSq()) {
      outNeighborIndices[neighborCount] = j;
      neighborCount += 1;
    }
  }
  return neighborCount;
}

/**
 * Sum of unit vectors away from each neighbor, each weighted by 1 / distance²
 * (inverse-square repulsion). Averaged so crowd size does not explode the force.
 */
function accumulateSeparation(px, py, pz, positions, neighborIndices, neighborCount, outSum) {
  outSum.set(0, 0, 0);
  for (let n = 0; n < neighborCount; n++) {
    const j = neighborIndices[n];
    const pj = j * 3;
    separationDelta.set(px - positions[pj], py - positions[pj + 1], pz - positions[pj + 2]);
    const distanceSq = separationDelta.lengthSq();
    if (distanceSq < 1e-6) {
      continue;
    }
    separationDelta.divideScalar(distanceSq);
    outSum.add(separationDelta);
  }
  if (neighborCount > 0) {
    outSum.divideScalar(neighborCount);
  }
}

/** Average velocity of neighbors (alignment target direction). */
function accumulateAlignmentAverage(velocities, neighborIndices, neighborCount, outAverage) {
  outAverage.set(0, 0, 0);
  for (let n = 0; n < neighborCount; n++) {
    const j = neighborIndices[n];
    const pj = j * 3;
    outAverage.x += velocities[pj];
    outAverage.y += velocities[pj + 1];
    outAverage.z += velocities[pj + 2];
  }
  if (neighborCount > 0) {
    outAverage.divideScalar(neighborCount);
  }
}

/** Average position of neighbors (cohesion target point). */
function accumulateCohesionCenter(positions, neighborIndices, neighborCount, outCenter) {
  outCenter.set(0, 0, 0);
  for (let n = 0; n < neighborCount; n++) {
    const j = neighborIndices[n];
    const pj = j * 3;
    outCenter.x += positions[pj];
    outCenter.y += positions[pj + 1];
    outCenter.z += positions[pj + 2];
  }
  if (neighborCount > 0) {
    outCenter.divideScalar(neighborCount);
  }
}

/** Reynolds steering: accelerate toward `desiredVelocity` from current `velocity`. */
function addSteerTowardDesired(desired, weight) {
  boidSteering.subVectors(desired, velocity);
  steeringForce.addScaledVector(boidSteering, weight);
}

/** Fish must keep swimming; if forces cancel out, nudge back to minSpeed. */
function enforceSpeedLimits() {
  const minSpeed = flockSettings.minSpeed;
  const maxSpeed = flockSettings.maxSpeed;
  const speedSq = velocity.lengthSq();
  if (speedSq < minSpeed * minSpeed) {
    if (speedSq < 1e-8) {
      velocity.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize();
    }
    velocity.multiplyScalar(minSpeed / Math.sqrt(speedSq || 1));
  }
  velocity.clampLength(minSpeed, maxSpeed);
}

function setInstanceColorFromBase(mesh, index, baseColors) {
  const ci = index * 3;
  fishColorScratch.setRGB(baseColors[ci], baseColors[ci + 1], baseColors[ci + 2]);
  mesh.setColorAt(index, fishColorScratch);
}

function applyNeighborDebugColors(mesh, baseColors, watchIndex, neighborIndices, neighborCount) {
  for (let i = 0; i < mesh.count; i++) {
    setInstanceColorFromBase(mesh, i, baseColors);
  }
  mesh.setColorAt(watchIndex, fishColorScratch.setHex(0xff66ff));
  fishColorScratch.setHex(0x66ffcc);
  for (let n = 0; n < neighborCount; n++) {
    mesh.setColorAt(neighborIndices[n], fishColorScratch);
  }
  mesh.instanceColor.needsUpdate = true;
}

function writeInstanceMatrix(mesh, index, px, py, pz, orientations, scale) {
  fishQuaternion.fromArray(orientations, index * 4);
  instancePlacement.position.set(px, py, pz);
  instancePlacement.quaternion.copy(fishQuaternion);
  instancePlacement.scale.setScalar(scale);
  instancePlacement.updateMatrix();
  mesh.setMatrixAt(index, instancePlacement.matrix);
}

/**
 * @param {number} count
 * @param {THREE.Vector3} tankSize — full width, height, depth
 */
export function createFlock(count, tankSize) {
  const tankHalfSize = tankSize.clone().multiplyScalar(0.5);
  const mesh = createFishInstancedMesh(count);

  const positions = new Float32Array(count * 3);
  const velocities = new Float32Array(count * 3);
  const orientations = new Float32Array(count * 4);
  const wanderOffsets = new Float32Array(count * 3);
  const scales = new Float32Array(count);
  const baseColors = new Float32Array(count * 3);
  const neighborScratch = new Int32Array(count);
  const swimPhases = mesh.userData.swimPhases;
  const wiggleMul = mesh.userData.wiggleMul;
  const phaseAttribute = mesh.userData.phaseAttribute;
  const wiggleAttribute = mesh.userData.wiggleAttribute;

  for (let i = 0; i < count; i++) {
    randomInTank(positions, i, tankSize);
    randomUnitVelocity(velocities, i);
    randomWanderOffset(wanderOffsets, i);
    scales[i] = 0.7 + Math.random() * 0.6;
    const color = randomFishColor();
    mesh.setColorAt(i, color);
    baseColors[i * 3] = color.r;
    baseColors[i * 3 + 1] = color.g;
    baseColors[i * 3 + 2] = color.b;
    orientationFromVelocity(
      orientations,
      i,
      velocities[i * 3],
      velocities[i * 3 + 1],
      velocities[i * 3 + 2],
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
    );
    writeInstanceMatrix(
      mesh,
      i,
      positions[i * 3],
      positions[i * 3 + 1],
      positions[i * 3 + 2],
      orientations,
      scales[i],
    );
  }
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }

  // TEMPORARY debug (step 4.1): wire sphere = perception radius around watched fish.
  const perceptionSphereDebug = new THREE.Mesh(
    new THREE.SphereGeometry(1, 24, 16),
    new THREE.MeshBasicMaterial({
      color: 0x66ccff,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    }),
  );

  let watchFishIndex = 0;

  // Step 5.4: invisible "predator" wanders near the tank center so scatter is not
  // a perfect radial burst from (0,0,0). Fish steer away when fleeWeight > 0.
  const threatPoint = new THREE.Vector3(
    (Math.random() - 0.5) * 4,
    (Math.random() - 0.5) * 2,
    (Math.random() - 0.5) * 3,
  );
  const threatJitterRadius = 9;
  const threatDriftSpeed = 4.5;

  function jitterThreatPoint(deltaSeconds) {
    const step = threatDriftSpeed * deltaSeconds;
    threatPoint.x += (Math.random() - 0.5) * 2 * step;
    threatPoint.y += (Math.random() - 0.5) * 2 * step;
    threatPoint.z += (Math.random() - 0.5) * 2 * step;
    const distSq = threatPoint.lengthSq();
    const maxDistSq = threatJitterRadius * threatJitterRadius;
    if (distSq > maxDistSq) {
      threatPoint.multiplyScalar(threatJitterRadius / Math.sqrt(distSq));
    }
  }

  function cycleWatchFish() {
    watchFishIndex = (watchFishIndex + 1) % count;
  }

  function update(deltaSeconds) {
    const wanderNudge = wanderJitter * Math.sqrt(deltaSeconds);
    const turnBlend = 1 - Math.exp(-turnRate * deltaSeconds);

    jitterThreatPoint(deltaSeconds);

    for (let i = 0; i < count; i++) {
      const pi = i * 3;
      const px = positions[pi];
      const py = positions[pi + 1];
      const pz = positions[pi + 2];

      velocity.set(velocities[pi], velocities[pi + 1], velocities[pi + 2]);

      // Wander: nudge this fish's offset on the sphere, renormalize to wanderRadius.
      wanderOffset.set(
        wanderOffsets[pi] + (Math.random() - 0.5) * 2 * wanderNudge,
        wanderOffsets[pi + 1] + (Math.random() - 0.5) * 2 * wanderNudge,
        wanderOffsets[pi + 2] + (Math.random() - 0.5) * 2 * wanderNudge,
      );
      wanderOffset.setLength(wanderRadius);
      wanderOffsets[pi] = wanderOffset.x;
      wanderOffsets[pi + 1] = wanderOffset.y;
      wanderOffsets[pi + 2] = wanderOffset.z;

      if (velocity.lengthSq() > 1e-8) {
        wanderSphereCenter.copy(velocity).normalize().multiplyScalar(wanderDistance);
      } else {
        wanderSphereCenter.set(wanderDistance, 0, 0);
      }
      wanderSphereCenter.x += px;
      wanderSphereCenter.y += py;
      wanderSphereCenter.z += pz;

      wanderPoint.copy(wanderSphereCenter).add(wanderOffset);

      const maxSpeed = flockSettings.maxSpeed;
      desiredVelocity.subVectors(wanderPoint, position.set(px, py, pz)).normalize().multiplyScalar(maxSpeed);
      steeringForce.subVectors(desiredVelocity, velocity).multiplyScalar(flockSettings.wanderWeight);

      const neighborCount = findNeighbors(i, positions, count, neighborScratch);
      accumulateSeparation(px, py, pz, positions, neighborScratch, neighborCount, separationSum);
      if (separationSum.lengthSq() > 1e-8) {
        desiredVelocity.copy(separationSum).normalize().multiplyScalar(maxSpeed);
        addSteerTowardDesired(desiredVelocity, flockSettings.separationWeight);
      }

      if (neighborCount > 0) {
        accumulateAlignmentAverage(velocities, neighborScratch, neighborCount, alignmentAverage);
        if (alignmentAverage.lengthSq() > 1e-8) {
          desiredVelocity.copy(alignmentAverage).normalize().multiplyScalar(maxSpeed);
          addSteerTowardDesired(desiredVelocity, flockSettings.alignmentWeight);
        }

        accumulateCohesionCenter(positions, neighborScratch, neighborCount, cohesionCenter);
        desiredVelocity.subVectors(cohesionCenter, position.set(px, py, pz));
        if (desiredVelocity.lengthSq() > 1e-8) {
          desiredVelocity.normalize().multiplyScalar(maxSpeed);
          addSteerTowardDesired(desiredVelocity, flockSettings.cohesionWeight);
        }
      }

      const fleeWeight = flockSettings.fleeWeight;
      if (fleeWeight > 0.001) {
        fleeAway.set(px, py, pz).sub(threatPoint);
        if (fleeAway.lengthSq() > 1e-8) {
          desiredVelocity.copy(fleeAway).normalize().multiplyScalar(maxSpeed);
          addSteerTowardDesired(desiredVelocity, fleeWeight);
        }
      }

      boundaryForce.set(
        getAxisBoundaryPush(px, tankHalfSize.x),
        getAxisBoundaryPush(py, tankHalfSize.y),
        getAxisBoundaryPush(pz, tankHalfSize.z),
      );
      steeringForce.addScaledVector(boundaryForce, boundaryWeight);
      steeringForce.clampLength(0, flockSettings.maxSteeringForce);

      velocity.addScaledVector(steeringForce, deltaSeconds);
      enforceSpeedLimits();
      velocities[pi] = velocity.x;
      velocities[pi + 1] = velocity.y;
      velocities[pi + 2] = velocity.z;

      const speed = velocity.length();
      const speedRatio = speed / flockSettings.maxSpeed;
      // Faster fish advance swim phase faster; amplitude scales with speed too.
      swimPhases[i] +=
        fishWaveSettings.speed *
        fishWaveSettings.moodSpeedMul *
        (0.35 + 0.65 * speedRatio) *
        deltaSeconds;
      wiggleMul[i] = 0.45 + 0.55 * speedRatio;

      position.set(px, py, pz).addScaledVector(velocity, deltaSeconds);
      positions[pi] = position.x;
      positions[pi + 1] = position.y;
      positions[pi + 2] = position.z;

      lookTarget.copy(position).add(velocity);
      lookMatrix.lookAt(lookTarget, position, worldUp);
      targetQuaternion.setFromRotationMatrix(lookMatrix);

      fishQuaternion.fromArray(orientations, i * 4);
      fishQuaternion.slerp(targetQuaternion, turnBlend);
      fishQuaternion.toArray(orientations, i * 4);

      writeInstanceMatrix(mesh, i, position.x, position.y, position.z, orientations, scales[i]);
    }

    mesh.instanceMatrix.needsUpdate = true;
    phaseAttribute.needsUpdate = true;
    wiggleAttribute.needsUpdate = true;

    const neighborCount = findNeighbors(watchFishIndex, positions, count, neighborScratch);
    applyNeighborDebugColors(mesh, baseColors, watchFishIndex, neighborScratch, neighborCount);

    const wi = watchFishIndex * 3;
    perceptionSphereDebug.position.set(positions[wi], positions[wi + 1], positions[wi + 2]);
    const pr = flockSettings.perceptionRadius;
    perceptionSphereDebug.scale.set(pr, pr, pr);
  }

  return {
    mesh,
    perceptionSphereDebug,
    positions,
    velocities,
    orientations,
    wanderOffsets,
    scales,
    swimPhases,
    watchFishIndex: () => watchFishIndex,
    neighborCount: () =>
      findNeighbors(watchFishIndex, positions, count, neighborScratch),
    cycleWatchFish,
    update,
  };
}
