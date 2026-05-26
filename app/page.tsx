import VergeCanvas from '@/components/verge/VergeClient';
import HUD from '@/components/ui/HUD';

export default function Home() {
  return (
    <main className="relative h-screen w-screen overflow-hidden">
      <VergeCanvas />
      <HUD />
    </main>
  );
}
