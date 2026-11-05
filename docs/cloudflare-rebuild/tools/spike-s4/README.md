# Spike S4: is Neon in Singapore fast enough from India?

Part of [spike S4](../../01-architecture-options.md#spikes-to-run-first). Neon's nearest region to India is Singapore; today's database is Supabase in Mumbai. This spike measures the difference from real Indian networks before anything is built on it.

## Part A: one database round trip (now, about 20 minutes)

`latency.mjs` times `select 1` against Neon (Singapore) and a one-row read through Supabase's API (Mumbai, the path today's browser uses), 30 times each, and prints the median and 95th percentile. It must run **from India**: a cloud machine elsewhere measures the wrong thing.

On the Mac:

```sh
cd ~/EduBerry_2026 && git checkout main && git pull
cd docs/cloudflare-rebuild/tools/spike-s4
node --version            # needs 20 or newer; if missing: brew install node
npm install

# Neon: Console → your project → Connect → turn on "Connection pooling" → copy the string.
# Paste it after running the next line and press Enter (nothing is shown, and it stays out of shell history).
read -rs NEON_URL && export NEON_URL

# Supabase: Dashboard → Project Settings → API Keys → the publishable (anon) key. It is public, but paste it the same way.
read -rs SUPABASE_ANON_KEY && export SUPABASE_ANON_KEY

node latency.mjs --label home-wifi
```

Then repeat on the networks schools and parents use, each with its own label:

| Run | How |
| --- | --- |
| `--label home-wifi` | Normal broadband |
| `--label jio` | Mac on a Jio phone hotspot |
| `--label airtel` | Mac on an Airtel phone hotspot |
| `--label school` | On the school's network, ideally between 08:00 and 09:00 |
| `--label cold --only neon-http` | After leaving Neon untouched for 6 minutes, so it has gone to sleep. The **first** column is the wake-up time |

Each run appends a line to `results.csv` (ignored by git) and prints a table with no passwords in it. Paste the tables into the chat.

Optional, for a like-for-like Postgres comparison: set `SUPABASE_DB_URL` to the Supabase **Session pooler** connection string (Dashboard → Connect) the same way. If its TLS check fails, download Supabase's CA certificate (Project Settings → Database → SSL) and set `SUPABASE_CA` to its path.

### Reading the result

| Measure | Good enough | Why |
| --- | --- | --- |
| Neon median minus Supabase median | 60 ms or less | One call per screen (phase 2) then costs at most that much per screen |
| Neon p95 | 150 ms or less | Slow mobile moments stay tolerable |
| Wake-up (`cold`, first) | About 1 second or less | The first person each morning waits this once |

Today's chatty screens make about a dozen calls, several one after another. Multiply the difference by the number of sequential calls to see what phase 1 would feel like before those screens move to single calls.

## Part B: real screens through a Worker (after spike S1)

Once the live database is restored into Neon (S1), a small Worker with Smart Placement runs the home, attendance and fee-counter queries against it. The same screens are timed from phones on Jio and Airtel, and compared with today's app. Pass: p95 under 300 ms per screen ([01](../../01-architecture-options.md)).
