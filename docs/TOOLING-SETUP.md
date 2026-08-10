# Tooling setup

Four tools, and they need different things from you. The short version:

| Tool | Where you set it up | What's already committed | What you must do |
|---|---|---|---|
| **Supabase MCP** | Local terminal (one OAuth login) | `.mcp.json` | Approve the server, sign in via browser |
| **Playwright CLI** | Local terminal (global install) | npm scripts, gitignore | `npm i -g`, install browsers + skills |
| **Strix** | GitHub web (secrets) + optional local | `.github/workflows/security-scan.yml` | Add 2 repo secrets |
| **`eduberry-ui` skill** | Nothing — it just works | `.claude/skills/eduberry-ui/` | Nothing |

Only Playwright genuinely requires a terminal. Supabase needs one browser login.
Strix is configured entirely through the GitHub website.

---

## 1. Supabase MCP — database work without leaving the editor

Lets Claude read your schema, run `SELECT`s, inspect logs, and check security
advisors instead of you pasting DDL back and forth.

**Already committed:** `.mcp.json`, pointing at Supabase's hosted MCP endpoint,
scoped to project `tgxxqzeaqxiwoqzopcku`, in read-only mode.

It uses **OAuth, not a personal access token** — so there is no secret in the
repo and nothing to rotate.

### Setup (once, local terminal)

```bash
cd EduBerry_2026
claude
```

On first launch Claude Code detects `.mcp.json` and asks whether to trust the
project's MCP servers — approve it. Then authenticate:

```
/mcp
```

Select **supabase** → **Authenticate**. A browser opens; sign in to Supabase and
approve. Done — it persists.

Verify with `/mcp` again; supabase should read *connected*.

> The OAuth step needs a real terminal that can open a browser. It won't complete
> from Claude on the web.

### Why read-only

The URL in `.mcp.json` carries `read_only=true`. Your database has **live student
records** in it — names, marks, fees, guardian contacts. Read-only means a
misread instruction can't drop a table or rewrite grades.

Schema changes stay in `supabase-migrations/*.sql`, reviewed and applied by you.
That's a deliberate tradeoff, and it's the right one for a production ERP.

If you ever need write access for a scratch project, drop `read_only=true` from
the URL — but don't do it against this project ref.

### Useful things to ask

- "What columns does the `attendance` table have, and what are its RLS policies?"
- "Check Supabase security advisors and tell me which tables are missing RLS."
- "Show me the last 20 auth errors from the logs."
- "Write a migration for X, matching the conventions in `supabase-migrations/`."

The advisors check is worth running now — with ~30 loose `.sql` files in the repo
root, there's a real chance some table shipped without policies.

---

## 2. Playwright CLI — let Claude actually look at the app

Microsoft ships two options. **The CLI is the right one here**, not the MCP
server: it's 4–10× more token-efficient, because MCP loads large tool schemas and
verbose accessibility trees into context on every call.

### Setup (local terminal)

```bash
npm install -g @playwright/cli@latest
playwright-cli install-browser --with-deps
playwright-cli install --skills
```

Requires Node 20+. The last line installs skill files that teach Claude Code the
available commands — that's what makes it usable without you memorizing flags.

### Using it

```bash
npm run dev   # port 8081, not 3000
```

Then ask Claude things like *"open the tasks page at 390px and screenshot it"* or
*"log in as a teacher and check the leave approval flow works."*

Directly:

```bash
playwright-cli open http://localhost:8081/tasks
playwright-cli screenshot --full-page tasks.png
```

This closes the biggest gap in your current workflow: `npm run build` passing
tells you nothing about whether a screen looks right. Pair it with the
`eduberry-ui` skill — Claude can restyle a page, screenshot it, and check its own
work.

Screenshot output is gitignored.

---

## 3. Strix — AI penetration testing

Autonomous agents that explore, exploit and **verify** vulnerabilities, so you
get proof rather than a wall of static-analysis maybes. Genuinely useful for this
app: role-based access across five roles, payment webhooks, and RLS policies
guarding student PII.

**Already committed:** `.github/workflows/security-scan.yml` — quick scan on PRs
to `main`, deep scan Mondays 03:00 UTC, plus manual runs.

### Setup (GitHub web — no terminal)

Go to **Settings → Secrets and variables → Actions → New repository secret** and
add two:

| Name | Value |
|---|---|
| `STRIX_LLM` | a LiteLLM-style `provider/model` id, e.g. `anthropic/claude-sonnet-4-5` or `openai/gpt-5` |
| `LLM_API_KEY` | your API key for that provider |

Check [Strix's README](https://github.com/usestrix/strix) for the model ids it
currently supports before picking one.

That's it. Run it manually the first time via **Actions → Security scan → Run
workflow**, so you see the cost and output before it fires on every PR.

Findings upload as a build artifact, retained 30 days.

### Cost warning

Strix runs agents in a loop — a deep scan burns real tokens. The workflow is set
to `quick` on PRs and `deep` only weekly for that reason. Watch the first few
runs and adjust the cron if it's more than you want to spend.

The workflow skips PRs from forks: secrets aren't available there, and you don't
want an agent with your API key reasoning about untrusted code.

### Local runs (optional)

```bash
curl -sSL https://strix.ai/install | bash
export STRIX_LLM="anthropic/claude-sonnet-4-5"   # same id as the repo secret
export LLM_API_KEY="sk-..."
strix --target ./
```

Needs Docker running — the first run pulls a sandbox image.

**Only scan targets you own.** Point it at localhost or your own staging
deployment, never a third-party host.

---

## 4. `eduberry-ui` skill — the design language

**No setup.** It lives in `.claude/skills/eduberry-ui/` and loads automatically
whenever you work on UI, in any Claude Code surface — terminal, web, or IDE.

### What it does

Codifies an Apple-inspired system — clarity, deference, depth — grounded in the
primitives already in your `globals.css`. Someone on this project had already
started building it (`.glass-card`, `.pressable`, `.icon-chip`, `.headline`,
`.sheen`, and a comment reading *"Tuned for an Apple-grade feel"*). The skill
makes that layer the official one instead of an undocumented island.

- `SKILL.md` — principles, primitives, color, type, space, motion, a11y checklist
- `references/tokens.md` — ramps, elevation, type scale, spacing, radii
- `references/components.md` — recipes for button, card, list row, table, form,
  empty state, skeleton, modal, page shell
- `references/migration.md` — retiring the deprecated classes

### The honest problem it addresses

Your codebase runs **two competing design layers**. The premium primitives are
good. Alongside them sit gradient buttons with colored glow shadows, an
eight-stop radial mesh background, gradient-filled text, an infinitely animating
border, and fifteen page themes that wash entire pages in different colors.

That second layer is the opposite of Apple's restraint, where chrome recedes so
content leads. Current spread:

| Deprecated | Files |
|---|---|
| `btn-primary` | 28 |
| `btn-secondary` | 10 |
| `gradient-text` | 1 |
| `mesh-bg` | 1 |
| `card-hover` | 1 |
| `gradient-border` | 0 |

The skill says to migrate **opportunistically** — fix the deprecated classes in a
file when you touch it for other reasons. A 28-file restyling PR is unreviewable
and will collide with feature work.

Two things worth doing deliberately, both small:

1. Delete `gradient-border` — zero usages.
2. Adopt `.pressable` on interactive cards. It's used in **1** file while
   `.glass-card` is in **14**, so most cards don't respond to touch. Tap feedback
   is most of what makes a web app feel native, and this is the cheapest
   perceived-quality win available.

### Using it

Just ask — "build the fee receipt screen", "this page feels off, review it". To
force it: "use the eduberry-ui skill".

---

## Terminal vs. Claude web

**Needs a local terminal:**
- Supabase MCP OAuth (browser handshake, once)
- Playwright CLI install, and any run that drives your local dev server

**Works anywhere, including Claude on the web:**
- The `eduberry-ui` skill
- Reading schema through Supabase MCP, once authenticated locally
- All Strix configuration (GitHub secrets are set in the browser)

**GitHub web only:** the two Strix secrets.

Claude on the web can't reach `localhost:8081`, so screenshot-driven UI work is
local. Everything else — design, migrations, code review — works from either.

## Recommended order

1. **Strix secrets** — 2 minutes in the browser, starts protecting PRs immediately.
2. **Playwright CLI** — 5 minutes, biggest day-to-day change in how you work.
3. **Supabase MCP** — 2 minutes, then ask it for security advisors.
4. **UI skill** — already live; next UI task will use it.
