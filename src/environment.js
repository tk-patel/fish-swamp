// environment.js — step 7.2: the pond floor, rocks and swaying plants.
//
// Everything here is STATIC scenery except the plants, which sway. The sway
// uses the exact trick from step 2.5 (fish wiggle): a sine wave added to the
// vertex positions inside the vertex shader, so the GPU does the animating.
//
// Layout reminder (see pond.js): y = 0 is the water surface and
// y = -pondWaterDepth is the floor.

import * as THREE from 'three';
import { addCausticsToMaterial, causticUniforms } from './caustics.js';
import { pondLength, pondWaterDepth, pondWidth } from './pond.js';

// ---------------------------------------------------------------------------
// Seeded random numbers.
// Math.random() gives a DIFFERENT pond on every reload. For scenery we want
// the same layout every time (easier to tune), so we use a tiny "seeded"
// generator (mulberry32): same seed in, same sequence of numbers out.
// ---------------------------------------------------------------------------
function createSeededRandom(seed) {
  let state = seed >>> 0;
  return function nextRandom01() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------------
// FLOOR
// A big flat grid whose vertices are pushed up/down by a few overlapping sine
// waves, giving gentle sand dunes. Plants and rocks ask `floorHeightAt` so
// they sit ON the floor instead of floating or sinking.
// ---------------------------------------------------------------------------
const floorY = -pondWaterDepth;

/** Height (world y) of the sand at horizontal position (x, z). */
export function floorHeightAt(x, z) {
  // Three sine waves with different sizes: big slow hills + smaller ripples.
  // Adding waves of different frequencies looks natural, one wave looks fake.
  const bigHills = Math.sin(x * 0.11 + 1.3) * Math.cos(z * 0.13) * 0.45;
  const mediumDunes = Math.sin(x * 0.27 + z * 0.21) * 0.2;
  const smallRipples = Math.sin(x * 0.6 - z * 0.5 + 2.0) * 0.06;
  return floorY + bigHills + mediumDunes + smallRipples;
}

function createFloor() {
  const floorSize = 220; // much bigger than the pond; fog hides the far edge
  const cells = 150;
  const geometry = new THREE.PlaneGeometry(floorSize, floorSize, cells, cells);
  // PlaneGeometry stands upright (in the XY plane). Rotate it to lie flat.
  geometry.rotateX(-Math.PI / 2);

  const positions = geometry.attributes.position;
  const colors = new Float32Array(positions.count * 3);
  const sandLight = new THREE.Color(0xd8c08a);
  const sandDark = new THREE.Color(0x8c7a52);
  const mossGreen = new THREE.Color(0x5f7a4a);
  const vertexColor = new THREE.Color();

  for (let i = 0; i < positions.count; i++) {
    const x = positions.getX(i);
    const z = positions.getZ(i);
    const height = floorHeightAt(x, z);
    positions.setY(i, height);

    // Color by height: dune tops are pale sand, hollows are darker silt.
    // Then a slow patchy sine mixes in some moss-green here and there.
    const heightMix = THREE.MathUtils.clamp((height - floorY + 0.5) / 1.0, 0, 1);
    vertexColor.copy(sandDark).lerp(sandLight, heightMix);
    const mossAmount = Math.max(0, Math.sin(x * 0.19 + 4.0) * Math.sin(z * 0.23 + 1.0)) * 0.55;
    vertexColor.lerp(mossGreen, mossAmount);
    colors[i * 3 + 0] = vertexColor.r;
    colors[i * 3 + 1] = vertexColor.g;
    colors[i * 3 + 2] = vertexColor.b;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  // We moved the vertices, so the old normals (which face straight up) are wrong.
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1 });
  addCausticsToMaterial(material); // step 7.3: dancing sunlight on the sand
  return new THREE.Mesh(geometry, material);
}

// ---------------------------------------------------------------------------
// ROCKS
// Start from a sphere-like icosahedron (20 triangles x subdivisions), then
// push every vertex in or out a bit with a "noise" made of sines. Flat
// shading (each triangle one solid shade) gives the chunky low-poly look.
// ---------------------------------------------------------------------------
function createRockGeometry(random) {
  const geometry = new THREE.IcosahedronGeometry(1, 2);
  const positions = geometry.attributes.position;
  const offsetX = random() * 10;
  const offsetY = random() * 10;
  const offsetZ = random() * 10;
  const vertex = new THREE.Vector3();

  for (let i = 0; i < positions.count; i++) {
    vertex.fromBufferAttribute(positions, i);
    // The push depends ONLY on the vertex position, so triangles that share a
    // corner move it identically and the surface stays closed (no cracks).
    const bump =
      Math.sin(vertex.x * 2.3 + offsetX) *
      Math.sin(vertex.y * 2.1 + offsetY) *
      Math.sin(vertex.z * 2.5 + offsetZ);
    vertex.multiplyScalar(1 + bump * 0.28);
    positions.setXYZ(i, vertex.x, vertex.y, vertex.z);
  }
  geometry.computeVertexNormals();
  return geometry;
}

function createRocks(random) {
  const rocks = new THREE.Group();
  const rockMaterial = new THREE.MeshStandardMaterial({
    color: 0x9a9a8c,
    roughness: 0.95,
    flatShading: true,
  });
  addCausticsToMaterial(rockMaterial); // step 7.3
  // All rocks share one material (cheaper); each rock gets its own random shape.

  const bigRockCount = 12;
  for (let r = 0; r < bigRockCount; r++) {
    const centerX = (random() - 0.5) * pondWidth * 0.95;
    const centerZ = (random() - 0.5) * pondLength * 0.95;
    const bigSize = 0.9 + random() * 1.3;
    addRock(rocks, rockMaterial, random, centerX, centerZ, bigSize);

    // Each big rock gets 2-3 small pebbles around it so rocks look "settled".
    const pebbleCount = 2 + Math.floor(random() * 2);
    for (let p = 0; p < pebbleCount; p++) {
      const angle = random() * Math.PI * 2;
      const distance = bigSize * (1.1 + random() * 1.0);
      addRock(
        rocks,
        rockMaterial,
        random,
        centerX + Math.cos(angle) * distance,
        centerZ + Math.sin(angle) * distance,
        0.25 + random() * 0.35,
      );
    }
  }
  return rocks;
}

function addRock(group, material, random, x, z, size) {
  const rock = new THREE.Mesh(createRockGeometry(random), material);
  // Squash vertically (rocks are wider than tall) and sink them a bit so the
  // bottom is buried in the sand.
  rock.scale.set(size * (0.9 + random() * 0.4), size * (0.55 + random() * 0.25), size * (0.9 + random() * 0.4));
  rock.position.set(x, floorHeightAt(x, z) + size * 0.2, z);
  rock.rotation.y = random() * Math.PI * 2;
  group.add(rock);
}

// ---------------------------------------------------------------------------
// PLANTS (seaweed blades)
// ONE blade = a tall thin ribbon with several segments, so it can bend.
// Then an InstancedMesh draws ~150 copies in ONE draw call (same idea as the
// fish, step 3.1), each with its own position, height and sway phase.
// ---------------------------------------------------------------------------
const BLADE_HEIGHT = 2.6;
const BLADE_SEGMENTS = 8;
const BLADE_BASE_WIDTH = 0.55;

export const plantUniforms = {
  uPlantTime: { value: 0 },
};

function createBladeGeometry() {
  const vertexCount = (BLADE_SEGMENTS + 1) * 2;
  const positions = new Float32Array(vertexCount * 3);
  const colors = new Float32Array(vertexCount * 3);
  const darkGreen = new THREE.Color(0x1f5a2c);
  const lightGreen = new THREE.Color(0x9acb4f);
  const bladeColor = new THREE.Color();
  const indices = [];

  for (let segment = 0; segment <= BLADE_SEGMENTS; segment++) {
    const heightFraction = segment / BLADE_SEGMENTS; // 0 at the root, 1 at the tip
    const y = heightFraction * BLADE_HEIGHT;
    // Blades get thinner toward the tip, ending almost at a point.
    const halfWidth = (BLADE_BASE_WIDTH * 0.5) * (1 - heightFraction * 0.9);
    bladeColor.copy(darkGreen).lerp(lightGreen, heightFraction);

    for (let side = 0; side < 2; side++) {
      const v = segment * 2 + side;
      positions[v * 3 + 0] = side === 0 ? -halfWidth : halfWidth;
      positions[v * 3 + 1] = y;
      positions[v * 3 + 2] = 0;
      colors[v * 3 + 0] = bladeColor.r;
      colors[v * 3 + 1] = bladeColor.g;
      colors[v * 3 + 2] = bladeColor.b;
    }
    if (segment < BLADE_SEGMENTS) {
      const a = segment * 2;
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

function addPlantSwayToMaterial(material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uPlantTime = plantUniforms.uPlantTime;
    shader.vertexShader = shader.vertexShader.replace(
      '#include <common>',
      `#include <common>
       uniform float uPlantTime;
       attribute float aSwayPhase;`,
    );
    shader.vertexShader = shader.vertexShader.replace(
      '#include <begin_vertex>',
      `#include <begin_vertex>

       // How much THIS vertex may move: 0 at the root (planted in the sand),
       // growing toward 1 at the tip. Squaring it keeps the lower stem calmer
       // and lets the tip swing the most, like a real stalk.
       float heightFraction = transformed.y / ${BLADE_HEIGHT.toFixed(2)};
       float swayWeight = heightFraction * heightFraction;

       // Same idea as the fish wiggle (step 2.5): sin(time + position + phase).
       //  - uPlantTime: seconds, so the wave moves forward.
       //  - transformed.y * 0.9: higher up the blade is at a different point of the
       //    wave, so the blade bends in a gentle S instead of leaning rigidly.
       //  - aSwayPhase: random number per blade so they do not all sway in sync.
       float swayWave = sin(uPlantTime * 1.3 + transformed.y * 0.9 + aSwayPhase);
       float swayWaveSide = cos(uPlantTime * 0.9 + transformed.y * 0.6 + aSwayPhase * 1.7);
       transformed.x += swayWave * 0.5 * swayWeight;
       transformed.z += swayWaveSide * 0.3 * swayWeight;`,
    );
  };
}

function createPlants(random) {
  const geometry = createBladeGeometry();
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 0.8,
    side: THREE.DoubleSide, // a ribbon is flat: draw both faces
  });
  addPlantSwayToMaterial(material);

  const clusterCount = 24;
  const bladesPerCluster = 14;
  const bladeCount = clusterCount * bladesPerCluster;

  const swayPhases = new Float32Array(bladeCount);
  const plants = new THREE.InstancedMesh(geometry, material, bladeCount);
  const placement = new THREE.Object3D();

  let bladeIndex = 0;
  for (let c = 0; c < clusterCount; c++) {
    const clusterX = (random() - 0.5) * pondWidth * 0.95;
    const clusterZ = (random() - 0.5) * pondLength * 0.95;
    for (let b = 0; b < bladesPerCluster; b++) {
      const angle = random() * Math.PI * 2;
      const distance = random() * 1.6;
      const x = clusterX + Math.cos(angle) * distance;
      const z = clusterZ + Math.sin(angle) * distance;

      placement.position.set(x, floorHeightAt(x, z) - 0.05, z);
      placement.rotation.set(0, random() * Math.PI * 2, 0);
      placement.scale.set(1, 0.55 + random() * 0.85, 1); // random heights
      placement.updateMatrix();
      plants.setMatrixAt(bladeIndex, placement.matrix);
      swayPhases[bladeIndex] = random() * Math.PI * 2;
      bladeIndex += 1;
    }
  }

  // A per-instance attribute (same mechanism as the fish aPhase, step 3.4).
  geometry.setAttribute('aSwayPhase', new THREE.InstancedBufferAttribute(swayPhases, 1));
  plants.instanceMatrix.needsUpdate = true;
  // Blades sway outside their original bounding box, so skip frustum culling
  // (otherwise the whole patch could pop out when a corner leaves the screen).
  plants.frustumCulled = false;
  return plants;
}

// ---------------------------------------------------------------------------
// PUBLIC: build the whole pond scenery
// ---------------------------------------------------------------------------
export function createPondEnvironment() {
  const random = createSeededRandom(20261004);
  const group = new THREE.Group();
  group.add(createFloor());
  group.add(createRocks(random));
  group.add(createPlants(random));

  return {
    group,
    /** Call every frame with total elapsed seconds so the plants sway. */
    update(elapsedSeconds) {
      plantUniforms.uPlantTime.value = elapsedSeconds;
      causticUniforms.uCausticTime.value = elapsedSeconds;
    },
  };
}
