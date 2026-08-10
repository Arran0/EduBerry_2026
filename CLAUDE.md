# EduBerry

School management SaaS — tasks, LMS, assessments, attendance, fees, salary,
leave, transport and announcements. Used daily by students, teachers and admins,
mostly on phones.

## Stack

Next.js 14 (App Router) · TypeScript · Tailwind · Supabase (Postgres + Auth +
RLS + Storage) · framer-motion · lucide-react · Vercel.

Dev server runs on **port 8081** (`npm run dev`), not 3000.

## Layout

| Path | Contains |
|---|---|
| `src/app/` | Routes. Feature folders + `api/*/route.ts` handlers. |
| `src/components/` | Feature-grouped components; `ui/` holds shared primitives. |
| `src/lib/` | Data access and domain logic, one module per feature. |
| `src/hooks/` | Shared React hooks. |
| `supabase-migrations/` | Schema migrations, one `.sql` per change. |

Data access belongs in `src/lib/<feature>.ts`, not inline in components. Add new
queries to the existing module for that feature.

## Commands

```bash
npm run dev          # localhost:8081
npm run build        # production build — run before declaring work done
npm run lint
npx tsc --noEmit     # type check
```

There is no test suite yet. Verify UI changes in a real browser (see Playwright
below) rather than assuming a passing build means a working screen.

## Security — read this before touching data code

This app holds **student PII**: names, photos, guardian contacts, attendance,
marks, fee and salary records. Treat every data path accordingly.

- **RLS is the security boundary.** Every new table needs policies in the same
  migration that creates it. A table without RLS is a data leak.
- **`SUPABASE_SERVICE_ROLE_KEY` bypasses RLS entirely.** It may only be used in
  server-only code (`route.ts`, server actions). It must never reach a client
  component, a `NEXT_PUBLIC_*` var, or a log line.
- **Authorize inside every API route.** Verify the caller's session and role
  server-side. Never trust a role passed in a request body.
- **Payment webhooks** (`api/*/webhook/route.ts`) must verify signatures before
  acting, and must be idempotent — providers retry.
- `.env*` and `/data/**` are gitignored and hold real records. Do not read, copy,
  or paste their contents into code, commits, or issues.

## Database work

The Supabase MCP server is configured in `.mcp.json`, scoped to this project and
**read-only** — use it to inspect schema, run `SELECT`s, read logs, and check
security advisors.

Schema changes are written as a new file in `supabase-migrations/` and applied
deliberately by a human. Do not attempt to mutate the hosted database directly;
read-only mode is intentional, because this project's database has production
student data in it.

After a schema change, ask the MCP server for security advisors — it flags
missing RLS and overly permissive policies.

## UI work

**The `eduberry-ui` skill defines the design language. Use it for any work that
renders markup** — new screens, restyles, and design review alike.

In short: compose the primitives in `globals.css` (`.glass-card`, `.pressable`,
`.icon-chip`, `.headline`, `.eyebrow`) rather than writing ad-hoc glass; use
`ModalShell` for every popup; keep three ink levels and one accent per page. The
gradient-heavy legacy classes (`btn-primary`, `mesh-bg`, `gradient-text`) are
deprecated — migrate them opportunistically when you touch a file.

Design for phones first, including empty, loading and error states.

## Browser verification

Playwright CLI is available for driving the running app:

```bash
npm run dev
playwright-cli open http://localhost:8081/tasks
playwright-cli screenshot --full-page after.png
```

Check a 390px viewport as well as desktop.

## Conventions

- TypeScript throughout; avoid `any` in `src/lib`.
- Client components need `'use client'`; keep them as small as possible.
- Icons come from `lucide-react`.
- Currency is INR, dates are `en-IN`.
- Comments explain *why*, not *what* — match the density already in
  `ModalShell.tsx` and `globals.css`.
