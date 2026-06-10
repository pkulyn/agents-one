import { Suspense, memo, useLayoutEffect, useMemo, useRef } from "react";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import treeGlbUrl from "../assets/tree.glb?url";
import building1GlbUrl from "../assets/building1.glb?url";
import building2GlbUrl from "../assets/building2.glb?url";
import streetLightGlbUrl from "../assets/street-light.glb?url";
import trafficLightGlbUrl from "../assets/traffic-light.glb?url";
import { WORLD_W, WORLD_H } from "../core/constants";
import { seededRandom } from "../core/rng";
import { glbClone, normalizeFootprint } from "../core/glb";
import {
  BANK_W,
  BANK_D,
  BANK_Z,
  BANK_STREET_GAP,
  ROADS,
  ROAD_SOUTH_Z,
  ROAD_NORTH_Z,
  ROAD_EAST_X,
  ROAD_WIDTH,
  ROAD_LEN,
  ROAD_Y,
  ROAD_MARKING_Y,
  SHOWROOM_W,
  SHOWROOM_D,
  SHOWROOM_X,
  SHOWROOM_Z,
  VIEW_BLOCKER_SPOTS,
} from "../core/cityPlan";

// ── Shared geometry / materials ────────────────────────────────────────────
// Roads, lane dashes and building windows repeat hundreds of times; sharing
// one unit geometry (scaled per mesh) and one material per kind collapses
// what used to be ~1000 separate geometry/material instances. Module-level
// singletons — meshes using them set dispose={null} so an unmount of the
// Office tab can't dispose a shared resource out from under a remount.
const unitPlaneGeo = new THREE.PlaneGeometry(1, 1);
const roadMat = new THREE.MeshStandardMaterial({
  color: "#4a4e57",
  roughness: 0.95,
});
const dashMat = new THREE.MeshStandardMaterial({
  color: "#f5e642",
  roughness: 0.9,
});
const windowMat = new THREE.MeshStandardMaterial({
  color: "#a8d8f0",
  emissive: "#88c8f0",
  emissiveIntensity: 0.4,
  roughness: 0.1,
  metalness: 0.3,
});

/**
 * Detailed backdrop building (building1/building2 GLB), auto-normalised:
 * recentred, grounded at y=0 and uniformly scaled so its footprint fits the
 * city-grid cell, with a random quarter-turn for variety.
 */
function CityBuildingGlb({
  x,
  z,
  footprint,
  rotY,
  which,
}: {
  x: number;
  z: number;
  footprint: number;
  rotY: number;
  which: 1 | 2;
}): React.JSX.Element {
  const { scene } = useGLTF(
    which === 1 ? building1GlbUrl : building2GlbUrl,
    false,
    false,
  );
  const object = useMemo(
    () => normalizeFootprint(glbClone(scene, null), footprint),
    [scene, footprint],
  );
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]}>
      <primitive object={object} />
    </group>
  );
}

function TreeGlb({
  x,
  z,
  h,
}: {
  x: number;
  z: number;
  h: number;
}): React.JSX.Element {
  const { scene } = useGLTF(treeGlbUrl, false, false);
  const object = useMemo(() => glbClone(scene, null), [scene]);
  const s = h * 0.28;
  return (
    <group position={[x, 0, z]} scale={[s, s, s]}>
      <primitive object={object} />
    </group>
  );
}

function StreetLightGlb({
  x,
  z,
  rotY = 0,
}: {
  x: number;
  z: number;
  rotY?: number;
}): React.JSX.Element {
  const { scene } = useGLTF(streetLightGlbUrl, false, false);
  const object = useMemo(() => glbClone(scene, null), [scene]);
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]} scale={[0.8, 0.8, 0.8]}>
      <primitive object={object} />
    </group>
  );
}

function TrafficLightGlb({
  x,
  z,
  rotY = 0,
}: {
  x: number;
  z: number;
  rotY?: number;
}): React.JSX.Element {
  const { scene } = useGLTF(trafficLightGlbUrl, false, false);
  const object = useMemo(() => glbClone(scene, null), [scene]);
  return (
    <group position={[x, 0, z]} rotation={[0, rotY, 0]} scale={[1.6, 1.6, 1.6]}>
      <primitive object={object} />
    </group>
  );
}

/**
 * Distant low-poly skyline ring — silhouette towers scattered in a wide band
 * outside the detailed backdrop lot, so the horizon reads as a city that
 * keeps going (GTA-style layering: crisp lot → hazy mid-distance towers →
 * sky). One instanced draw call; fog does the atmospheric blending.
 */
const SKYLINE_COUNT = 110;
const SKYLINE_UP = new THREE.Vector3(0, 1, 0);

export const DistantSkyline = memo(
  function DistantSkyline(): React.JSX.Element {
    const meshRef = useRef<THREE.InstancedMesh>(null);

    useLayoutEffect(() => {
      const mesh = meshRef.current;
      if (!mesh) return;
      const matrix = new THREE.Matrix4();
      const quat = new THREE.Quaternion();
      const pos = new THREE.Vector3();
      const scl = new THREE.Vector3();
      const color = new THREE.Color();
      for (let i = 0; i < SKYLINE_COUNT; i++) {
        const angle = seededRandom(i * 3 + 1) * Math.PI * 2;
        // Bias towards the outer edge so towers stack into a skyline wall.
        const radius = 75 + Math.pow(seededRandom(i * 3 + 2), 0.7) * 190;
        const w = 5 + seededRandom(i * 3 + 3) * 12;
        const d = 5 + seededRandom(i * 5 + 4) * 12;
        // Further rings grow taller so they stay visible over nearer ones.
        const h = 8 + seededRandom(i * 7 + 5) * 28 + (radius - 75) * 0.12;
        quat.setFromAxisAngle(SKYLINE_UP, seededRandom(i * 11 + 6) * Math.PI);
        pos.set(
          Math.cos(angle) * radius,
          h / 2 - 0.1,
          Math.sin(angle) * radius,
        );
        scl.set(w, h, d);
        matrix.compose(pos, quat, scl);
        mesh.setMatrixAt(i, matrix);
        color.setHSL(215 / 360, 0.1, 0.36 + seededRandom(i * 13 + 7) * 0.22);
        mesh.setColorAt(i, color);
      }
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }, []);

    return (
      <instancedMesh
        ref={meshRef}
        args={[undefined, undefined, SKYLINE_COUNT]}
        frustumCulled={false}
      >
        <boxGeometry args={[1, 1, 1]} />
        <meshStandardMaterial roughness={0.95} metalness={0.05} />
      </instancedMesh>
    );
  },
);

interface BoxBuilding {
  x: number;
  z: number;
  w: number;
  d: number;
  h: number;
  color: string;
}

interface GlbBuilding {
  x: number;
  z: number;
  footprint: number;
  rotY: number;
  which: 1 | 2;
}

interface BackdropTree {
  x: number;
  z: number;
  h: number;
}

/** Deterministic city-block generation around the office / bank / showroom. */
function generateBackdrop(): {
  buildings: BoxBuilding[];
  glbBuildings: GlbBuilding[];
  trees: BackdropTree[];
} {
  const buildings: BoxBuilding[] = [];
  const glbBuildings: GlbBuilding[] = [];
  const trees: BackdropTree[] = [];

  const cell = 5.0;
  const rows = 20;
  const cols = 20;
  const margin = 2.5;
  const officeW = WORLD_W + margin;
  const officeH = WORLD_H + margin;
  // Also clear the bank lot
  const bankMinZ = BANK_Z - BANK_D / 2 - margin;
  const bankMaxZ = BANK_Z + BANK_D / 2 + margin;
  const bankMinX = -BANK_W / 2 - margin;
  const bankMaxX = BANK_W / 2 + margin;
  const rW = ROAD_WIDTH / 2 + 1.5; // half-width + building clearance

  for (let ix = 0; ix < cols; ix++) {
    for (let iz = 0; iz < rows; iz++) {
      const x = (ix - cols / 2 + 0.5) * cell;
      const z = (iz - rows / 2 + 0.5) * cell;

      // Leave the office lot empty
      if (
        x > -officeW / 2 &&
        x < officeW / 2 &&
        z > -officeH / 2 &&
        z < officeH / 2
      ) {
        continue;
      }

      // Leave the bank lot empty
      if (x > bankMinX && x < bankMaxX && z > bankMinZ && z < bankMaxZ) {
        continue;
      }

      // Leave the showroom lot empty. Margin is wider than the lots above:
      // exclusion tests cell CENTRES, and a building footprint can reach
      // cell * 1.4 / 2 = 3.5 units beyond its centre — with the default
      // 2.5 margin the ±12.5 rows clipped the showroom corners.
      const showroomClear = 6;
      if (
        x > SHOWROOM_X - SHOWROOM_W / 2 - showroomClear &&
        x < SHOWROOM_X + SHOWROOM_W / 2 + showroomClear &&
        z > SHOWROOM_Z - SHOWROOM_D / 2 - showroomClear &&
        z < SHOWROOM_Z + SHOWROOM_D / 2 + showroomClear
      ) {
        continue;
      }

      // Curated view-corridor cells (see VIEW_BLOCKER_SPOTS)
      if (
        VIEW_BLOCKER_SPOTS.some(
          ([bx, bz]) =>
            Math.abs(x - bx) < cell / 2 && Math.abs(z - bz) < cell / 2,
        )
      ) {
        continue;
      }

      // Keep every road clear, plus the office↔bank connecting street
      const rConnZ = -(WORLD_H / 2 + BANK_STREET_GAP / 2);
      if (
        ROADS.some((r) =>
          r.axis === "x"
            ? Math.abs(z - r.center) < rW
            : Math.abs(x - r.center) < rW,
        )
      )
        continue;
      if (
        z > rConnZ - BANK_STREET_GAP / 2 - 1 &&
        z < rConnZ + BANK_STREET_GAP / 2 + 1 &&
        x > -BANK_W / 2 - 1 &&
        x < BANK_W / 2 + 1
      )
        continue;

      const seed = ix * 100 + iz;
      const roll = seededRandom(seed);

      if (roll < 0.15) {
        // Random tree in any open cell
        trees.push({
          x: x + (seededRandom(seed + 1) - 0.5) * cell * 0.5,
          z: z + (seededRandom(seed + 2) - 0.5) * cell * 0.5,
          h: 1.2 + seededRandom(seed + 3) * 1.6,
        });
      } else if (roll < 0.6) {
        // Building. Near the core, mix in the detailed GLB models; further
        // out (fog-hazed anyway) stick to cheap procedural boxes.
        const nearCore = Math.hypot(x, z) < 60;
        if (nearCore && seededRandom(seed + 5) < 0.45) {
          glbBuildings.push({
            x,
            z,
            footprint: cell * (0.95 + seededRandom(seed + 6) * 0.45),
            rotY: Math.floor(seededRandom(seed + 7) * 4) * (Math.PI / 2),
            which: seededRandom(seed + 8) < 0.5 ? 1 : 2,
          });
        } else {
          const w = cell * (0.7 + seededRandom(seed + 1) * 0.5);
          const d = cell * (0.7 + seededRandom(seed + 2) * 0.5);
          const h = 5 + seededRandom(seed + 3) * 14;
          const lightness = 55 + seededRandom(seed + 4) * 25;
          buildings.push({
            x,
            z,
            w,
            d,
            h,
            color: `hsl(210, 8%, ${lightness}%)`,
          });
        }
      }
      // else: leave cell empty (pavement / gap)
    }
  }
  return { buildings, glbBuildings, trees };
}

/** Sparse city backdrop — buildings, trees, roads and street furniture. */
export const CityBackdrop = memo(function CityBackdrop(): React.JSX.Element {
  const { buildings, glbBuildings, trees } = useMemo(
    () => generateBackdrop(),
    [],
  );

  const roadSouthZ = ROAD_SOUTH_Z;
  const roadNorthZ = ROAD_NORTH_Z;
  const roadEastX = ROAD_EAST_X;
  const roadWidth = ROAD_WIDTH;
  const dashLen = 2.0;
  const dashGap = 1.8;
  const dashCount = Math.floor(ROAD_LEN / (dashLen + dashGap));

  // Lamp spots along the inner roads, skipping any that land on a crossing.
  const { lampXs, lampZs } = useMemo(() => {
    const lampSpots = [-44, -33, -22, -11, 0, 11, 22, 33, 44];
    const clearOfRoads = (o: number, crossAxis: "x" | "z"): boolean =>
      ROADS.every(
        (r) =>
          r.axis !== crossAxis || Math.abs(o - r.center) > roadWidth / 2 + 1.2,
      );
    return {
      lampXs: lampSpots.filter((o) => clearOfRoads(o, "z")),
      lampZs: lampSpots.filter((o) => clearOfRoads(o, "x")),
    };
  }, [roadWidth]);

  return (
    <group>
      {/* Ground disc out to the horizon. Fog fades it into the sky long
          before the rim is visible. */}
      <mesh
        rotation={[-Math.PI / 2, 0, 0]}
        position={[0, -0.02, 0]}
        receiveShadow
      >
        <circleGeometry args={[380, 64]} />
        <meshStandardMaterial color="#b0b5bd" roughness={0.92} metalness={0} />
      </mesh>
      {/* Road surfaces — shared unit plane scaled per road */}
      {ROADS.map((road, i) => (
        <mesh
          key={`road-${i}`}
          geometry={unitPlaneGeo}
          material={roadMat}
          dispose={null}
          rotation={[-Math.PI / 2, 0, 0]}
          position={
            road.axis === "x"
              ? [0, ROAD_Y, road.center]
              : [road.center, ROAD_Y, 0]
          }
          scale={
            road.axis === "x"
              ? [ROAD_LEN, roadWidth, 1]
              : [roadWidth, ROAD_LEN, 1]
          }
        />
      ))}
      {/* Centre dashes — shared geometry + material across all roads */}
      {ROADS.map((road, i) =>
        Array.from({ length: dashCount }, (_, j) => {
          const o = -ROAD_LEN / 2 + j * (dashLen + dashGap) + dashLen / 2;
          return (
            <mesh
              key={`dash-${i}-${j}`}
              geometry={unitPlaneGeo}
              material={dashMat}
              dispose={null}
              rotation={[-Math.PI / 2, 0, 0]}
              position={
                road.axis === "x"
                  ? [o, ROAD_MARKING_Y, road.center]
                  : [road.center, ROAD_MARKING_Y, o]
              }
              scale={
                road.axis === "x" ? [dashLen, 0.18, 1] : [0.18, dashLen, 1]
              }
            />
          );
        }),
      )}
      {buildings.map((b, i) => {
        const winCols = Math.max(1, Math.floor(b.w / 1.1));
        const winRows = Math.max(1, Math.floor(b.h / 1.4));
        const winW = 0.55;
        const winH = 0.65;
        const winSpacingX = b.w / winCols;
        const winSpacingY = b.h / (winRows + 1);
        // Individual window planes are only worth their draw calls up close;
        // far buildings are fog-hazed anyway and the expanded grid would
        // otherwise add thousands of meshes.
        const showWindows = Math.hypot(b.x, b.z) < 55;
        return (
          <group key={`b-${i}`}>
            <mesh position={[b.x, b.h / 2, b.z]} castShadow receiveShadow>
              <boxGeometry args={[b.w, b.h, b.d]} />
              <meshStandardMaterial
                color={b.color}
                roughness={0.88}
                metalness={0.04}
              />
            </mesh>
            {/* Windows on south + north faces — shared geometry/material */}
            {showWindows &&
              Array.from({ length: winCols }, (_, cx) =>
                Array.from({ length: winRows }, (_, ry) => (
                  <mesh
                    key={`w-s-${i}-${cx}-${ry}`}
                    geometry={unitPlaneGeo}
                    material={windowMat}
                    dispose={null}
                    scale={[winW, winH, 1]}
                    position={[
                      b.x - b.w / 2 + (cx + 0.5) * winSpacingX,
                      (ry + 1) * winSpacingY,
                      b.z + b.d / 2 + 0.02,
                    ]}
                  />
                )),
              )}
            {showWindows &&
              Array.from({ length: winCols }, (_, cx) =>
                Array.from({ length: winRows }, (_, ry) => (
                  <mesh
                    key={`w-n-${i}-${cx}-${ry}`}
                    geometry={unitPlaneGeo}
                    material={windowMat}
                    dispose={null}
                    scale={[winW, winH, 1]}
                    position={[
                      b.x - b.w / 2 + (cx + 0.5) * winSpacingX,
                      (ry + 1) * winSpacingY,
                      b.z - b.d / 2 - 0.02,
                    ]}
                    rotation={[0, Math.PI, 0]}
                  />
                )),
              )}
          </group>
        );
      })}
      <Suspense fallback={null}>
        {glbBuildings.map((g, i) => (
          <CityBuildingGlb
            key={`gb-${i}`}
            x={g.x}
            z={g.z}
            footprint={g.footprint}
            rotY={g.rotY}
            which={g.which}
          />
        ))}
        {trees.map((t, i) => (
          <TreeGlb key={`t-${i}`} x={t.x} z={t.z} h={t.h} />
        ))}
        {/* Traffic lights at the 4 inner road intersections */}
        <TrafficLightGlb
          x={roadEastX - roadWidth / 2 - 0.6}
          z={roadSouthZ - roadWidth / 2 - 0.6}
          rotY={Math.PI}
        />
        <TrafficLightGlb
          x={-roadEastX + roadWidth / 2 + 0.6}
          z={roadSouthZ - roadWidth / 2 - 0.6}
          rotY={0}
        />
        <TrafficLightGlb
          x={roadEastX - roadWidth / 2 - 0.6}
          z={roadNorthZ + roadWidth / 2 + 0.6}
          rotY={Math.PI}
        />
        <TrafficLightGlb
          x={-roadEastX + roadWidth / 2 + 0.6}
          z={roadNorthZ + roadWidth / 2 + 0.6}
          rotY={0}
        />
        {/* Street lights along E-W south road — both sides */}
        {lampXs.map((ox) => (
          <StreetLightGlb
            key={`sl-ews-n-${ox}`}
            x={ox}
            z={roadSouthZ - roadWidth / 2 - 1.0}
            rotY={0}
          />
        ))}
        {lampXs.map((ox) => (
          <StreetLightGlb
            key={`sl-ews-s-${ox}`}
            x={ox}
            z={roadSouthZ + roadWidth / 2 + 1.0}
            rotY={Math.PI}
          />
        ))}
        {/* Street lights along N-S east road */}
        {lampZs.map((oz) => (
          <StreetLightGlb
            key={`sl-nse-w-${oz}`}
            x={roadEastX - roadWidth / 2 - 1.0}
            z={oz}
            rotY={Math.PI / 2}
          />
        ))}
        {/* Street lights along N-S west road */}
        {lampZs.map((oz) => (
          <StreetLightGlb
            key={`sl-nsw-e-${oz}`}
            x={-roadEastX + roadWidth / 2 + 1.0}
            z={oz}
            rotY={-Math.PI / 2}
          />
        ))}
      </Suspense>
    </group>
  );
});

useGLTF.preload(treeGlbUrl, false, false);
useGLTF.preload(building1GlbUrl, false, false);
useGLTF.preload(building2GlbUrl, false, false);
useGLTF.preload(streetLightGlbUrl, false, false);
useGLTF.preload(trafficLightGlbUrl, false, false);
