# GPS gateway

One Traccar server shared by every school. AIS-140 units keep their government
(VLTD) and SOS servers and add this one in a spare slot; Traccar decodes the raw
TCP and forwards each position as JSON to the owning school's
`/api/transport/ingest`, using the device's own `forward.url` attribute.

Each school's app links its own devices through Traccar's API
(`/api/transport/devices/link`), so adding a bus needs nobody at EduBerry.

| File | What it is |
|---|---|
| `cloud-init.yaml` | First-boot setup: Traccar 6.16 on PostgreSQL, HTTPS on `<ip>.sslip.io` via Caddy, service-account token, 15 s position filter (alarms exempt), 7-day cleanup |
| `provision.py` | Creates the droplet, reserved IP and firewall, then gives every school's Vercel project `TRACCAR_URL`, `TRACCAR_TOKEN` and `GPS_GATEWAY_HOST` and redeploys it |
| `../../.github/workflows/gps-gateway-sync.yml` | Runs `provision.py --sync` nightly, so a new school is connected by the next morning |

## Once, ever

```
DIGITALOCEAN_TOKEN=... VERCEL_TOKEN=... python3 infra/gps-gateway/provision.py
```

- DigitalOcean token: custom scopes droplet, reserved_ip, firewall (create,
  read) and account (read).
- Vercel token: for the team that hosts the schools; add `VERCEL_TEAM_ID` if
  they live under a team.
- School projects are found by their `SUPABASE_SERVICE_ROLE_KEY` variable;
  set `VERCEL_PROJECTS` (comma-separated names) to name them instead.
- Cost: $6/mo droplet + $1.20 weekly backups.

Then add the same values as repository secrets (`DIGITALOCEAN_TOKEN`,
`VERCEL_TOKEN`, optionally `VERCEL_TEAM_ID`) so the nightly sync can run. It
skips quietly until they exist. A sync never creates servers.

The service-account token lives only on the gateway and in Vercel and is
never printed; a sync reads it back from a school that already has it.

## Per school

Nothing. The nightly sync (or a manual run of the workflow) connects a new
Vercel project; after that the school's GPS panel links each device it
registers, and shows the vendor message with the device IP and port 5179
(AIS-140 / Traccar `its`).

Resize the droplet as the fleet grows: 2 GB at ~150 buses, 4 GB at ~500.
