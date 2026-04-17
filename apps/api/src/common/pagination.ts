/**
 * Cursor pagination helpers. Cursor format: base64(JSON({ createdAt, id })).
 * Opaque to clients; do not parse on the web side.
 */
export interface Cursor {
  createdAt: string;
  id: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

export class InvalidCursorError extends Error {
  constructor() {
    super('invalid_cursor');
    this.name = 'InvalidCursorError';
  }
}

/**
 * Decodes a cursor. Returns null when no cursor was provided.
 * Throws InvalidCursorError when the cursor is present but malformed —
 * callers should translate that to a 422 rather than letting a bad
 * client crash a Prisma query.
 */
export function decodeCursor(raw: string | undefined): Cursor | null {
  if (!raw) return null;
  let parsed: Partial<Cursor>;
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    parsed = JSON.parse(json) as Partial<Cursor>;
  } catch {
    throw new InvalidCursorError();
  }
  if (typeof parsed.createdAt !== 'string' || typeof parsed.id !== 'string') {
    throw new InvalidCursorError();
  }
  if (!ULID_REGEX.test(parsed.id)) {
    throw new InvalidCursorError();
  }
  const ts = Date.parse(parsed.createdAt);
  if (Number.isNaN(ts)) {
    throw new InvalidCursorError();
  }
  return { createdAt: parsed.createdAt, id: parsed.id };
}

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export function clampLimit(raw: number | undefined): number {
  if (!raw || Number.isNaN(raw)) return DEFAULT_PAGE_LIMIT;
  return Math.max(1, Math.min(MAX_PAGE_LIMIT, Math.trunc(raw)));
}
