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

- **Role-based Authentication:** Students, Teachers, Coordinators, Principals, and Admins
- **Task Management:** Assign, track, and complete staff tasks
- **LMS / Academics:** Homework, coursework, and grade management
- **Leave Management:** Apply and approve leave requests
- **Announcements:** School-wide notice board
- **Responsive Design:** Works on desktop, tablet, and mobile
- **Protected Routes:** Staff-only pages hidden from students

## User Roles

| Role | Access Level |
|------|--------------|
| Student | Academics, more services |
| Teacher | All above + Task Manager |
| Coordinator | All above + Task Manager |
| Principal | All above + Task Manager |
| Admin | Full access — everything |

## Quick Start

```bash
git clone https://github.com/yourname/eduberry
cd eduberry
npm install
cp .env.example .env.local
# fill in your Supabase keys
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

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
/app          → Next.js app router pages
/components   → shared UI components
/lib          → Supabase client, utilities
/types        → TypeScript interfaces
```

Detailed layout:

```
/app
├── login/         → Login & signup
├── home/          → Dashboard
├── profile/       → User profile
├── tasks/         → Task Manager (staff only)
├── academics/
│   ├── homework/
│   ├── coursework/
│   └── grades/
└── more/
    ├── fees/
    ├── bus/
    └── leave/
/components        → Navbar, ProtectedLayout, etc.
/lib               → Supabase client & helpers
/types             → TypeScript interfaces
```

## New School Deployment Checklist

- [ ] Fork base repo, rename to school-slug
- [ ] Create new Supabase project, run migrations
- [ ] Set env vars in Vercel
- [ ] Configure custom domain / subdomain
- [ ] Seed default roles and admin account
- [ ] Send login credentials to school admin

## Development Workflow

1. Make changes locally
2. Test at `http://localhost:3000`
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
Run the setup SQL from `supabase-complete-rebuild.sql` in your Supabase SQL Editor, then restart the project under Settings → General.

**`npm: command not found`**
Install Node.js from [nodejs.org](https://nodejs.org/).

**Vercel deployment fails**
Check that all environment variables are set in the Vercel dashboard and match your Supabase project.

## License

Copyright © 2026 EduBerry Private Limited. All rights reserved.
This codebase is proprietary and confidential.
Unauthorised copying, distribution, or use is strictly prohibited.
