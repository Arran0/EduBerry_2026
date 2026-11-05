# Certificates and Public Verification

As of 5 Nov 2026. Part of the [rebuild docs](README.md). The design is a Neon Postgres project per school with Cloudflare for everything else ([01](01-architecture-options.md), [10](10-target-architecture.md)).

## 1. Summary

Admins issue student certificates as PDFs: transfer, bonafide, study, no-due, attendance, progress card, report card, and custom templates with `{{placeholders}}`. Each issued certificate is recorded with a snapshot of its data and a number like `TC-2026-27-XXXX`; the PDF carries a QR code pointing at `/verify/<certNo>`, a public page that confirms the certificate is genuine. A similar public page verifies fee receipts (`/verify/receipt/<token>`, owned by [33](33-fees.md)).

Live: 7 certificates issued, 0 custom templates.

What changes: the public verify endpoint is resolved per school from the host (the QR's host), so a number can never be checked against the wrong school; PDF rendering stays in the browser; templates and the registry move with the dump.

## 2. Users and screens

| Route | Who | Purpose |
| --- | --- | --- |
| `/admin/certificates` (365 lines) | Admin | Certificate Builder: pick type and student, fill fields (pre-filled from student and staff details, school profile, attendance and marks), preview, issue and download |
| `/more/profiles/templates` (196 lines) | Admin | Custom template editor |
| `/verify/[certNo]` (126 lines) | Anyone, no sign-in | Verify a certificate |
| Student and staff detail modals (`EditStudentDetailsModal`, `EditStaffDetailsModal`) | Admin | Fix the details a certificate prints |

Code: `src/lib/certificates.ts` (type metadata, context gathering, registry, placeholders), `src/components/certificates/` (`documents.tsx` PDF layouts with `@react-pdf/renderer`, `generate.ts`, `CertificateShell`), `src/lib/schoolProfile.ts` (affiliation number, address, principal, seal), `/api/certificates/verify/[certNo]`.

## 3. How it works today

1. The builder gathers a context: student profile and `student_details`, school profile and branding, attendance and marks when the type needs them.
2. The admin fills type-specific fields (for a transfer certificate: reason for leaving, last class, conduct, promotion, fees paid up to, date of leaving).
3. Issuing inserts a `certificates` row (number, type, student, student name, academic year, full data snapshot, issuer, date, status) and renders the PDF in the browser with a QR code.
4. `/api/certificates/verify/[certNo]` reads with the service role (no public read policy) and returns only safe snapshot fields; the public page shows them.

## 4. Data

| Table | Rows | Purpose |
| --- | --- | --- |
| `certificates` | 7 | Registry: number (unique), type, student, name snapshot, academic year, data snapshot, issuer, issue date, status |
| `certificate_templates` | 0 | Custom templates: name, type, title, body with placeholders |

`site_settings.school_profile` ([21](21-school-settings-and-branding.md)) supplies the formal school details.

## 5. Logic in the database

None beyond `update_task_updated_at` and row-level security (admin write; no public read).

## 6. Server routes and integrations

| Route | Target |
| --- | --- |
| `/api/certificates/verify/[certNo]` | `GET /api/public/certificates/<certNo>` on the school's host → `certificates.verifyPublic(certNo)`: returns number, type label, student name, issue date, status, school name; rate-limited |

## 7. Jobs, files and live updates

- **Files:** none stored today (PDFs are generated on demand). Optionally store each issued PDF under `certificates/<certNo>.pdf` so a reprint is byte-identical.
- **Jobs, live updates:** none.

## 8. Single-tenant assumptions

| Assumption | Fix |
| --- | --- |
| QR links use the deployment's own domain | Use the school's primary host; keep every old host mapped so printed QR codes keep working |
| Certificate numbers unique per deployment only | Numbers stay unique per school; lookups are always scoped by the host's school |

## 9. Target design

Under Neon ([01](01-architecture-options.md)) this section's tables, functions and policies move as they are; nothing below is needed for the move itself. What follows is the phase 2 design ([16](16-frontend-and-api.md)): the endpoints the screens call, each running one SQL function as the signed-in user, and schema improvements worth making along the way as ordinary migrations. An endpoint written `section.action` is `POST /api/section/action`. Permission names label today's rules, which stay in the policies and functions; the fee module's grants remain the only named permission system.

### Tables

Carried over. Index `certificates (certificate_no)` unique, `(student_id)`.

### Endpoints (phase 2)

| Endpoint | Permission |
| --- | --- |
| `certificates.context(type, studentId)` | `certificates.issue` (admin) |
| `certificates.issue(input)` | `certificates.issue` |
| `certificates.list(studentId?)`, `certificates.revoke(certNo)` | `certificates.issue` |
| `certificates.templates.*` | `certificates.issue` |
| `certificates.verifyPublic(certNo)` | public (host-scoped, rate-limited) |

## 10. Moving existing data

Moves with the dump ([13](13-data-layer.md)). Confirm every issued certificate's QR host is mapped to the school in `platform.school_hosts`.

## 11. Parity checklist

- [ ] Every certificate type renders the same PDF from the same inputs.
- [ ] Scanning an old certificate's QR verifies it after the move.
- [ ] The public page never shows internal ids or the full data snapshot.
- [ ] A certificate number from one school does not verify on another school's host.

## 12. Open questions

- [ ] Should certificate revocation be shown on the public page (status "revoked")?
- [ ] Store issued PDFs for byte-identical reprints?
