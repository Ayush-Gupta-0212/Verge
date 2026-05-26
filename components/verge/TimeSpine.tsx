'use client';

import { useMemo, useRef, useState } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { useTaskStore } from '@/stores/useTaskStore';
import { useUIStore } from '@/stores/useUIStore';
import { useReducedMotion } from '@/lib/useReducedMotion';
import type { Priority, Task } from '@/lib/types';

const PRIORITY_COLOR: Record<Priority, string> = {
  high:   '#ff7a18',
  medium: '#ffa564',
  low:    '#b8d4e3',
};

// Spine vertical extent. At camera z=7, fov 38°, the visible world height is
// ~4.82, but the comfortable area below the page header and above the bottom
// padding is ~3.5. 2.6 keeps every orb inside the centre column on every
// desktop viewport size, with margin to spare.
const SPINE_HEIGHT = 2.6;
const SPINE_RADIUS = 0.012;
const MAX_ORBS = 5;

// Orbit radius — orbs swing in the xz plane around their fixed y. Tuned so
// the screen-space horizontal extent stays well inside the centre column
// even on a 1920-wide viewport.
const ORBIT_RADIUS = 0.55;

// Vertical column of orbs, each orbiting around the spine in the xz plane.
// y is static (orbs don't drift up/down off-screen), x and z swing on a
// circle of ORBIT_RADIUS. Each orb has its own initial angle (evenly
// distributed) and a slightly varied speed so the constellation has motion
// without going synchronously round-and-round.
export default function TimeSpine({ visible = true }: { visible?: boolean }) {
  const tasks = useTaskStore((s) => s.tasks);
  const selectedTaskId = useUIStore((s) => s.selectedTaskId);
  const selectTask = useUIStore((s) => s.selectTask);

  const spineGeo = useMemo(() => {
    const curve = new THREE.LineCurve3(
      new THREE.Vector3(0,  SPINE_HEIGHT / 2, 0),
      new THREE.Vector3(0, -SPINE_HEIGHT / 2, 0),
    );
    return new THREE.TubeGeometry(curve, 8, SPINE_RADIUS, 8, false);
  }, []);

  // Top N tasks by priority + recency. Selected always included so the
  // ring is visible even when the user picks a low-priority stream.
  const orbTasks = useMemo<Task[]>(() => {
    const open = tasks.filter((t) => !t.completed_at);
    const sorted = [...open].sort((a, b) => {
      const w = weight(b.priority) - weight(a.priority);
      if (w !== 0) return w;
      return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    });
    const top = sorted.slice(0, MAX_ORBS);
    if (selectedTaskId && !top.some((t) => t.id === selectedTaskId)) {
      const sel = open.find((t) => t.id === selectedTaskId);
      if (sel) return [sel, ...top.slice(0, MAX_ORBS - 1)];
    }
    return top;
  }, [tasks, selectedTaskId]);

  if (!visible) return null;

  return (
    <group>
      {/* The spine line itself — a simple amber thread, no rotation. */}
      <mesh geometry={spineGeo}>
        <meshBasicMaterial color="#ff8a3d" transparent opacity={0.38} />
      </mesh>

      {orbTasks.map((task, i, arr) => {
        const t = arr.length === 1 ? 0.5 : i / (arr.length - 1);
        // Even distribution of starting angles around the spine.
        const startAngle = (i / arr.length) * Math.PI * 2;
        // Speed varies subtly per orb so they slowly drift relative to one
        // another instead of orbiting in perfect lockstep.
        const speed = 0.11 + (hash01(task.id) * 0.06);
        return (
          <Orb
            key={task.id}
            title={task.title}
            t={t}
            startAngle={startAngle}
            speed={speed}
            color={PRIORITY_COLOR[task.priority]}
            selected={task.id === selectedTaskId}
            onSelect={() => selectTask(task.id)}
          />
        );
      })}
    </group>
  );
}

interface OrbProps {
  title: string;
  t: number;
  startAngle: number;
  speed: number;
  color: string;
  selected: boolean;
  onSelect: () => void;
}

function Orb({
  title, t, startAngle, speed, color, selected, onSelect,
}: OrbProps) {
  const groupRef  = useRef<THREE.Group>(null);
  const orbRef    = useRef<THREE.Mesh>(null);
  const haloRef   = useRef<THREE.Mesh>(null);
  const ringRef   = useRef<THREE.Mesh>(null);
  const tetherRef = useRef<THREE.Mesh>(null);
  const [hovered, setHovered] = useState(false);
  const reduced = useReducedMotion();

  const y = SPINE_HEIGHT / 2 - t * SPINE_HEIGHT;

  useFrame(({ clock }) => {
    const time = clock.elapsedTime;

    // Orbit in xz plane. y stays static so orbs never drift off-screen.
    const a = reduced ? startAngle : startAngle + time * speed;
    const x = Math.cos(a) * ORBIT_RADIUS;
    const z = Math.sin(a) * ORBIT_RADIUS;
    if (groupRef.current) {
      groupRef.current.position.set(x, y, z);
    }

    // Scale lerps toward target on hover/select.
    const targetScale = selected ? 1.30 : hovered ? 1.15 : 1.0;
    if (orbRef.current) {
      const cur = orbRef.current.scale.x;
      const next = reduced ? targetScale : cur + (targetScale - cur) * 0.15;
      orbRef.current.scale.setScalar(next);
    }

    // Halo only blooms when selected or hovered.
    if (haloRef.current && orbRef.current) {
      const targetOp = selected || hovered ? 0.26 : 0.08;
      const mat = haloRef.current.material as THREE.MeshBasicMaterial;
      mat.opacity = reduced
        ? targetOp
        : mat.opacity + (targetOp - mat.opacity) * 0.10;
      haloRef.current.scale.setScalar(orbRef.current.scale.x * 2.2);
    }

    // Selection ring — the focal animation.
    if (ringRef.current) {
      const mat = ringRef.current.material as THREE.MeshBasicMaterial;
      if (reduced) {
        mat.opacity = 0.55;
        ringRef.current.rotation.z = 0;
      } else {
        mat.opacity = 0.40 + 0.28 * Math.sin(time * 1.4);
        ringRef.current.rotation.z = time * 0.35;
      }
    }

    // Tether — short line from the spine (0, y, 0) toward the orb (x, y, z).
    // We position the cylinder at the midpoint, point its local Y down the
    // tether direction (lookAt + rotateX), and stretch to the right length.
    if (tetherRef.current) {
      tetherRef.current.position.set(x / 2, y, z / 2);
      tetherRef.current.lookAt(0, y, 0);
      tetherRef.current.rotateX(Math.PI / 2);
      const len = Math.max(0.01, Math.hypot(x, z) - 0.15);
      tetherRef.current.scale.set(1, len, 1);
    }
  });

  const onPointerOver = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setHovered(true);
    if (typeof document !== 'undefined') document.body.style.cursor = 'pointer';
  };
  const onPointerOut = (e: { stopPropagation: () => void }) => {
    e.stopPropagation();
    setHovered(false);
    if (typeof document !== 'undefined') document.body.style.cursor = 'auto';
  };

  return (
    <>
      {/* Tether lives in world space so it can stretch from a fixed point on
          the spine to the orbiting orb without inheriting the orb's group
          transform. */}
      <mesh ref={tetherRef}>
        <cylinderGeometry args={[0.004, 0.004, 1, 6]} />
        <meshBasicMaterial color={color} transparent opacity={0.24} />
      </mesh>

      <group ref={groupRef}>
        {/* Halo — subtle additive glow behind the bead */}
        <mesh ref={haloRef}>
          <sphereGeometry args={[0.13, 24, 24]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={0.08}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>

        {/* Selection ring — only mounted while selected so the pulse is unambiguous */}
        {selected && (
          <mesh ref={ringRef}>
            <torusGeometry args={[0.22, 0.007, 12, 64]} />
            <meshBasicMaterial
              color="#ff8a3d"
              transparent
              opacity={0.55}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        )}

        {/* The orb body */}
        <mesh
          ref={orbRef}
          onPointerOver={onPointerOver}
          onPointerOut={onPointerOut}
          onClick={(e) => { e.stopPropagation(); onSelect(); }}
        >
          <sphereGeometry args={[0.15, 48, 48]} />
          <meshStandardMaterial
            color={color}
            emissive={color}
            emissiveIntensity={selected ? 1.30 : hovered ? 1.00 : 0.85}
            roughness={0.32}
            metalness={0.05}
            toneMapped={false}
          />
        </mesh>

        {/* Floating chip — appears to the right of the orb. Follows the
            orb because it's inside the orb's group transform. */}
        {(hovered || selected) && (
          <Html
            position={[0.30, 0, 0]}
            distanceFactor={6}
            style={{ pointerEvents: 'none', transform: 'translate(0, -50%)' }}
          >
            <div
              className={
                'whitespace-nowrap rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-md shadow-[0_6px_20px_rgba(0,0,0,0.5)] ' +
                (selected
                  ? 'border-amber/50 bg-bg-deep/85 text-amber'
                  : 'border-line bg-bg-deep/80 text-ink')
              }
            >
              {title}
            </div>
          </Html>
        )}
      </group>
    </>
  );
}

function weight(p: Priority): number {
  return p === 'high' ? 3 : p === 'medium' ? 2 : 1;
}

// Deterministic 0..1 hash from a string — used to vary orbit speeds without
// random per-render values (which would jitter every frame).
function hash01(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return (h % 1000) / 1000;
}
