import { Suspense, useMemo, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { configureTextBuilder } from "troika-three-text";
import * as THREE from "three";
import { SceneEnvironment } from "./objects/SceneEnvironment";
import { CityBackdrop, DistantSkyline } from "./objects/CityBackdrop";
import { TrafficLayer } from "./objects/Traffic";
import { BankSection, ConnectingStreet } from "./objects/Bank";
import { CarShowroom } from "./objects/CarShowroom";
import {
  Room,
  InteriorWalls,
  GlassWalls,
  CeoOfficeExtras,
} from "./objects/OfficeShell";
import { Workstations, FurniturePieces } from "./objects/furniture";
import { AgentsLayer } from "./objects/AgentsLayer";
import { buildWorkstations, REST_FURNITURE, EXECUTIVE_DECOR } from "./layout";
import { DAY_PALETTE } from "./core/palette";
import { BANK_Z } from "./core/cityPlan";
import type { OfficeAgent } from "./core/types";
import officeFontUrl from "../../../assets/fonts/Manrope-Medium.ttf";

// drei's <Text> (agent nameplates / speech bubbles, via troika) defaults to two
// behaviours the renderer's strict CSP (`script-src`/`default-src 'self'`)
// blocks: spawning a blob-backed Web Worker, and fetching its default font from
// a CDN. Disable the worker (typeset on the main thread) and point troika at
// our locally-bundled Manrope so labels render fully offline without loosening
// the app's Content-Security-Policy.
configureTextBuilder({ useWorker: false, defaultFontURL: officeFontUrl });

/**
 * The native, in-renderer 3D office. Replaces the old webview that pointed at a
 * separately-cloned hermes-office dev server. Each agent corresponds to a
 * desktop profile.
 */
export default function Office3D({
  agents,
  selectedId,
  onSelectAgent,
}: {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelectAgent: (id: string | null) => void;
}): React.JSX.Element {
  // Clicking the selected agent again clears the selection.
  const handleSelect = (id: string): void => {
    onSelectAgent(id === selectedId ? null : id);
  };

  // Keep the camera's focus point inside the city so panning (or
  // zoom-to-cursor) can never strand the user in empty void off the map.
  const controlsRef = useRef<React.ComponentRef<typeof OrbitControls>>(null);
  const clampControlsTarget = (): void => {
    const controls = controlsRef.current;
    if (!controls) return;
    const t = controls.target;
    const x = THREE.MathUtils.clamp(t.x, -90, 90);
    const y = THREE.MathUtils.clamp(t.y, 0, 12);
    const z = THREE.MathUtils.clamp(t.z, -90, 90);
    if (x !== t.x || y !== t.y || z !== t.z) t.set(x, y, z);
  };

  // The CEO (if any) gets a separate executive desk; everyone else grids up.
  const ceoId = useMemo(
    () => agents.find((a) => a.position === "ceo")?.id ?? null,
    [agents],
  );

  // One desk per agent, assigned in profile order.
  const workstations = useMemo(
    () =>
      buildWorkstations(
        agents.map((a) => a.id),
        ceoId,
      ),
    [agents, ceoId],
  );

  const palette = DAY_PALETTE;

  return (
    <Canvas
      shadows="percentage"
      dpr={[1, 2]}
      // near=1 (instead of the 0.1 default) gives the depth buffer ~10× more
      // precision at distance — without it the road decals z-fight the ground
      // plane into flickering stripes when viewed from far away.
      camera={{ position: [0, 38, 48], fov: 50, near: 1, far: 1000 }}
      gl={{
        antialias: true,
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
      onPointerMissed={() => onSelectAgent(null)}
      style={{ width: "100%", height: "100%" }}
    >
      <SceneEnvironment palette={palette} />
      <DistantSkyline />
      <CityBackdrop />
      <Suspense fallback={null}>
        <TrafficLayer />
      </Suspense>
      <ConnectingStreet />
      <Room palette={palette} />
      <InteriorWalls palette={palette} />
      {/* CEO glass corner office — only exists when there is a CEO. */}
      {ceoId && (
        <>
          <GlassWalls />
          <Suspense fallback={null}>
            <CeoOfficeExtras />
          </Suspense>
        </>
      )}
      <BankSection />
      <CarShowroom />
      <Suspense fallback={null}>
        <Workstations workstations={workstations} />
        <FurniturePieces pieces={REST_FURNITURE} />
        {ceoId && <FurniturePieces pieces={EXECUTIVE_DECOR} />}
      </Suspense>
      <AgentsLayer
        agents={agents}
        workstations={workstations}
        selectedId={selectedId}
        onSelect={handleSelect}
      />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enablePan
        // Inertial damping: motion eases out instead of stopping dead, which
        // is most of the "controllable" feel.
        enableDamping
        dampingFactor={0.08}
        // Gentler speeds — the raw defaults feel twitchy over a city-sized
        // scene, especially zoom (multiplicative per wheel tick).
        rotateSpeed={0.75}
        panSpeed={0.9}
        zoomSpeed={0.65}
        // Map-style panning: dragging slides along the ground plane at
        // constant height, instead of moving with the screen axes.
        screenSpacePanning={false}
        // Scrolling dives toward whatever the cursor points at — point at
        // the bank or showroom and scroll to fly there.
        zoomToCursor
        minDistance={5}
        maxDistance={130}
        maxPolarAngle={Math.PI / 2.15}
        // Plain tuple, not a Vector3 instance — a fresh instance every render
        // would reset the controls' target and wipe any user pan.
        target={[0, 0, BANK_Z / 2]}
        onChange={clampControlsTarget}
      />
    </Canvas>
  );
}
