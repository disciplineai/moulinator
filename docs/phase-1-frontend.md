# Phase 1 — frontend (apps/web)

**Owner:** frontend-designer agent. **Consumers of contracts:** `openapi.yaml`, `docs/ARCHITECTURE.md`, `docs/run-state-machine.md`.

## What shipped

A Next.js 14 App Router application at `apps/web/` that covers the full student flow: signup → dashboard → credentials → repos → trigger → live run → contribute. Eight protected routes + a landing page, all typecheck/lint/build clean and render against either the real API (proxied through the Next rewrite) or a local mock fixture layer.

### Screen inventory

| Route | File | Purpose |
|---|---|---|
| `/` | `app/page.tsx` | Public marketing / onboarding copy. |
| `/signup` | `app/(auth)/signup/page.tsx` | Email + password ≥ 10 chars, live strength meter, HTTP warning. |
| `/login` | `app/(auth)/login/page.tsx` | Sign in with `?next=` handling for middleware redirects. |
| `/dashboard` | `app/(app)/dashboard/page.tsx` | Welcome banner, three status tiles (account / credentials / repos), recent-runs feed. |
| `/credentials` | `app/(app)/credentials/page.tsx` | List PATs (label, scopes, last-used), add-new form with HTTPS + "never-shown-again" warnings, delete. |
| `/repos` | `app/(app)/repos/page.tsx` | Table of repositories; register form picks project + URL + default branch. |
| `/repos/[id]` | `app/(app)/repos/[id]/page.tsx` | Repo detail, trigger run by 40-char SHA, recent-runs history table with the state-machine badge. |
| `/runs/[id]` | `app/(app)/runs/[id]/page.tsx` | Run detail with reproducibility pin sheet, live polling with backoff while non-terminal, test-case drill-down with preview, artifact downloads via presigned URL. |
| `/contribute` | `app/(app)/contribute/page.tsx` | Contribution PRs on the tests-repo with `open/merged/rejected` filter and register-new form. |

## Design approach

The default AI look (soft purple-to-indigo gradients, rounded-2xl white cards, Inter everywhere) is explicitly avoided. Moulinator's subject matter is builds, traces, logs, syslog-style events — the UI leans into that with an editorial-terminal feel:

- **Palette.** Parchment `#F2EDE3` base, warm off-black ink `#0F0E0C`, ember `#E25822` accent. State colors are warm earth tones (moss for passed, rust for failed, ochre for timed-out, sky for open contributions). No blue-to-purple anywhere.
- **Type.** `Fraunces` (variable serif) for display copy, italics used for warmth; `JetBrains Mono` for body, tabular-numerals on everywhere we show counts, SHAs, digests, durations. Pair deliberately violates the "sans-serif display / serif body" cliché.
- **Language of hierarchy.** Tiny uppercase eyebrows (`— dashboard`), ember dashes as rhetorical markers, § numbered nav items (`§00`, `§01`, …), ASCII-drawn sample trace in the auth layout specimen column. Status badges are styled as rubber-stamps with hard borders — not pill badges.
- **Motion.** Restraint. Only three animations: `slide-in` for toasts/reveals, `pulse-soft` for live/running states, `tick` for terminal caret spinners. No scroll jackery, no glassmorphism.
- **Texture.** A subtle multiply-blended SVG grain over the whole app so the parchment feels like paper, not flat cream. Ruled-paper background utility for large content blocks.

### Things explicitly rejected

- shadcn card-only layouts.
- Purple/blue gradients, "AI chat" aesthetic.
- Rounded-2xl everywhere — corners are 2px at most.
- Inter/Roboto/Geist.
- Generic top-tab + sidebar dashboard layout with no typographic rhythm.

## Architecture notes

### Typed API client

- `pnpm gen:api` runs `openapi-typescript ../../openapi.yaml -o src/api/generated/schema.d.ts`. The generator is wired as `predev`, `prebuild`, and `pretypecheck`, so every code path regenerates from the single-source-of-truth contract. The output directory is gitignored per root `.gitignore`.
- Request/response shapes are never hand-written. The only place they're consumed directly is via `components['schemas'][…]` from the generated file.
- `src/api/client.ts` wraps `openapi-fetch` with two middlewares: a token-attach on every request and a 401 refresh-retry that serializes concurrent refreshes into a single in-flight promise.

### Auth

- `AuthProvider` holds the current user and subscribes to the in-memory `tokenStore`.
- Access token lives in memory only. A lightweight client-side `moulinator_session` cookie is set alongside it so Next middleware can gate protected routes at the edge without needing the backend's httpOnly refresh cookie to flow through.
- The refresh token: for MVP the backend returns it in the `AuthTokens` body and we keep it in memory. The rules explicitly forbid localStorage. Production guidance (tracked for Phase 2): have `/auth/login` and `/auth/refresh` set an httpOnly `Set-Cookie: refresh_token=…` and stop returning the refresh token in JSON. That is a backend change, not a frontend one, but noted here as the intended terminal state.
- `middleware.ts` redirects un-cookied requests on `/dashboard|/repos|/credentials|/runs|/contribute` to `/login?next=…`, and shoves authenticated users away from `/login` and `/signup`.

### Live run updates

`useRun(id)` polls `GET /runs/:id` on a backoff: start at 2 s, grow 750 ms per attempt, cap at 15 s. It stops automatically when the run transitions into any terminal state (`passed | failed | error | cancelled | timed_out`). The non-terminal badges (`queued | running`) are visually distinct from terminals — animated dot, `LIVE` micronumeral — so the user always knows whether what they see will change.

### Mock fallback

Every data hook has a `try-catch` that, when `NEXT_PUBLIC_USE_MOCKS=1` is set, falls through to a fixture module (`src/api/mocks.ts`). This lets frontend dev proceed with zero backend. Flip the flag off to talk to the real API.

### Accessibility

- Every form input has a `<label>` or `aria-label`; errors are wired to `aria-invalid` + `aria-describedby`.
- All interactive elements have a visible focus ring (`outline: 2px solid var(--ember)`).
- Status badges include `role="status"` + `aria-label` so screen readers announce "Run status: failed" instead of the glyph.
- Contrast: ink-on-parchment is ≥ 12:1, ember-on-parchment ~ 4.6:1 (AA for non-large), status-badge fills use explicit light/dark foreground pairs validated at AA.

## How to run locally

```bash
pnpm install
pnpm -C apps/web gen:api              # generates src/api/generated/schema.d.ts
PUBLIC_API_URL=http://localhost:3001 pnpm -C apps/web dev
# or, to browse without a running API:
NEXT_PUBLIC_USE_MOCKS=1 pnpm -C apps/web dev
```

Validation:

```bash
pnpm -C apps/web typecheck
pnpm -C apps/web lint
pnpm -C apps/web build
```

All three are green on first run.

## Known gaps / deferred

1. **Refresh token transport.** See above — backend is expected to move to httpOnly cookie in Phase 2. Today the frontend keeps it in memory; it survives tab life but not a full refresh (next session must re-authenticate). Acceptable for MVP.
2. **No websocket run feed.** Polling is the contract; WS is explicitly out of scope per instructions.
3. **Project list endpoint.** The UI relies on `GET /projects` to label rows and populate selects. If the backend returns `[]` before fixtures are seeded, the repo rows show "unknown" and the register form's project dropdown is empty — this is only a concern during devops' initial seed window.
4. **No pagination UI yet.** `GET /repos/{id}/runs` returns a cursor, but the detail page currently fetches only the first 20. If power users ask for it we can add a "load more" link; the hook is already shaped for it.
5. **No email verification / password recovery.** Out of scope per phase-0.
6. **PAT UX.** We warn about HTTP submission, never store the token client-side past the POST, and show scopes + last-used. Rotation is user-owned — copy explicitly says so.

## Env vars consumed

| Name | Where | Purpose |
|---|---|---|
| `PUBLIC_API_URL` | `next.config.js` (server) | Base URL for the API (`/api/proxy/*` rewrite target). |
| `NEXT_PUBLIC_API_URL` | `src/api/client.ts` (browser) | Used for direct fetch and for presigned-artifact URL opens. Set at build time in Docker. |
| `NEXT_PUBLIC_USE_MOCKS` | `src/api/mocks.ts` | When `1`, network failures fall through to local fixture data. |

No new env vars were added. All three are already under `PUBLIC_API_URL`/`NEXT_PUBLIC_API_URL` in the project; `NEXT_PUBLIC_USE_MOCKS` is a dev-only flag that needs no production surface.
