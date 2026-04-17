import Link from 'next/link';
import { Rule } from '@/components/ui/Rule';

export default function MarketingHome() {
  return (
    <main className="relative min-h-screen">
      <header className="mx-auto flex max-w-6xl items-center justify-between px-6 pt-8">
        <Logo />
        <nav className="flex items-center gap-4">
          <Link href="/login" className="eyebrow hover:text-ember">
            sign in
          </Link>
          <Link href="/signup" className="btn-primary">
            request access
          </Link>
        </nav>
      </header>

      <section className="mx-auto max-w-6xl px-6 pt-20 pb-16">
        <div className="eyebrow mb-6 text-ember">Cooperative CI · v0.1 · Epitech students only</div>
        <h1 className="font-display text-4xl font-medium leading-[1.02] text-ink md:text-5xl">
          Run the <em className="font-display italic text-ember">mouli</em> on your own repo,
          <br className="hidden md:block" />
          then <span className="underline decoration-ember decoration-2 underline-offset-4">give back a test.</span>
        </h1>
        <p className="mt-6 max-w-[52ch] font-mono text-base text-ink-600 text-pretty">
          Moulinator is not a grader. It runs an automated tester against your git commit,
          shows you the trace the official AT would show, and invites you to open a PR on the
          shared tests-repo when you find a case that should have been there.
        </p>
        <div className="mt-10 flex flex-wrap items-center gap-3">
          <Link href="/signup" className="btn-primary">
            create an account ▸
          </Link>
          <Link href="/login" className="btn-ghost">
            i already have one
          </Link>
        </div>
      </section>

      <section className="mx-auto max-w-6xl px-6">
        <Rule label="the loop" />
        <ol className="mt-10 grid gap-8 md:grid-cols-4">
          {[
            ['01', 'Sign in', 'Email + password. Password ≥ 10 chars.'],
            ['02', 'Paste a PAT', 'We validate it, encrypt it, show scopes + last used.'],
            ['03', 'Pick a project, register a repo', 'Choose CPool / BSQ / etc. We clone on-demand.'],
            ['04', 'Trigger · watch · contribute', 'Live trace, JUnit artifacts, one-click PR link.'],
          ].map(([n, title, body]) => (
            <li key={n} className="relative">
              <div className="absolute -left-1 -top-2 font-display text-3xl italic text-ember opacity-90">{n}</div>
              <div className="ml-8">
                <h3 className="font-display text-xl text-ink">{title}</h3>
                <p className="mt-2 font-mono text-sm leading-relaxed text-ink-400 text-pretty">{body}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <footer className="mx-auto max-w-6xl px-6 py-20">
        <Rule label="colophon" align="right" />
        <div className="mt-4 flex flex-wrap items-center justify-between gap-4 font-mono text-xs text-ink-400">
          <div>
            Set in <em className="italic text-ink">Fraunces</em> &amp; JetBrains Mono · Built for
            Epitech students · MVP.
          </div>
          <div className="tabular">© 2026 · moulinator · v0.1.0</div>
        </div>
      </footer>
    </main>
  );
}

function Logo() {
  return (
    <Link href="/" className="group inline-flex items-center gap-3">
      <span className="stamp stamp-solid">mouli / nator</span>
      <span className="eyebrow text-ink-400 group-hover:text-ember">cooperative CI</span>
    </Link>
  );
}
