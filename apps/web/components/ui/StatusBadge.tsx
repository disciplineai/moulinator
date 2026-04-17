import type { components } from '@/src/api/generated/schema';

type RunStatus = components['schemas']['Run']['status'];

type Tone = {
  fg: string;
  bg: string;
  border: string;
  label: string;
  glyph: string;
  terminal: boolean;
};

const TONE: Record<RunStatus, Tone> = {
  queued: {
    fg: '#2A2620',
    bg: '#F2EDE3',
    border: '#2A2620',
    label: 'queued',
    glyph: '◌',
    terminal: false,
  },
  running: {
    fg: '#E25822',
    bg: '#FFF4EB',
    border: '#E25822',
    label: 'running',
    glyph: '●',
    terminal: false,
  },
  passed: {
    fg: '#F6F2E9',
    bg: '#4F7942',
    border: '#3F6434',
    label: 'passed',
    glyph: '✓',
    terminal: true,
  },
  failed: {
    fg: '#F6F2E9',
    bg: '#B33A23',
    border: '#8E2E1A',
    label: 'failed',
    glyph: '✕',
    terminal: true,
  },
  error: {
    fg: '#F6F2E9',
    bg: '#2A2620',
    border: '#0F0E0C',
    label: 'error',
    glyph: '!',
    terminal: true,
  },
  cancelled: {
    fg: '#2A2620',
    bg: '#E8E1D2',
    border: '#857C6D',
    label: 'cancelled',
    glyph: '—',
    terminal: true,
  },
  timed_out: {
    fg: '#F6F2E9',
    bg: '#C9962B',
    border: '#A47820',
    label: 'timed out',
    glyph: '⧗',
    terminal: true,
  },
};

type Props = {
  status: RunStatus;
  size?: 'sm' | 'md' | 'lg';
  subtle?: boolean;
};

export function StatusBadge({ status, size = 'sm', subtle = false }: Props) {
  const t: Tone = TONE[status] ?? TONE.queued;
  const sizing =
    size === 'lg'
      ? 'px-3 py-1.5 text-xs'
      : size === 'md'
        ? 'px-2.5 py-1 text-[11px]'
        : 'px-2 py-[2px] text-[10.5px]';
  const style = subtle
    ? {
        color: t.fg,
        background: 'transparent',
        borderColor: t.border,
        borderStyle: 'dashed' as const,
      }
    : {
        color: t.fg,
        background: t.bg,
        borderColor: t.border,
      };

  return (
    <span
      role="status"
      aria-label={`Run status: ${t.label}`}
      className={`inline-flex items-center gap-1.5 rounded-[2px] border font-mono uppercase tracking-[0.14em] font-semibold ${sizing}`}
      style={style}
    >
      <span
        aria-hidden
        className={!t.terminal ? 'animate-pulse-soft' : ''}
        style={{ fontFamily: 'JetBrains Mono', lineHeight: 1 }}
      >
        {t.glyph}
      </span>
      <span>{t.label}</span>
      {!t.terminal && (
        <span aria-hidden className="ml-1 text-[8.5px] opacity-60">
          LIVE
        </span>
      )}
    </span>
  );
}

export function TestCaseBadge({ status }: { status: 'passed' | 'failed' | 'skipped' }) {
  const map = {
    passed: { fg: '#3F6434', bg: '#E6EFD9', glyph: '✓' },
    failed: { fg: '#8E2E1A', bg: '#F4D9D0', glyph: '✕' },
    skipped: { fg: '#5A5247', bg: '#E8E1D2', glyph: '—' },
  }[status];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-[2px] px-1.5 py-0.5 font-mono text-[10.5px] uppercase tracking-[0.12em] font-semibold"
      style={{ color: map.fg, background: map.bg }}
    >
      <span aria-hidden>{map.glyph}</span>
      {status}
    </span>
  );
}
