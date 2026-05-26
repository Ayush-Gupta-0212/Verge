import ResetPasswordClient from '@/components/verge/ResetPasswordClient';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Reset password — Verge',
  description: 'Set a new password for your Verge account.',
};

export default function ResetPasswordPage() {
  return (
    <main className="relative h-screen w-screen overflow-hidden bg-bg">
      <ResetPasswordClient />
    </main>
  );
}
