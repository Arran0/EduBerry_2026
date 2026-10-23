# GPS gateway

One Traccar server shared by every school. AIS-140 units keep their primary
(government) server and add this one as their second; Traccar decodes the raw
TCP and forwards each position as JSON to the owning school's
`/api/transport/ingest`, using the device's own `forward.url` attribute.

| File | What it is |
|---|---|
| `cloud-init.yaml` | First-boot setup: Traccar 6.16 on PostgreSQL, HTTPS admin page via Caddy on `<ip>.sslip.io`, 15 s position filter (alarms exempt), 7-day cleanup |
| `provision.py` | Creates the droplet, reserved IP and firewall through the DigitalOcean API, then waits for the admin page |

## Create it

```
DIGITALOCEAN_TOKEN=... python3 infra/gps-gateway/provision.py
```

The token needs custom scopes for Droplet, Reserved IP and Firewall (create
and read) and Account (read). Cost: $6/mo droplet + $1.20 weekly backups.

## Then

1. Open the printed admin page and **Register** straight away: the first
   account becomes the admin. Then **Settings → Server** → untick
   **Registration**.
2. Per device: Identifier = IMEI, attribute `forward.url` =
   `https://<school app>/api/transport/ingest?key=<key id>&secret=<secret>`.
3. Vendor sets the device's second server to the printed reserved IP, port
   **5179** (AIS-140 / Traccar `its`), TCP.

Resize the droplet as the fleet grows: 2 GB at ~150 buses, 4 GB at ~500.
