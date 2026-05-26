'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { fluidSphereFragment, fluidSphereVertex } from '@/components/shaders/fluidSphere';
import { useTimerStore } from '@/stores/useTimerStore';
import { useReducedMotion } from '@/lib/useReducedMotion';

// Focus sphere — matte dark body with an amber rim and a slow 8-second
// guided-breathing pulse. The sphere scales gently in/out like a breath,
// the rim glow pulses with it, and three concentric "sonar" rings radiate
// outward on a 6-second cadence. Together it feels like a calm metronome.

const BASE_SCALE = 1.5;
const ENTRY_DURATION = 1.2;  // seconds
const BREATH_PERIOD  = 8.0;  // seconds — slow inhale/exhale
const BREATH_AMPLITUDE = 0.055; // ±5.5% scale around base

export default function FocusSphere({ visible = true }: { visible?: boolean }) {
  const mesh    = useRef<THREE.Mesh>(null);
  const matRef  = useRef<THREE.ShaderMaterial>(null);
  const mountedAt = useRef<number | null>(null);
  const reduced = useReducedMotion();

  const uniforms = useMemo(
    () => ({
      uTime:      { value: 0 },
      uRim:       { value: new THREE.Color('#ff8a3d') },
      uHighlight: { value: new THREE.Color('#fff2e0') },
      uPulse:     { value: 0 },
    }),
    [],
  );

  useFrame(({ clock }) => {
    const m = mesh.current;
    const mat = matRef.current;
    if (!m || !mat) return;

    if (mountedAt.current === null) mountedAt.current = clock.elapsedTime;
    const tSince = clock.elapsedTime - mountedAt.current;

    // Entry scale-in (ease-out cubic). With reduced motion the sphere snaps in.
    const entry = reduced ? 1 : Math.min(1, tSince / ENTRY_DURATION);
    const entryEased = reduced ? 1 : 1 - Math.pow(1 - entry, 3);

    // 8s guided-breathing cycle — held steady under reduced motion.
    const omega = (2 * Math.PI) / BREATH_PERIOD;
    const breath = reduced
      ? 0.6
      : 0.5 + 0.5 * Math.cos(omega * tSince + Math.PI);
    const scale = BASE_SCALE * entryEased * (1 + (breath - 0.5) * 2 * BREATH_AMPLITUDE);

    m.scale.setScalar(scale);
    if (reduced) {
      m.rotation.y = 0;
      m.rotation.x = 0;
    } else {
      m.rotation.y = clock.elapsedTime * 0.04;
      m.rotation.x = Math.sin(clock.elapsedTime * 0.10) * 0.05;
    }

    const timer = useTimerStore.getState();
    mat.uniforms.uTime.value = clock.elapsedTime;
    const target = breath * (timer.running ? 1 : 0.55);
    mat.uniforms.uPulse.value += (target - mat.uniforms.uPulse.value) * (reduced ? 0.2 : 0.05);
  });

  if (!visible) return null;

  return (
    <group>
      <mesh ref={mesh} scale={0}>
        <sphereGeometry args={[1, 96, 96]} />
        <shaderMaterial
          ref={matRef}
          vertexShader={fluidSphereVertex}
          fragmentShader={fluidSphereFragment}
          uniforms={uniforms}
        />
      </mesh>
      <BreathingRings />
      <SoftHalo />
    </group>
  );
}

/* Three thin amber rings that pulse outward from the sphere on 6s phase
   offsets — like slow sonar pings. Each ring scales from the sphere edge
   to ~1.8× and fades to zero. */
function BreathingRings() {
  const refs = [useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null), useRef<THREE.Mesh>(null)];
  const mountedAt = useRef<number | null>(null);

  useFrame(({ clock }) => {
    if (mountedAt.current === null) mountedAt.current = clock.elapsedTime;
    const tSince = clock.elapsedTime - mountedAt.current;
    const entry = Math.min(1, tSince / (ENTRY_DURATION + 0.3));

    const t = clock.elapsedTime;
    const period = 6.0;
    refs.forEach((ref, i) => {
      const phase = (((t / period) + i / refs.length) % 1);
      if (!ref.current) return;
      const scale = BASE_SCALE * (1.0 + phase * 0.8);
      ref.current.scale.setScalar(scale);
      const mat = ref.current.material as THREE.MeshBasicMaterial;
      // Ease-out fade so rings dim faster toward the end.
      const fade = 1 - Math.pow(phase, 1.8);
      mat.opacity = fade * 0.28 * entry;
    });
  });

  return (
    <>
      {refs.map((ref, i) => (
        <mesh key={i} ref={ref} rotation={[0, 0, 0]}>
          <ringGeometry args={[1, 1.015, 96]} />
          <meshBasicMaterial
            color="#ff8a3d"
            transparent
            opacity={0}
            side={THREE.DoubleSide}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </>
  );
}

/* Large additive halo behind the sphere — a soft amber bloom that breathes
   in sync. Adds depth without being noticeable as a separate object. */
function SoftHalo() {
  const ref = useRef<THREE.Mesh>(null);
  const mountedAt = useRef<number | null>(null);

  useFrame(({ clock }) => {
    if (mountedAt.current === null) mountedAt.current = clock.elapsedTime;
    const tSince = clock.elapsedTime - mountedAt.current;
    const entry = Math.min(1, tSince / 1.6);
    const omega = (2 * Math.PI) / BREATH_PERIOD;
    const breath = 0.5 + 0.5 * Math.cos(omega * tSince + Math.PI);
    if (ref.current) {
      ref.current.scale.setScalar((BASE_SCALE * 2.2) * (0.9 + breath * 0.15) * entry);
      const mat = ref.current.material as THREE.MeshBasicMaterial;
      mat.opacity = (0.04 + breath * 0.05) * entry;
    }
  });

  return (
    <mesh ref={ref}>
      <sphereGeometry args={[1, 32, 32]} />
      <meshBasicMaterial
        color="#ff8a3d"
        transparent
        opacity={0}
        depthWrite={false}
        blending={THREE.AdditiveBlending}
      />
    </mesh>
  );
}
