'use client';

import { Canvas, useFrame } from '@react-three/fiber';
import { Suspense, useEffect } from 'react';
import * as THREE from 'three';
import TimeSpine from './TimeSpine';
import FocusSphere from './FocusSphere';
import { useUIStore } from '@/stores/useUIStore';
import { useIsMobile } from '@/lib/useBreakpoint';

// Verge canvas — transparent so the body's grid + amber ground glow read
// through. Data loads + auth init happen in HUD; this component only handles
// 3D content and pointer/wheel subscriptions.
export default function VergeCanvas() {
  const view = useUIStore((s) => s.view);
  const focusMode = useUIStore((s) => s.focusMode);
  const setPointer = useUIStore((s) => s.setPointer);
  const bumpScroll = useUIStore((s) => s.bumpScroll);
  const isMobile = useIsMobile();

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      setPointer(
        (e.clientX / window.innerWidth)  * 2 - 1,
        (e.clientY / window.innerHeight) * 2 - 1,
      );
    };
    const onWheel = (e: WheelEvent) => bumpScroll(e.deltaY * 0.0003);
    window.addEventListener('pointermove', onPointer);
    window.addEventListener('wheel', onWheel, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onPointer);
      window.removeEventListener('wheel', onWheel);
    };
  }, [setPointer, bumpScroll]);

  return (
    <Canvas
      gl={{
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
      }}
      dpr={[1, 2]}
      camera={{ position: [0, 0, 7], fov: 38, near: 0.1, far: 100 }}
      style={{ background: 'transparent' }}
    >
      <ambientLight intensity={0.35} />
      <directionalLight position={[-3, 3, 4]} intensity={0.6} color="#fff2e0" />
      <directionalLight position={[3, -2, -1]} intensity={0.35} color="#ff7a18" />

      <Suspense fallback={null}>
        <ScrollTick />
        {/* The TimeSpine now renders behind the master-detail Nexus layout
            rather than in a dedicated column. The cards' backdrop-blur turns
            it into an ambient cosmic glow; the central thread + the orbs
            that orbit through the gap between cards stay crisp and remain
            clickable. Hidden on mobile (no room) and in focus mode (sphere
            takes over). */}
        <TimeSpine  visible={view === 'nexus' && !focusMode && !isMobile} />
        <FocusSphere visible={focusMode} />
      </Suspense>
    </Canvas>
  );
}

// Drives the UI store's scroll spring once per frame — single source of truth.
function ScrollTick() {
  useFrame((_, dt) => useUIStore.getState().tickScroll(dt));
  return null;
}
