# EduBerry

School management SaaS — task management, LMS, assessments, leave, and announcements for schools.

![Next.js](https://img.shields.io/badge/Next.js-14-black)
![TypeScript](https://img.shields.io/badge/TypeScript-blue)
![Supabase](https://img.shields.io/badge/Supabase-Auth-green)
![Tailwind CSS](https://img.shields.io/badge/Tailwind-CSS-06B6D4)
![Vercel](https://img.shields.io/badge/Hosted-Vercel-black)

## Tech Stack

- **Frontend:** Next.js 14, TypeScript, Tailwind CSS
- **Backend:** Supabase (PostgreSQL + Auth + RLS + Storage)
- **Hosting:** Vercel
- **Payments:** Direct bank integration (fee collection + salary payout)

## Features

- **Role-based Authentication:** Students, Teachers, Coordinators, Principals, Admins, Drivers, and Smartboard kiosks
- **Task Management:** Assign, track, and complete staff tasks
- **Classrooms / LMS:** Coursework, homework, discussions, and file submissions per classroom
- **Exams:** Question papers, student attempts, grading queue, and result rank/analytics
- **Leave Management:** Staff and student leave applications with an approval chain
- **Staff Attendance:** GPS/geofence-verified punch in/out, with a live homeroom smartboard view
- **Fees & Salary:** Direct bank fee collection and salary payout (see Banking below)
- **Bus Tracking:** Live GPS trip tracking, stop rosters, and bus fee/payroll
- **Announcements:** School-wide notice board with audiences, likes, and push notifications
- **Certificates:** Generated PDF certificates with a public `/verify/[certNo]` lookup page
- **Responsive Design:** Works on desktop, tablet, and mobile
- **Protected Routes:** Role-gated pages (e.g. Task Manager is staff-only)

## User Roles

| Role | Access Level |
|------|--------------|
| Student | Academics/classrooms, exams, leave, announcements, fees |
| Teacher | All student-facing areas + classrooms they teach, exam grading, staff attendance |
| Coordinator | All above + team/homeroom oversight, Task Manager |
| Principal | All above + school-wide reporting |
| Admin | Full access — settings, fees/salary config, user management, everything |
| Driver | Bus trip tracking and driver salary — no access to academic areas |
| Smartboard | Kiosk account mounted in a homeroom — attendance display, homeroom announcements |

## Quick Start

```bash
git clone https://github.com/yourname/eduberry
cd eduberry
npm install
cp .env.example .env.local
# fill in your Supabase keys
npm run dev
```

Open [http://localhost:8081](http://localhost:8081) in your browser
(the `dev`/`start` scripts bind to port 8081, not Next's default 3000).

## Environment Variables

List of all required variables — never commit real values.

```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
```

Copy `.env.example` to `.env.local` and fill in your Supabase project credentials from the Supabase dashboard.

Bank credentials are **not** environment variables. Each school enters its own in
**Admin → Settings → Fees & Salary**, where they are stored admin-only in
`payment_secrets` (see the Banking section below). The `BANK_COLLECT_*` /
`BANK_PAYOUT_*` env vars exist only as a fallback for single-tenant self-hosting
and are overridden by anything saved in the app.

## Account emails (invite & password reset)

Invites, admin-sent password links and "Forgot your password?" mails go out
through **Cloudflare Email Service** from the platform's own domain — never a
school's — with the school named in the sender display name
("Muthamil Public School via EduBerry"), the subject, the body and the footer.
Replies go to the school's contact email from **School profile**. Code:
`src/lib/email/`.

Nothing here is per school. The sending domain, its DNS records and the API
token are set up once, and every school deployment uses the same values:

```
CLOUDFLARE_ACCOUNT_ID=          # account that owns the sending domain
CLOUDFLARE_EMAIL_API_TOKEN=     # API token with Email Sending permission
EMAIL_FROM_ADDRESS=             # e.g. no-reply@mail.eduberry.in
EMAIL_PLATFORM_NAME=EduBerry    # optional
```

Add them once as Vercel **Shared Environment Variables** (Team Settings →
Environment Variables) and link each new school's project to them, instead of
typing them into every project. The school name, logo and reply-to address
come from that school's own Design / School profile settings, so a new client
needs no email configuration at all.

Links point at the school's own domain: `NEXT_PUBLIC_SITE_URL` if set,
otherwise Vercel's `VERCEL_PROJECT_PRODUCTION_URL`, otherwise the host the
request reached — never the request's `Origin` header, which a caller controls.
The link is redeemed on `/update-password` directly, so the school's Supabase
Redirect URLs list needs no change for these mails.

One-time platform setup: onboard the sending domain in Cloudflare (Email
Service → Email Sending, or `wrangler email sending enable mail.eduberry.in`)
so its SPF/DKIM/DMARC records are published, then create the API token.

Until the variables are set, everything falls back to Supabase Auth's own
mailer as before (that path does still need the school's
`/update-password` URL in Supabase → Auth → URL Configuration → Redirect URLs).

## Banking

Fees are collected into, and salaries are paid out of, the school's **own bank
account**. No payment aggregator sits in between, so no third party takes a cut
of fees or payroll.

### Fee collection

| Mode | What the bank gives you | When to use it |
|---|---|---|
| Reference matching | Callback access on your account | Fastest to set up — one school UPI ID, each fee carries a unique reference |
| Virtual UPI ID | A UPI ID allotted per fee | The UPI note can't be relied on |
| Virtual account | An account number + IFSC per fee | Parents should be able to pay by NEFT/IMPS too |

### Salary payout

| Mode | What happens | When to use it |
|---|---|---|
| Manual | Admin pays from the bank portal, marks records paid | No bank integration at all |
| Bank file | App generates your bank's bulk-transfer file, admin uploads it | Most common — needs no API access |
| Bank API | App calls your bank's bulk payment API directly | Your bank has sanctioned API access |

### Onboarding a school's bank

Ask the bank's corporate relationship manager for the **bulk payment** and
**virtual account / smart collect** programmes, then enter what they issue in
Settings. Every bank differs in field names and auth scheme, so all of it is
configuration — a new bank needs no code change:

- API base URL (UAT and production) and endpoint paths
- Corporate / customer ID
- Auth: API key, HTTP Basic, OAuth2 client credentials, or HMAC request signing
- Client TLS certificate + key + passphrase, if the bank requires mutual TLS
- Debit account number + IFSC (payout only)
- Callback secret, and the header the bank puts its signature in
- Their integration document's sample request/response — the "field renames"
  box under Advanced maps our field names onto theirs
- IP allowlisting for your deployment, and per-batch/per-day transfer limits

Give the bank the callback URLs shown in Settings (each has a copy button):
`/api/fees/upi/webhook`, `/api/bus/upi/webhook`,
`/api/salary/payout/webhook`, `/api/bus/payroll/payout/webhook`.

Card / netbanking via Razorpay remains available as an optional extra under
Fee Settings, but it carries a per-transaction commission and is off by default.

## Project Structure

```
/src/app          → Next.js 14 App Router pages (almost all 'use client')
/src/components   → shared UI components, grouped by feature
/src/lib          → Supabase client + one data-access module per feature
/src/contexts     → app-wide React context providers (auth, page config, etc.)
/src/types        → TypeScript interfaces
/supabase-migrations → SQL migrations, applied by hand via the Supabase MCP/dashboard
                        (there is no local Supabase CLI project — see below)
```

Detailed `/src/app` layout (routes that don't obviously map to a role above are
reached from the bottom-nav "More" menu, under `/more`):

```
/src/app
├── login/                → Sign-in (public)
├── update-password/      → Password reset landing (public)
├── verify/[certNo]/      → Public certificate verification lookup
├── home/                 → Dashboard — role-specific cards, quick links
├── profile/              → Own profile + avatar
├── tasks/                → Task Manager (staff only)
├── classrooms/[id]/      → A classroom's coursework/homework/discussions
├── announcements/        → School-wide notice board
├── academic-record/      → Report cards / academic history
├── driver/                → Driver home + trip tracking
│   └── trip/[tripId]/
├── smartboard/            → Homeroom kiosk view (attendance + announcements)
├── admin/settings/        → Branding, login theme, page icons, fee/salary config
└── more/
    ├── fees/, bus/, salary/         → Fee collection, bus tracking/fees, payroll
    ├── exam/[examId]/               → Exam create/edit/take/grade/review
    ├── leave/, staff-leave/         → Student & staff leave applications
    ├── attendance/, staff-attendance/ → Attendance reports and staff punches
    ├── classrooms/, homerooms/, teacher-teams/ → Staff-side classroom/team admin
    ├── profiles/{students,staff,templates}/    → User directory & bulk import
    ├── timetable/, feedback/                    → (early-stage / unbuilt features)
    └── admin-space/                             → Misc admin utilities
```

## Development Conventions

Hard-won conventions from a cost/performance audit of the live Supabase
project — please follow these in new code so the gains don't regress:

- **Never `select('*')` on `profiles` in a join.** Every embedded
  `profiles(...)` fetch should list only the fields the screen actually
  renders (typically `id, full_name, avatar_url, role`). `profiles` is
  joined from ~50 places; a wildcard select there is the single biggest
  egress multiplier in the app.
- **Batch, don't loop.** Fetching per-classroom/per-exam/per-date inside a
  `.map()` turns into hundreds of round trips at real scale — use `.in()`
  with a batched fetch instead (see `fetchClassroomFilesBatch` in
  `src/lib/classrooms.ts` for the pattern).
- **RLS predicates wrap auth calls in `(select ...)`.** `auth.uid()`,
  `auth.jwt()`, and `get_user_role()` inside a policy's `USING`/`WITH CHECK`
  must be written as `(select auth.uid())` etc., so Postgres evaluates them
  once per statement instead of once per row.
- **Uploads always set `cacheControl: '31536000'`** and go through
  `src/lib/imageCompression.ts` for anything that's a photo (resizes to
  ≤1600px and re-encodes to WebP before upload).
- **`site_settings`/branding defaults must stay neutral**, not a specific
  brand colour — `BRANDING_DEFAULTS`/`LOGIN_DEFAULTS` in
  `src/lib/pageConfig.ts` are shown briefly on every load before the
  admin's real theme fetches, so a colourful default reads as a bug (see
  the flash-fix commit on `PageConfigContext.tsx` for the full mechanism:
  a `useLayoutEffect`-based cache warm-up plus a shared `.brand-fade` CSS
  transition class).

## New School Deployment Checklist

- [ ] Fork base repo, rename to school-slug
- [ ] Create new Supabase project, run migrations
- [ ] Set env vars in Vercel
- [ ] Configure custom domain / subdomain
- [ ] Seed default roles and admin account
- [ ] Send login credentials to school admin

## Development Workflow

1. Make changes locally
2. Test at `http://localhost:8081`
3. Commit and push:

```bash
git add .
git commit -m "your message"
git push
```

Vercel will automatically deploy on push to `main`.

## Roadmap

```
- [x] Task management
- [x] Leave management
- [x] Announcements
- [x] Direct bank fee collection & salary payout
- [ ] Custom domain support
- [ ] Mobile app
```

## Troubleshooting

**Database error on sign-in**
Run the base schema from `supabase-schema-only.sql`, then every file in
`supabase-migrations/` in filename order, in your Supabase SQL Editor. Restart
the project under Settings → General afterward. (There is no single
rebuild script — the schema is the base file plus ~115 incremental
migrations; a fresh project needs all of them.)

**`npm: command not found`**
Install Node.js from [nodejs.org](https://nodejs.org/).

**Vercel deployment fails**
Check that all environment variables are set in the Vercel dashboard and match your Supabase project.

## License

Copyright © 2026 EduBerry Private Limited. All rights reserved.
This codebase is proprietary and confidential.
Unauthorised copying, distribution, or use is strictly prohibited.
