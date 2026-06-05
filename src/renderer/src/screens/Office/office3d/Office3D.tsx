import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls } from "@react-three/drei";
import { configureTextBuilder } from "troika-three-text";
import * as THREE from "three";
import { AgentModel } from "./objects/agents";
import { WORLD_W, WORLD_H, WALK_SPEED } from "./core/constants";
import type { OfficeAgent, RenderAgent } from "./core/types";

// drei's <Text> (used for agent nameplates / speech bubbles via troika) spawns
// a blob-backed Web Worker by default, which the renderer's strict CSP
// (`script-src 'self'`) blocks. Run typesetting on the main thread instead so
// labels render without loosening the app's Content-Security-Policy.
configureTextBuilder({ useWorker: false });

// Canvas-space bounds the agents are allowed to wander within (the office floor
// spans 0..1800; we keep a margin off the walls).
const BOUND_MIN = 280;
const BOUND_MAX = 1520;
// Canvas units / second of walking speed.
const WALK_UNITS_PER_SEC = 130;
const ARRIVE_DISTANCE = 8;

type ControllerMode = "idle" | "walk";
interface ControllerState {
  mode: ControllerMode;
  until: number;
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

function makeRenderAgent(agent: OfficeAgent): RenderAgent {
  const x = randomBetween(BOUND_MIN, BOUND_MAX);
  const y = randomBetween(BOUND_MIN, BOUND_MAX);
  return {
    ...agent,
    x,
    y,
    targetX: x,
    targetY: y,
    path: [],
    facing: randomBetween(0, Math.PI * 2),
    frame: Math.floor(randomBetween(0, 240)),
    walkSpeed: WALK_SPEED,
    phaseOffset: randomBetween(0, Math.PI * 2),
    state: "standing",
  };
}

/**
 * Holds the live agent simulation. Positions are mutated in-place on the refs
 * each frame so the avatars animate without triggering React re-renders.
 */
function AgentsLayer({
  agents,
  selectedId,
  onSelect,
}: {
  agents: OfficeAgent[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}): React.JSX.Element {
  const agentsRef = useRef<RenderAgent[]>([]);
  const lookupRef = useRef<Map<string, RenderAgent>>(new Map());
  const controllerRef = useRef<Map<string, ControllerState>>(new Map());

  // Reconcile the simulation list whenever the set of agents changes, keeping
  // existing agents' positions so they don't teleport on a profile refresh.
  useMemo(() => {
    const prev = lookupRef.current;
    const next: RenderAgent[] = agents.map((agent) => {
      const existing = prev.get(agent.id);
      if (existing) {
        return { ...existing, ...agent };
      }
      return makeRenderAgent(agent);
    });
    agentsRef.current = next;
    const lookup = new Map<string, RenderAgent>();
    for (const a of next) lookup.set(a.id, a);
    lookupRef.current = lookup;
    // Drop controller state for removed agents.
    const controller = controllerRef.current;
    for (const id of [...controller.keys()]) {
      if (!lookup.has(id)) controller.delete(id);
    }
  }, [agents]);

  useFrame((_, delta) => {
    const now = Date.now();
    const step = Math.min(delta, 0.05); // clamp big frame gaps
    for (const agent of agentsRef.current) {
      agent.frame += step * 60;

      let ctrl = controllerRef.current.get(agent.id);
      if (!ctrl) {
        ctrl = { mode: "idle", until: now + randomBetween(500, 3000) };
        controllerRef.current.set(agent.id, ctrl);
      }

      if (ctrl.mode === "idle") {
        agent.state = "standing";
        if (now >= ctrl.until) {
          agent.targetX = randomBetween(BOUND_MIN, BOUND_MAX);
          agent.targetY = randomBetween(BOUND_MIN, BOUND_MAX);
          ctrl.mode = "walk";
        }
        continue;
      }

      // Walking toward the target.
      const dx = agent.targetX - agent.x;
      const dy = agent.targetY - agent.y;
      const dist = Math.hypot(dx, dy);
      if (dist <= ARRIVE_DISTANCE) {
        agent.x = agent.targetX;
        agent.y = agent.targetY;
        agent.state = "standing";
        ctrl.mode = "idle";
        ctrl.until = now + randomBetween(2000, 6500);
        continue;
      }
      const move = Math.min(dist, WALK_UNITS_PER_SEC * step);
      agent.x += (dx / dist) * move;
      agent.y += (dy / dist) * move;
      agent.facing = Math.atan2(dx, dy);
      agent.state = "walking";
    }
  });

  return (
    <>
      {agents.map((agent) => (
        <AgentModel
          key={agent.id}
          agentId={agent.id}
          name={agent.name}
          subtitle={agent.subtitle}
          status={agent.status}
          color={agent.color}
          appearance={agent.avatarProfile}
          agentsRef={agentsRef}
          agentLookupRef={lookupRef}
          onClick={onSelect}
          showSpeech={selectedId === agent.id}
          speechText={selectedId === agent.id ? `Hi, I'm ${agent.name}` : null}
        />
      ))}
    </>
  );
}

/** Floor, rug and perimeter walls — a clean, minimal office shell. */
function Room(): React.JSX.Element {
  const halfW = WORLD_W / 2;
  const halfH = WORLD_H / 2;
  const wallH = 2.4;
  const wallT = 0.2;
  return (
    <group>
      {/* Floor */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]} receiveShadow>
        <planeGeometry args={[WORLD_W, WORLD_H]} />
        <meshStandardMaterial color="#e7e2d8" />
      </mesh>
      {/* Center rug for a bit of warmth */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.01, 0]}>
        <planeGeometry args={[WORLD_W * 0.42, WORLD_H * 0.42]} />
        <meshStandardMaterial color="#cdd7e5" />
      </mesh>
      {/* Walls */}
      <mesh position={[0, wallH / 2, -halfH]}>
        <boxGeometry args={[WORLD_W, wallH, wallT]} />
        <meshStandardMaterial color="#c9c2b4" />
      </mesh>
      <mesh position={[0, wallH / 2, halfH]}>
        <boxGeometry args={[WORLD_W, wallH, wallT]} />
        <meshStandardMaterial color="#c9c2b4" />
      </mesh>
      <mesh position={[-halfW, wallH / 2, 0]}>
        <boxGeometry args={[wallT, wallH, WORLD_H]} />
        <meshStandardMaterial color="#d2ccbf" />
      </mesh>
      <mesh position={[halfW, wallH / 2, 0]}>
        <boxGeometry args={[wallT, wallH, WORLD_H]} />
        <meshStandardMaterial color="#d2ccbf" />
      </mesh>
    </group>
  );
}

/**
 * The native, in-renderer 3D office. Replaces the old webview that pointed at a
 * separately-cloned hermes-office dev server. Each agent corresponds to a
 * desktop profile.
 */
export default function Office3D({
  agents,
  onSelectAgent,
}: {
  agents: OfficeAgent[];
  onSelectAgent?: (id: string | null) => void;
}): React.JSX.Element {
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Clear selection if the selected agent disappears.
  useEffect(() => {
    if (selectedId && !agents.some((a) => a.id === selectedId)) {
      setSelectedId(null);
    }
  }, [agents, selectedId]);

  const handleSelect = (id: string): void => {
    const next = id === selectedId ? null : id;
    setSelectedId(next);
    onSelectAgent?.(next);
  };

  return (
    <Canvas
      shadows
      camera={{ position: [0, 22, 26], fov: 50 }}
      gl={{ antialias: true }}
      onPointerMissed={() => {
        setSelectedId(null);
        onSelectAgent?.(null);
      }}
      style={{ width: "100%", height: "100%" }}
    >
      <color attach="background" args={["#f3f1ec"]} />
      <hemisphereLight args={["#ffffff", "#b9b4a8", 1.1]} />
      <ambientLight intensity={0.5} />
      <directionalLight
        position={[12, 24, 12]}
        intensity={1.1}
        castShadow
        shadow-mapSize-width={2048}
        shadow-mapSize-height={2048}
      />
      <Room />
      <AgentsLayer
        agents={agents}
        selectedId={selectedId}
        onSelect={handleSelect}
      />
      <OrbitControls
        makeDefault
        enablePan
        minDistance={8}
        maxDistance={48}
        maxPolarAngle={Math.PI / 2.15}
        target={new THREE.Vector3(0, 0, 0)}
      />
    </Canvas>
  );
}
