# Bulk-creating ~500 students in Supabase Auth

This adds students to **Supabase Auth** (auto-confirmed, no verification email)
and fills in their `profiles` row (name, role=`student`, grade, section).

## 1. Put your data in a file

Create a **CSV** or **XLSX** with a header row. Column names are case-insensitive
and flexible — these all work:

| What it is | Accepted header names |
|------------|-----------------------|
| Name       | `full_name`, `name`, `student name` |
| Email      | `email`, `mail`, `email id`, `mail id` |
| Grade      | `grade`, `class`, `std`, `standard` (a number) |
| Section    | `section`, `sec`, `division` (optional) |

A template is at [`data/students.sample.csv`](../data/students.sample.csv).
Just paste your 500 rows in, or export your existing spreadsheet as CSV/XLSX
and drop it at `data/students.csv`.

## 2. ⚠️ Allow the short password `"mps"` first

Supabase's **default minimum password length is 6**, and `"mps"` is 3 characters.
Before running, lower it:

> Supabase Dashboard → **Authentication** → **Sign In / Providers** →
> **Email** → **Minimum password length** → set to `3` → Save.

(Skip this only if you raise the password to ≥ 6 chars via `STUDENT_PASSWORD`.)

## 3. Dry-run to validate (no users created)

```bash
node scripts/bulk-create-students.js data/students.csv --dry-run
```

This reports row count, bad rows, and duplicate emails — fix any issues, then:

## 4. Create the students

```bash
node scripts/bulk-create-students.js data/students.csv
```

- Everyone gets password **`mps`** and is **email-auto-confirmed**.
- It uses your `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` (already set).
- **Safe to re-run** — existing users are skipped (grade/section refreshed),
  so fix a bad row and run again with no duplicates.
- A full per-student report is written to `data/import-report-<timestamp>.csv`.

### Override the password (optional)

```bash
STUDENT_PASSWORD='SomethingStronger' node scripts/bulk-create-students.js data/students.csv
```

## How it works

`auth.admin.createUser({ email_confirm: true })` creates a confirmed user. The
existing DB trigger `on_auth_user_created` auto-inserts the `profiles` row from
the metadata; the script then patches `grade` and `section` onto it.
