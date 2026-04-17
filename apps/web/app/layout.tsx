import type { Metadata } from 'next';
import './globals.css';
import { ToastHost } from '@/components/ui/toast';
import { AuthProvider } from '@/src/auth/AuthProvider';

export const metadata: Metadata = {
  title: 'Moulinator — cooperative CI for Epitech',
  description:
    'A deliberately small CI companion: run the mouli on your repo, see the trace, contribute a test.',
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
          <ToastHost />
        </AuthProvider>
      </body>
    </html>
  );
}
