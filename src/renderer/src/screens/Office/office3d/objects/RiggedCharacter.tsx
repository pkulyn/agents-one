import { useGLTF } from "@react-three/drei";
import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { clone as SkeletonClone } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { RenderAgent } from "../core/types";
import bizManGlbUrl from "../assets/biz_man.glb?url";

export const RIGGED_EMPLOYEE_URL = bizManGlbUrl;

const DEFAULT_AGENT_HEIGHT = 0.65;

function computeAutoScale(bbox: THREE.Box3): number {
  const size = new THREE.Vector3();
  bbox.getSize(size);
  const modelHeight = size.y;
  if (modelHeight <= 0) return 1;
  return DEFAULT_AGENT_HEIGHT / modelHeight;
}

function findAnimationByName(
  names: string[],
  target: string,
): number | undefined {
  const wanted = target.toLowerCase();
  // Clip names are often prefixed by the armature (e.g. "Armature|Walk"), so
  // compare against the trailing segment after the last "|".
  const idx = names.findIndex((n) => {
    const leaf = n.split("|").pop() ?? n;
    return leaf.toLowerCase() === wanted;
  });
  return idx >= 0 ? idx : undefined;
}

export function RiggedCharacter({
  url,
  agentId,
  agentsRef,
  agentLookupRef,
  scaleMultiplier = 1.45,
}: {
  url: string;
  agentId: string;
  agentsRef: React.RefObject<RenderAgent[]>;
  agentLookupRef?: React.RefObject<Map<string, RenderAgent>>;
  scaleMultiplier?: number;
}) {
  const groupRef = useRef<THREE.Group>(null);
  const { scene, animations } = useGLTF(url);
  const { invalidate } = useThree();

  const clonedScene = useMemo(() => {
    const cloned = SkeletonClone(scene);
    cloned.updateMatrixWorld(true);
    // Skinned meshes frequently get incorrectly frustum-culled because their
    // bounding sphere stays at the rig origin, making the avatar vanish.
    cloned.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        child.frustumCulled = false;
        child.castShadow = true;
        child.receiveShadow = true;
      }
    });
    return cloned;
  }, [scene]);

  const { autoScale, bboxMin, bboxCenter } = useMemo(() => {
    clonedScene.updateWorldMatrix(true, true);
    const bbox = new THREE.Box3().setFromObject(clonedScene);
    const center = new THREE.Vector3();
    const min = bbox.min.clone();
    bbox.getCenter(center);
    const scaleValue = computeAutoScale(bbox);
    return { autoScale: scaleValue, bboxMin: min, bboxCenter: center };
  }, [clonedScene]);

  const defaultHipsY = useMemo(() => {
    const hips = clonedScene.getObjectByName('Hips') || clonedScene.getObjectByName('Pelvis');
    return hips ? hips.position.y : 0;
  }, [clonedScene]);

  const { mixer, clipMap } = useMemo(() => {
    const m = new THREE.AnimationMixer(clonedScene);
    const names = animations.map((c) => c.name);
    const map: Record<string, number | undefined> = {
      idle: findAnimationByName(names, "idle"),
      walk: findAnimationByName(names, "walk"),
      // biz_man.glb has no "Sprint" clip — fall back to "Run".
      sprint:
        findAnimationByName(names, "sprint") ??
        findAnimationByName(names, "run"),
      jump: findAnimationByName(names, "jump"),
      sit:
        findAnimationByName(names, "sit") ??
        findAnimationByName(names, "sitting") ??
        findAnimationByName(names, "chair") ??
        findAnimationByName(names, "seated"),
    };
    return { mixer: m, clipMap: map };
  }, [animations, clonedScene]);

  // Index of the clip currently faded in. Tracked so we only crossfade when the
  // target actually changes — re-triggering reset()/fadeIn() every frame snaps
  // the clip back to frame 0 and looks like a jittery hop.
  const currentClipIdxRef = useRef<number | null>(null);

  useEffect(() => {
    currentClipIdxRef.current = null;
    return () => {
      mixer.stopAllAction();
      mixer.uncacheRoot(clonedScene);
    };
  }, [mixer, clonedScene]);

  useFrame((_, delta) => {
    const agents = agentsRef.current;
    if (!agents) return;
    const agent =
      agentLookupRef?.current?.get(agentId) ??
      agents.find((a) => a.id === agentId);
    if (!agent) return;

    let targetClipIdx: number | undefined;
    if (agent.state === "walking") {
      targetClipIdx = agent.walkSpeed > 2.5 ? clipMap.sprint : clipMap.walk;
    } else if (agent.state === "sitting") {
      targetClipIdx = clipMap.sit ?? clipMap.idle;
    } else {
      // standing / away / etc. — settle into idle.
      targetClipIdx = clipMap.idle;
    }
    if (targetClipIdx === undefined) targetClipIdx = clipMap.idle;

    if (
      targetClipIdx !== undefined &&
      targetClipIdx !== currentClipIdxRef.current
    ) {
      const prevIdx = currentClipIdxRef.current;
      if (prevIdx !== null && animations[prevIdx]) {
        mixer.clipAction(animations[prevIdx], clonedScene).fadeOut(0.25);
      }
      const nextAction = mixer.clipAction(
        animations[targetClipIdx],
        clonedScene,
      );
      nextAction.reset().setEffectiveWeight(1).fadeIn(0.25).play();
      currentClipIdxRef.current = targetClipIdx;
    }

    mixer.update(Math.min(delta, 1 / 30));

    // Apply procedural sitting overrides if using the fallback idle animation
    const hips = clonedScene.getObjectByName('Hips') || clonedScene.getObjectByName('Pelvis');
    if (agent.state === "sitting" && targetClipIdx === clipMap.idle) {
      const leftThigh =
        clonedScene.getObjectByName('UpperLeg.L') ||
        clonedScene.getObjectByName('UpperLeg_L');
      const rightThigh =
        clonedScene.getObjectByName('UpperLeg.R') ||
        clonedScene.getObjectByName('UpperLeg_R');
      const leftShin =
        clonedScene.getObjectByName('LowerLeg.L') ||
        clonedScene.getObjectByName('LowerLeg_L');
      const rightShin =
        clonedScene.getObjectByName('LowerLeg.R') ||
        clonedScene.getObjectByName('LowerLeg_R');
      const leftArm =
        clonedScene.getObjectByName('UpperArm.L') ||
        clonedScene.getObjectByName('UpperArm_L');
      const rightArm =
        clonedScene.getObjectByName('UpperArm.R') ||
        clonedScene.getObjectByName('UpperArm_R');

      if (hips) hips.position.y = defaultHipsY - 0.22;
      if (leftThigh) leftThigh.rotation.x = -Math.PI / 2;
      if (rightThigh) rightThigh.rotation.x = -Math.PI / 2;
      if (leftShin) leftShin.rotation.x = Math.PI / 2;
      if (rightShin) rightShin.rotation.x = Math.PI / 2;
      if (leftArm) leftArm.rotation.x = -Math.PI / 4;
      if (rightArm) rightArm.rotation.x = -Math.PI / 4;
    } else {
      // Reset hips to default when not sitting
      if (hips) hips.position.y = defaultHipsY;
    }

    invalidate();
  });

  return (
    <group ref={groupRef}>
      <primitive
        object={clonedScene}
        scale={autoScale * scaleMultiplier}
        position={[
          -bboxCenter.x * autoScale * scaleMultiplier,
          -bboxMin.y * autoScale * scaleMultiplier,
          -bboxCenter.z * autoScale * scaleMultiplier,
        ]}
      />
    </group>
  );
}

useGLTF.preload(bizManGlbUrl);
