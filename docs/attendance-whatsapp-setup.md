# Attendance WhatsApp — setup

Everything the attendance report's **WhatsApp** button needs, from a Meta
account that does not exist yet to a message arriving on a parent's phone.

Two halves, and the order matters:

- **Part A — Meta.** One to five working days of waiting on business
  verification, then about an hour of clicking. Start today even if nothing
  else is ready; nothing in Part B can be tested until this clears.
- **Part B — this app.** Twenty minutes, and it can be done while Part A is
  still in review. Messages sent before Meta is ready stay queued and go out
  the moment credentials land — nothing is lost and nothing is marked as sent.

If the school already set up WhatsApp for **fee reminders**, Part A is done.
The attendance notices use the same WhatsApp Business number and the same
credentials deliberately: one number per school means a parent recognises one
sender, and Meta rates the quality of one number rather than splitting it. Skip
to Part B, step 4 (the templates), which are the only new thing to register.

---

## Part A — Meta WhatsApp Business

There is a step-by-step version of this with live tick marks inside the app:
**Admin → Fee Settings → WhatsApp**. It checks what it can see (phone number
id, token, verify token) so you can tell what is actually done rather than
what you remember doing. Use it as the checklist; this is the same list with
the reasoning.

### 1. Meta Business Account

Create a Business Portfolio for the school at
[business.facebook.com](https://business.facebook.com). Skip if the school has
one.

### 2. Start business verification — do this first

Business Settings → **Security Centre** → Start Verification.

You need: the school's registration or GST certificate, a document showing the
legal name and address, a business phone number, and a website.

**This takes one to five working days and every other step waits on it.** An
unverified business can only message five whitelisted test numbers, which is
useless for a school. Start it before you read any further.

### 3. Create a Meta app

[developers.facebook.com/apps](https://developers.facebook.com/apps) → Create
App → type **Business** → link it to the portfolio from step 1.

Note the **App ID**, and the **App Secret** under Settings → Basic.

### 4. Add the WhatsApp product to the app

Meta hands you a test number. Ignore it — it only reaches five whitelisted
contacts and will not reach a single parent.

### 5. Add the school's real number

WhatsApp → API Setup → Add phone number.

- **The number must not already be registered on WhatsApp or WhatsApp
  Business.** If it is, delete that account inside the WhatsApp app first and
  wait about 30 minutes before trying.
- Set the Display Name to the school's actual name. Meta reviews it and
  rejects anything else.
- Use a number the school controls permanently. Changing it later means
  re-registering and re-approving every template.

### 6. Copy the Phone Number ID and the WABA ID

Both are on the API Setup screen. **Neither is the phone number itself** —
they are long numeric ids. You will paste them into the app in Part B.

### 7. Create a permanent access token

Business Settings → Users → **System Users** → Add, role **Admin** → Generate
New Token → pick your app → tick:

- `whatsapp_business_messaging`
- `whatsapp_business_management`

Expiry: **Never**.

Copy it now. Meta never shows it again.

> The token on the API Setup screen expires in 24 hours. Do not use that one —
> everything will work for a day and then silently stop.

### 8. Assign the WABA to that system user

Business Settings → Accounts → WhatsApp Accounts → your WABA → Add People →
the system user → **Full control**.

Skipping this is the single most common reason a perfectly valid token still
answers *"object does not exist"*.

### 9. Add a payment method to the WABA

Business Settings → WhatsApp Accounts → **Payment Settings**.

Without it, sending stops once the free tier is used up. Utility conversations
in India cost a fraction of a rupee each, so a school of 1,000 with 40 absences
a day is a few rupees a day.

### 10. Register the ten attendance templates

**WhatsApp Manager → Message Templates → Create.** See
[Part B step 4](#4-register-the-templates-in-whatsapp-manager) for the exact
names and bodies — they must match what the database already has, or the send
fails with *template does not exist*.

### 11. Point the webhook at this app

App → WhatsApp → **Configuration**.

- **Callback URL:** `https://<your-domain>/api/whatsapp/webhook`
  (the Fee Settings → WhatsApp screen shows it with a Copy button)
- **Verify Token:** any random string you invent. Put the same one into the app
  in Part B.
- Subscribe to the **messages** field.

The route answers Meta's challenge, so it verifies on the first try. Subscribing
to `messages` is what makes delivery receipts, read receipts, and an inbound
**STOP** reach the app — without it the message history can only ever say
"Sent", never "Delivered" or "Read".

### 12. Paste the five values into the app

Admin → Fee Settings → WhatsApp: Phone Number ID, WABA ID, permanent token,
verify token, app secret. The three secrets go to the admin-only credential
table, never to the world-readable settings.

---

## Part B — this app

### 1. Run the migration

```
supabase-migrations/attendance_r1_whatsapp.sql
```

Run it after `fee_r3_messaging.sql` (it builds on `whatsapp_numbers`,
`normalize_msisdn` and `notification_outbox`, all of which that migration
creates). Safe to re-run.

It adds the schedules table, the message log, the candidate and typeahead RPCs,
the queueing functions, the automatic tick, and the ten template rows.

### 2. Tell the database where the drain lives

The outbox is drained by an HTTP worker, and the database needs the URL and a
shared secret to call it. Pick a long random secret, then:

```sql
INSERT INTO public.site_settings (key, value) VALUES (
  'attendance_runtime',
  jsonb_build_object(
    'drain_url',   'https://<your-domain>/api/attendance/cron/drain',
    'cron_secret', '<a long random string>'))
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

`attendance_runtime` is on the `is_sensitive_site_setting` denylist, so it is
not readable with the anon key the browser ships with. The drain route refuses
every request whose `x-cron-secret` header does not match, and refuses *all*
requests when no secret is configured — it sends messages to parents, so an
unauthenticated call is not a thing it will do.

### 3. Check pg_cron is scheduling two jobs

The migration schedules them if the extension is present:

```sql
SELECT jobname, schedule FROM cron.job
 WHERE jobname IN ('attendance-drain', 'attendance-notify');
```

| job | schedule | what it does |
|---|---|---|
| `attendance-drain` | every minute | `attendance_kick_drain()` — counts the queue and only makes an HTTP call when something is waiting |
| `attendance-notify` | every 5 minutes | `attendance_notify_tick()` — runs any schedule whose send time has passed today |

If `pg_cron` is not installed, enable it (Supabase → Database → Extensions) and
re-run the migration. Without it nothing sends automatically, though the
**Send** button still works.

The five-minute tick is why the automation sends *within* five minutes of the
configured time rather than exactly on it. Send times are a per-schedule
setting, so a fixed hourly cron could not honour them.

### 4. Register the templates in WhatsApp Manager

Ten templates. For each one: **Category `Utility`**, language **English**, no
header, no buttons, and the body below verbatim.

> Utility, never Marketing. Utility is cheaper in India and is not subject to
> marketing opt-outs — and an attendance notice genuinely is a utility message
> about something the parent is party to. Marketing category on these would be
> both dearer and wrong, and risks the number's quality rating.

Every template takes the same three parameters in the same order:

| | |
|---|---|
| `{{1}}` | student's name |
| `{{2}}` | class |
| `{{3}}` | date, e.g. `01 Oct 2026` |

That uniformity is on purpose. Meta's template messages are positional, and ten
templates with ten different parameter orders is ten chances to tell a parent
the wrong thing.

| Template name | Body |
|---|---|
| `attendance_absent` | Dear Parent, {{1}} of {{2}} was marked absent from school on {{3}}. If this is unexpected, please contact the school office. |
| `attendance_late` | Dear Parent, {{1}} of {{2}} reached school late on {{3}}. Please help them arrive before the school day begins. |
| `attendance_half_day` | Dear Parent, {{1}} of {{2}} was present for only part of the day on {{3}}. Please contact the school office if you would like the details. |
| `attendance_excused` | Dear Parent, {{1}} of {{2}} was excused from classes on {{3}} by the school. No attendance will be marked against them for that day. |
| `attendance_leave` | Dear Parent, {{1}} of {{2}} is recorded as on approved leave on {{3}}. No attendance is marked against them for that day. |
| `attendance_leave_casual` | Dear Parent, the casual leave (CL) for {{1}} of {{2}} is approved for {{3}}. They are not expected in school that day and no absence will be marked. |
| `attendance_leave_medical` | Dear Parent, the medical leave (ML) for {{1}} of {{2}} is approved for {{3}}. No absence will be marked. We hope they are feeling better soon. |
| `attendance_on_duty` | Dear Parent, {{1}} of {{2}} is marked on duty (OD) for {{3}}, representing the school. This counts as present, not absent. |
| `attendance_late_permit` | Dear Parent, the late permit for {{1}} of {{2}} is approved for {{3}}. Arriving late on that day will not be recorded against them. |
| `attendance_half_day_permit` | Dear Parent, the half day permit for {{1}} of {{2}} is approved for {{3}}. Leaving early on that day will not be recorded against them. |

Approval usually takes minutes to a few hours.

**If you want to reword one**, change it in *both* places or it breaks: the text
Meta approved, and `message_templates.body_template` in the database (which is
what the in-app preview renders). The parameter count and order must stay
identical — Meta rejects a send whose parameter count does not match the
approved template.

You can also register fewer than ten. A template that is missing or switched off
shows as *(not registered)* in the picker and is refused at queue time with a
reason, rather than failing silently at the provider.

### 5. Make sure parents' numbers are on file

A message can only go where there is a number. In order of preference the app
uses:

1. `whatsapp_numbers` — a verified, opted-in number for the student
2. `student_details.guardian_phone`
3. `student_details.guardian_phone_alt`
4. `student_details.phone` — the student's own number, last resort

Ten-digit Indian numbers are normalised to `91XXXXXXXXXX` automatically; a
leading `0` or `+91` or spaces are all fine.

The popup shows **no number on file** against every student it cannot reach, and
counts them in the footer, so a gap in the records is visible before you send
rather than discovered afterwards. Fill them in from Profiles → Students.

### 6. Send one test

Open **Attendance → Student Report → WhatsApp**, search for one student whose
guardian number is your own, tick only them, and press Send. In **History** the
row should go `Queued → Sent → Delivered → Read` within a minute or two.

- Stuck on **Queued**: the drain is not being called. Check step 2 and step 3.
- Stuck on **Sent**: the webhook is not subscribed to `messages` (Part A,
  step 11). The message did arrive; the receipt did not come back.
- **Failed**: hover the outbox row — `notification_outbox.last_error` has Meta's
  own words, including the error code.

---

## Using it

### The bulk popup

**Attendance → Student Report → WhatsApp.** It opens on whatever the report was
already showing — the same date, the same class, the tab you were reading.

- **Filters** — date, Absent / Late / Irregular / everyone-not-present, and
  class by homeroom, or by grade and section. Naming a homeroom overrides the
  grade and section choices rather than intersecting with them, so picking
  "8B" and then "Grade 9" cannot silently produce an empty list.
- **Add by hand** — the search box finds any student by name, email, admission
  number or roll number, for the parent who rang or the sheet that was marked
  late after the list was on screen. A class teacher searches their own students
  only, enforced in the database.
- **The list** — everyone who can be reached is ticked already. Rows that cannot
  be messaged are shown greyed with the reason (*no number on file*, *replied
  STOP*, *already messaged for this day*) rather than hidden, because "why is
  this family not on the list" is exactly the question that needs answering on
  screen.
- **The message** — leave it on **Match each student's own day**. One press then
  tells an absent family they were absent, and a family whose medical leave was
  approved that it is on record. Forcing one template on everybody is offered,
  and warns you how many students it would be untrue for.
- **Send** — queues, and reports back `38 queued — 4 no number on file, 2 already
  messaged for this day`. Every skip is counted by reason; the families who were
  missed are exactly the ones worth phoning.

### Automation

**WhatsApp popup → Automate.** A new schedule starts as *every day at 10:30,
every class, absentees only, not on Sunday, approved leave left alone* — which
is what a school usually wants, so switching it on is one press.

Per schedule you can set the time, which statuses to notify about, which
grades / sections / homerooms, which days never to send, whether to force one
template, and whether to leave approved leave alone.

Each schedule shows its last run: *"Last run 2026-10-01: 34 messaged of 41 — 5 no
number on file, 2 already messaged for this day"*. A run that messaged far fewer
than it considered is a records problem, and this is where you see it.

Only admins, principals and coordinators can create or change a schedule. A
class teacher can see what the automation does — useful before phoning a parent
— and can send to their own classes by hand.

Times are the school's wall clock (`site_settings.attendance_config → timezone`,
default `Asia/Kolkata`), the same zone the check-in cutoffs use. The browser's
timezone is never consulted, so a principal travelling abroad does not move the
morning message to the middle of the night at home.

---

## Things that are not configurable, on purpose

- **Messages go to the parent's number, never the student's** unless no
  guardian number exists at all. A ten-year-old marked absent is exactly the
  case where the child's phone is the wrong place to send it.
- **A family who replies STOP is never messaged again.** The webhook writes the
  opt-out and queueing checks it before a row is written. It is what they asked
  for, and Meta scores the number's quality on whether people block it — one
  school ignoring a STOP costs every family the channel.
- **A sibling's opt-out opts out of both.** A guardian's number is often shared,
  and "stop messaging me" does not mean "about this child only".
- **No message names another child, a class total, or a comparison.** A parent
  is told about their own child's day and nothing else.
- **A student cannot be messaged twice for the same day with the same message.**
  The outbox dedupe key is student + attendance date + template, so a
  double-click, an overlapping drain, and the automatic run firing after a
  manual send are each a no-op rather than a second message. Two *different*
  things about the same day — absent in the morning, leave approved in the
  afternoon — are allowed, because both are true and worth saying.
- **Nothing is sent about a student marked present.** A template for it would
  only train parents to ignore the channel.

## Where things live

| | |
|---|---|
| Migration | `supabase-migrations/attendance_r1_whatsapp.sql` |
| Client functions | `src/lib/attendanceWhatsApp.ts` |
| Bulk popup | `src/components/attendance/whatsapp/BulkWhatsAppModal.tsx` |
| Typeahead | `src/components/attendance/whatsapp/StudentTypeahead.tsx` |
| Automation | `src/components/attendance/whatsapp/AutomationSheet.tsx` |
| History | `src/components/attendance/whatsapp/HistorySheet.tsx` |
| Outbox worker | `src/app/api/attendance/cron/drain/route.ts` |
| Webhook (shared) | `src/app/api/whatsapp/webhook/route.ts` |
| Credentials UI (shared) | `src/components/settings/fees/WhatsAppSettings.tsx` |
| Meta adapter (shared) | `src/lib/whatsapp/metaCloud.ts` |
