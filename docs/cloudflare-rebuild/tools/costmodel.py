"""Monthly cost model for EduBerry schools: Neon Postgres + Cloudflare (chosen),
with the Durable Object and D1 designs kept for comparison.

Used by docs/cloudflare-rebuild/02-cost-study.md. Run with `python3 costmodel.py`.
Cloudflare list prices read on 27 Oct 2026, Neon and Supabase list prices on
5 Nov 2026; workload numbers are scaled from the live school's usage
(14-27 Oct 2026). Change the constants below and re-run to test other
assumptions.
"""
import argparse

# ---------------------------------------------------------------- prices
P = dict(
    workers_base=5.00,                              # Workers Paid, per account
    req_incl=10e6, req_price=0.30 / 1e6,            # Worker requests
    cpu_incl=30e6, cpu_price=0.02 / 1e6,            # Worker CPU ms
    do_req_incl=1e6, do_req_price=0.15 / 1e6,       # Durable Object requests
    do_gbs_incl=400e3, do_gbs_price=12.50 / 1e6,    # Durable Object duration
    rows_read_incl=25e9, rows_read_price=0.001 / 1e6,
    rows_written_incl=50e6, rows_written_price=1.00 / 1e6,
    do_storage_incl=5, do_storage_price=0.20,       # GB-month, SQLite in DOs
    d1_storage_incl=5, d1_storage_price=0.75,       # GB-month, D1
    r2_incl=10, r2_price=0.015,                     # GB-month
    r2_a_incl=1e6, r2_a_price=4.50 / 1e6,
    r2_b_incl=10e6, r2_b_price=0.36 / 1e6,
    q_incl=1e6, q_price=0.40 / 1e6,                 # Queues operations
    email_incl=3000, email_price=0.35 / 1000,       # Email Service
    logs_incl=20e6, logs_price=0.60 / 1e6,          # Workers Logs (until 1 Dec 2026)
    wfp_base=25.00,                                 # Workers for Platforms
    saas_hostnames_incl=100, saas_hostname_price=0.10,
)

# Neon (5 Nov 2026). A CU is ~4 GB of RAM with its CPU; the smallest compute is 0.25 CU.
NEON = dict(
    launch_cu=0.106, scale_cu=0.222,        # USD per CU-hour
    storage=0.35, history=0.20,             # USD per GB-month: data, and change history for restores
    launch_projects=100, scale_projects=1000,
)
# Supabase today, for comparison: Pro plan per organisation, plus each project's compute.
SUPABASE = dict(pro=25.00, pro_credit=10.00, micro=10.00, small=15.00, medium=60.00)

DAYS = 24            # school-day equivalents per month (22 school days + light weekends)
LOG_SAMPLING = 0.10  # share of invocations whose logs are kept


def school(users, scenario='typical', year=1, client='rebuilt'):
    """Monthly usage of one school."""
    students = users * 0.92
    staff = users * 0.07
    buses = max(1, round(users / 200))
    staff_dau = staff * 0.75                                    # measured: ~75% of staff daily
    student_dau = students * {'low': 0.02, 'typical': 0.30, 'high': 0.70}[scenario]
    if client == 'rebuilt':     # one API call per screen, server-side joins
        req_staff, req_student, rows_per_req = 150, 40, 200
    else:                       # today's browser-side queries, measured ~500 per staff user
        req_staff, req_student, rows_per_req = 500, 120, 300
    api = staff_dau * req_staff + student_dau * req_student
    gps = buses * 4 * 180                                       # one fix per 15 s, 3 h of trips
    sockets = student_dau * 0.3 * 2                             # parents watching the bus, 2 trips
    writes = (students                                          # attendance marks
              + staff * 3                                       # punches and location checks
              + gps                                             # GPS fixes
              + students * 0.05 * 4                             # absence messages and receipts
              + api * 0.10 * 3) * 3                             # user edits; x3 for index rows
    return dict(
        dau=staff_dau + student_dau,
        worker_req=(api + gps + sockets) * DAYS,
        cpu_ms=(api * 4 + gps * 1 + sockets * 2) * DAYS + users * 0.3 * 80,  # + sign-ins (PBKDF2)
        do_req=(api + gps + sockets * 0.2) * DAYS,
        do_gbs=(api * 0.003 + gps * 0.001) * 0.128 * DAYS,       # billed only while busy
        do_gbs_worst=14 * 3600 * 0.128 * DAYS,                   # if never idle in school hours
        rows_read=(api * rows_per_req + gps * 5) * DAYS,
        rows_written=writes * DAYS,
        db_gb=users * 0.20 / 1000 * year,                        # measured 0.22 MB per user-year
        files_gb=users * 1.2 / 1000 * year,                      # measured ~1.1 MB per user-year
        r2_a=users * 0.07, r2_b=users * 5,
        queue_ops=(students * 0.05 + staff * 0.5) * 3 * DAYS,
        emails=users * 0.03,
        peak_rps=(api + gps + sockets) * 0.25 / 3600 * 2.5,     # 25% of the day in the peak hour, x2.5 burst
        # Neon: Postgres CPU time per month (rebuilt screens run fewer, larger queries)
        db_cpu_s=(api * (0.012 if client == 'rebuilt' else 0.004) + gps * 0.001) * DAYS,
        hub_req=(gps + sockets * 0.2) * DAYS,                    # live-update hub (one Durable Object per school)
        users=users,
    )


def neon_compute(s, shared_pod_size=1):
    """CU-hours per month for one school on Neon.

    The compute is awake while anyone uses the app (scale to zero after 5 idle
    minutes): about 13 hours on a school day, 4 on a weekend day, and half an
    hour a night for jobs. Its size is set by memory first (the school's busy
    data must fit in RAM), then by CPU. In a shared pod, schools share one
    compute, so the memory floor and idle headroom are shared too.
    """
    users = s['users']
    hours = 22 * (13 if users >= 1000 else 10) + 8 * 4 + 30 * 0.5
    ram_cu = 0.25 if users < 2000 else 0.5 if users < 6000 else 0.75
    cpu_cu = s['db_cpu_s'] / (hours * 3600) * 3                 # x3: autoscaling follows the peaks
    cu = max(ram_cu, cpu_cu)
    if shared_pod_size > 1:
        cu = max(0.25 / shared_pod_size, cu * 0.45)             # pooled RAM and headroom
    return hours * cu


def over(total, incl, price):
    return max(0.0, total - incl) * price


def cost(schools, arch='do', worst=False):
    """Monthly bill for a fleet. arch: 'do', 'd1' or 'd1_wfp'."""
    t = {}
    for s in schools:
        for k, v in s.items():
            t[k] = t.get(k, 0) + v
    if worst:
        t['do_gbs'] = t['do_gbs_worst']
    c = dict(
        workers_base=P['workers_base'],
        requests=over(t['worker_req'], P['req_incl'], P['req_price']),
        cpu=over(t['cpu_ms'], P['cpu_incl'], P['cpu_price']),
        rows_read=over(t['rows_read'], P['rows_read_incl'], P['rows_read_price']),
        rows_written=over(t['rows_written'], P['rows_written_incl'], P['rows_written_price']),
        r2=(over(t['files_gb'], P['r2_incl'], P['r2_price'])
            + over(t['r2_a'], P['r2_a_incl'], P['r2_a_price'])
            + over(t['r2_b'], P['r2_b_incl'], P['r2_b_price'])),
        queues=over(t['queue_ops'], P['q_incl'], P['q_price']),
        email=over(t['emails'], P['email_incl'], P['email_price']),
        custom_hostnames=over(len(schools), P['saas_hostnames_incl'], P['saas_hostname_price']),
    )
    if arch.startswith('neon'):
        pod = 20 if arch == 'neon_pod' else 1
        plan_price = NEON['launch_cu'] if len(schools) <= NEON['launch_projects'] or pod > 1 else NEON['scale_cu']
        c['neon_compute'] = sum(neon_compute(s, pod) for s in schools) * plan_price
        c['neon_storage'] = t['db_gb'] * NEON['storage'] + len(schools) * 0.3 * NEON['history']
        c['hub_requests'] = over(t['hub_req'], P['do_req_incl'], P['do_req_price'])
        log_events = t['worker_req'] * LOG_SAMPLING
    elif arch == 'do':
        c['do_requests'] = over(t['do_req'], P['do_req_incl'], P['do_req_price'])
        c['do_duration'] = over(t['do_gbs'], P['do_gbs_incl'], P['do_gbs_price'])
        c['sql_storage'] = over(t['db_gb'], P['do_storage_incl'], P['do_storage_price'])
        log_events = (t['worker_req'] + t['do_req']) * LOG_SAMPLING
    else:
        c['sql_storage'] = over(t['db_gb'], P['d1_storage_incl'], P['d1_storage_price'])
        log_events = t['worker_req'] * LOG_SAMPLING
    if arch.startswith('neon'):          # no SQL row billing on Neon; compute time instead
        c.pop('rows_read'); c.pop('rows_written')
    c['logs'] = over(log_events, P['logs_incl'], P['logs_price'])
    if arch == 'd1_wfp':
        c['workers_for_platforms'] = P['wfp_base']
    c['total'] = sum(c.values())
    return c


def supabase_estimate(users, n):
    """Supabase today: one project per school, compute sized to the school, on one Pro organisation."""
    size = SUPABASE['micro'] if users < 2000 else SUPABASE['small'] if users < 6000 else SUPABASE['medium']
    return SUPABASE['pro'] - SUPABASE['pro_credit'] + n * size


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--users', type=int, default=10000)
    ap.add_argument('--scenario', default='typical', choices=['low', 'typical', 'high'])
    ap.add_argument('--year', type=int, default=1)
    ap.add_argument('--client', default='rebuilt', choices=['rebuilt', 'asis'])
    a = ap.parse_args()

    s = school(a.users, a.scenario, a.year, a.client)
    print(f"One school: {a.users} users, {a.scenario}, year {a.year}, {a.client} client")
    for k in ['dau', 'worker_req', 'rows_read', 'rows_written', 'db_gb', 'files_gb', 'peak_rps']:
        print(f"  {k:13s} {s[k]:>16,.1f}")

    print("\nNeon + Cloudflare, fleet of identical schools (USD per month):")
    print(f"  {'schools':>7}  {'Neon':>9}  {'per school':>10}  {'Neon pods':>9}  {'per school':>10}  {'DO':>9}  {'Supabase':>9}")
    for n in [1, 10, 50, 200]:
        fleet = [school(a.users, a.scenario, a.year, a.client)] * n
        ne, pod, do = cost(fleet, 'neon')['total'], cost(fleet, 'neon_pod')['total'], cost(fleet, 'do')['total']
        sb = supabase_estimate(a.users, n)
        print(f"  {n:>7}  {ne:>9.2f}  {ne / n:>10.2f}  {pod:>9.2f}  {pod / n:>10.2f}  {do:>9.2f}  {sb:>9.2f}")

    print("\nFleet of identical schools (USD per month):")
    print(f"  {'schools':>7}  {'DO':>9}  {'DO worst':>9}  {'D1':>9}  {'D1+WfP':>9}  {'DO/school':>9}")
    for n in [1, 10, 50, 200]:
        fleet = [school(a.users, a.scenario, a.year, a.client)] * n
        do, worst = cost(fleet, 'do')['total'], cost(fleet, 'do', worst=True)['total']
        d1, wfp = cost(fleet, 'd1')['total'], cost(fleet, 'd1_wfp')['total']
        print(f"  {n:>7}  {do:>9.2f}  {worst:>9.2f}  {d1:>9.2f}  {wfp:>9.2f}  {do / n:>9.2f}")

    base = [school(10000, 'typical', 1)] * 200
    extra = school(a.users, a.scenario, a.year, a.client)
    for arch in ['neon', 'do', 'd1']:
        m = cost(base + [extra], arch)['total'] - cost(base, arch)['total']
        print(f"\nMarginal cost of this school on a large fleet ({arch}): ${m:.2f} per month")

    print("\nBreakdown, 50 such schools, Neon (one project per school):")
    for k, v in cost([extra] * 50, 'neon').items():
        print(f"  {k:22s} {v:>9.2f}")
    print(f"  CU-hours per school    {neon_compute(extra):>9.1f}")

    print("\nBreakdown, 50 such schools, DO:")
    for k, v in cost([extra] * 50, 'do').items():
        print(f"  {k:22s} {v:>9.2f}")


if __name__ == '__main__':
    main()
