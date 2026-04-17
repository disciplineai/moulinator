export function shortSha(sha: string | null | undefined, len = 7): string {
  if (!sha) return '—';
  return sha.slice(0, len);
}

export function relTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  const diff = Date.now() - d.getTime();
  const abs = Math.abs(diff);
  const sign = diff < 0 ? 'in ' : '';
  const suffix = diff >= 0 ? ' ago' : '';
  const units: Array<[number, string]> = [
    [31_536_000_000, 'y'],
    [2_592_000_000, 'mo'],
    [604_800_000, 'w'],
    [86_400_000, 'd'],
    [3_600_000, 'h'],
    [60_000, 'min'],
    [1000, 's'],
  ];
  for (const [ms, u] of units) {
    if (abs >= ms) {
      const value = Math.floor(abs / ms);
      return `${sign}${value}${u}${suffix}`;
    }
  }
  return 'just now';
}

export function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms)) return '—';
  if (ms < 1000) return `${ms} ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(s < 10 ? 1 : 0)} s`;
  const m = Math.floor(s / 60);
  const r = Math.round(s - m * 60);
  return `${m} min ${r} s`;
}

export function fmtBytes(bytes: number): string {
  if (!Number.isFinite(bytes)) return '—';
  const units = ['B', 'kB', 'MB', 'GB'];
  let i = 0;
  let v = bytes;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
}

export function shortDigest(digest: string | null | undefined): string {
  if (!digest) return '—';
  const hex = digest.replace(/^sha256:/, '');
  return `sha256:${hex.slice(0, 10)}…`;
}

export function repoName(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname.replace(/^\//, '').replace(/\.git$/, '');
  } catch {
    return url;
  }
}
