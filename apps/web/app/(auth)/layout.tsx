import Link from 'next/link';
import { Rule } from '@/components/ui/Rule';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative min-h-screen">
      <div className="mx-auto grid min-h-screen max-w-[1180px] grid-cols-1 gap-0 px-6 lg:grid-cols-[minmax(420px,0.9fr)_1fr]">
        <section className="flex flex-col justify-between py-10">
          <Link href="/" className="eyebrow text-ink-400 hover:text-ember">
            ← back to the public side
          </Link>
          <div>{children}</div>
          <div className="font-mono text-[11px] text-ink-400">
            v0.1.0 · Made for Epitech · No tracking, no analytics.
          </div>
        </section>

        <aside className="hidden items-stretch border-l border-ink/10 pl-10 py-10 lg:flex">
          <Specimen />
        </aside>
      </div>
    </main>
  );
}

function Specimen() {
  return (
    <div className="flex w-full flex-col justify-between">
      <div>
        <div className="eyebrow text-ember">— specimen</div>
        <h2 className="mt-4 font-display text-5xl italic text-ink text-balance">
          One repo, one commit, one verdict.
        </h2>
        <p className="mt-8 max-w-[42ch] font-mono text-sm text-ink-600">
          Moulinator pins every run to an exact <code className="rounded-sm bg-ink/5 px-1">tests_repo_commit_sha</code>
          {' '}and a <code className="rounded-sm bg-ink/5 px-1">runner_image_digest</code>. The same
          inputs always produce the same report. The PAT you paste never leaves the control plane.
        </p>
      </div>

      <figure className="paper-plain mt-10 p-6">
        <Rule label="sample trace" />
        <pre className="mt-4 overflow-hidden font-mono text-[12.5px] leading-5 text-ink-600">
{`▸ case recursive · my_strlen · empty            ok  ( 2 ms)
▸ case recursive · my_strlen · ascii            ok  ( 3 ms)
▸ case recursive · my_revstr · palindrome       FAIL (12 ms)
    expected "aba"
       actual "aba\\x00c"
      stderr: stray byte at index 3
▸ case recursive · my_putnbr · INT_MIN          skip
─── verdict ────────────────────────────────────────── failed
`}
        </pre>
      </figure>
    </div>
  );
}
