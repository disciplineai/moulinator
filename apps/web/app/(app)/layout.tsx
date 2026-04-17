'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useAuth } from '@/src/auth/AuthProvider';
import { Spinner } from '@/components/ui/Spinner';

const NAV = [
  { href: '/dashboard', label: 'dashboard', code: '00' },
  { href: '/repos', label: 'repos', code: '01' },
  { href: '/credentials', label: 'credentials', code: '02' },
  { href: '/contribute', label: 'contribute', code: '03' },
];

const ADMIN_NAV = { href: '/admin/projects', label: 'admin', code: '0A' };

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (!loading && !user) {
      router.replace(`/login?next=${encodeURIComponent(pathname || '/dashboard')}`);
    }
  }, [loading, user, router, pathname]);

  if (loading || !user) {
    return (
      <main className="flex min-h-screen items-center justify-center">
        <Spinner label="Opening archive" />
      </main>
    );
  }

  const handleLogout = async () => {
    await logout();
    router.replace('/login');
  };

  return (
    <div className="relative flex min-h-screen flex-col">
      <TopBar user={user} onLogout={handleLogout} />
      <div className="mx-auto grid w-full max-w-[1360px] flex-1 grid-cols-1 gap-0 px-6 md:grid-cols-[220px_1fr]">
        <SideNav pathname={pathname} isAdmin={user.role === 'admin'} />
        <main className="py-8 md:pl-10">{children}</main>
      </div>
      <Footer />
    </div>
  );
}

function TopBar({
  user,
  onLogout,
}: {
  user: { email: string; role: string };
  onLogout: () => void | Promise<void>;
}) {
  return (
    <header className="border-b border-ink/10 bg-parchment-50">
      <div className="mx-auto flex max-w-[1360px] items-center justify-between px-6 py-4">
        <Link href="/dashboard" className="inline-flex items-center gap-3">
          <span className="stamp stamp-solid">mouli / nator</span>
          <span className="eyebrow hidden text-ink-400 md:inline">cooperative CI · v0.1</span>
        </Link>
        <div className="flex items-center gap-4">
          <div className="hidden text-right font-mono text-[11px] leading-tight text-ink-400 md:block">
            <div className="tabular">{user.email}</div>
            <div className="eyebrow mt-0.5 text-ember">role · {user.role}</div>
          </div>
          <button onClick={onLogout} className="btn-ghost">
            sign out
          </button>
        </div>
      </div>
    </header>
  );
}

function SideNav({ pathname, isAdmin }: { pathname: string | null; isAdmin: boolean }) {
  const nav = isAdmin ? [...NAV, ADMIN_NAV] : NAV;
  return (
    <aside className="hidden border-r border-ink/10 pr-8 pt-10 md:block">
      <div className="eyebrow mb-6 text-ink-400">— navigation</div>
      <ul className="flex flex-col gap-1">
        {nav.map((n) => {
          const active = pathname?.startsWith(n.href);
          return (
            <li key={n.href}>
              <Link
                href={n.href}
                className={`group flex items-center justify-between gap-2 rounded-[2px] px-2 py-2 font-mono text-sm ${
                  active ? 'bg-ink text-parchment-50' : 'text-ink hover:bg-parchment-50'
                }`}
              >
                <span className="flex items-center gap-3">
                  <span
                    className={`text-[10px] tabular opacity-70 ${active ? '' : 'text-ember'}`}
                  >
                    §{n.code}
                  </span>
                  <span>{n.label}</span>
                </span>
                <span className={`opacity-0 transition group-hover:opacity-100 ${active ? 'opacity-100' : ''}`}>
                  →
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
      <div className="mt-10 border-t border-ink/10 pt-6">
        <div className="eyebrow mb-3 text-ink-400">— invariants</div>
        <ul className="flex flex-col gap-2 font-mono text-[11px] leading-5 text-ink-400">
          <li>PATs never leave the control plane.</li>
          <li>Every run pins tests &amp; runner.</li>
          <li>Terminal states are immutable.</li>
        </ul>
      </div>
    </aside>
  );
}

function Footer() {
  return (
    <footer className="mx-auto w-full max-w-[1360px] px-6 pb-10 pt-6">
      <div className="flex flex-wrap items-center justify-between gap-4 border-t border-ink/10 pt-4 font-mono text-[11px] text-ink-400">
        <div>
          Moulinator MVP · <span className="tabular">© 2026</span> · terminal states are immutable
        </div>
        <div className="flex items-center gap-4">
          <Link href="/credentials" className="link-under">
            credentials
          </Link>
          <Link href="/repos" className="link-under">
            repos
          </Link>
          <Link href="/contribute" className="link-under">
            contribute
          </Link>
        </div>
      </div>
    </footer>
  );
}
