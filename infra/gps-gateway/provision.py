#!/usr/bin/env python3
"""
Create EduBerry's shared GPS gateway and connect every school to it.

  python3 infra/gps-gateway/provision.py          # create or reuse, then sync
  python3 infra/gps-gateway/provision.py --sync   # only connect schools; never creates servers

Environment:
  DIGITALOCEAN_TOKEN  droplet, reserved_ip, firewall (create, read), account (read)
  VERCEL_TOKEN        a Vercel access token for the team that hosts the schools
  VERCEL_TEAM_ID      optional, when the projects live under a team
  VERCEL_PROJECTS     optional comma-separated project names; by default every
                      project that has SUPABASE_SERVICE_ROLE_KEY (an EduBerry app)

Creating makes, or reuses if they already exist:
  - a droplet tagged gps-gateway (Bangalore, 1 GB, weekly backups) that
    installs Traccar from cloud-init.yaml on first boot,
  - a reserved IP, which is the address GPS vendors put into devices,
  - a firewall opening SSH, HTTP/HTTPS for the admin page's certificate, and
    the Traccar protocol ports 5001-5300 on TCP and UDP.

Syncing gives each school's Vercel project TRACCAR_URL, TRACCAR_TOKEN and
GPS_GATEWAY_HOST, and redeploys the ones that changed, after which the app links
its own devices. The gateway token is generated here and only ever stored on
the gateway and in Vercel; later syncs read it back from a school that has it.
Never printed.
"""

import json
import os
import secrets
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

TAG = 'gps-gateway'
REGION = 'blr1'
SIZE = 's-1vcpu-1gb'
IMAGE = 'ubuntu-24-04-x64'
ANYWHERE = {'addresses': ['0.0.0.0/0', '::/0']}
MARKER_ENV = 'SUPABASE_SERVICE_ROLE_KEY'
KEYS = ('TRACCAR_URL', 'TRACCAR_TOKEN', 'GPS_GATEWAY_HOST')


def request(method, url, token, body=None):
    req = urllib.request.Request(
        url,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': f'Bearer {token}', 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        # The path, never the token or a body that may carry one.
        sys.exit(f'{method} {urllib.parse.urlsplit(url).path} failed: {e.code} {e.read().decode(errors="replace")[:300]}')


# ── DigitalOcean ─────────────────────────────────────────────────────────────

def do(method, path, body=None):
    return request(method, 'https://api.digitalocean.com/v2' + path, os.environ['DIGITALOCEAN_TOKEN'], body)


def public_ipv4(droplet):
    for net in droplet['networks']['v4']:
        if net['type'] == 'public':
            return net['ip_address']
    return None


def find_droplet():
    droplets = do('GET', f'/droplets?tag_name={TAG}')['droplets']
    return droplets[0] if droplets else None


def create_droplet(service_token):
    user_data = (Path(__file__).parent / 'cloud-init.yaml').read_text()
    if '__SERVICE_TOKEN__' not in user_data:
        sys.exit('cloud-init.yaml has no __SERVICE_TOKEN__ placeholder')
    created = do('POST', '/droplets', {
        'name': TAG,
        'region': REGION,
        'size': SIZE,
        'image': IMAGE,
        'backups': True,
        'monitoring': True,
        'tags': [TAG],
        'user_data': user_data.replace('__SERVICE_TOKEN__', service_token),
    })['droplet']
    print(f'Created droplet {created["id"]} ({SIZE} in {REGION})')
    return created['id']


def wait_active(droplet_id):
    for _ in range(60):
        d = do('GET', f'/droplets/{droplet_id}')['droplet']
        if d['status'] == 'active' and public_ipv4(d):
            return d
        time.sleep(5)
    sys.exit('Droplet did not become active within 5 minutes.')


def reserved_ip(droplet_id, create):
    for ip in do('GET', '/reserved_ips')['reserved_ips']:
        if ip.get('droplet') and ip['droplet']['id'] == droplet_id:
            return ip['ip']
    if not create:
        return None
    ip = do('POST', '/reserved_ips', {'droplet_id': droplet_id})['reserved_ip']['ip']
    print(f'Assigned reserved IP {ip}')
    return ip


def ensure_firewall(droplet_id):
    for fw in do('GET', '/firewalls')['firewalls']:
        if fw['name'] == TAG:
            if droplet_id not in fw['droplet_ids']:
                do('POST', f'/firewalls/{fw["id"]}/droplets', {'droplet_ids': [droplet_id]})
            return
    do('POST', '/firewalls', {
        'name': TAG,
        'droplet_ids': [droplet_id],
        'inbound_rules': [
            {'protocol': 'tcp', 'ports': '22', 'sources': ANYWHERE},
            {'protocol': 'tcp', 'ports': '80', 'sources': ANYWHERE},
            {'protocol': 'tcp', 'ports': '443', 'sources': ANYWHERE},
            {'protocol': 'tcp', 'ports': '5001-5300', 'sources': ANYWHERE},
            {'protocol': 'udp', 'ports': '5001-5300', 'sources': ANYWHERE},
        ],
        'outbound_rules': [
            {'protocol': 'tcp', 'ports': 'all', 'destinations': ANYWHERE},
            {'protocol': 'udp', 'ports': 'all', 'destinations': ANYWHERE},
            {'protocol': 'icmp', 'destinations': ANYWHERE},
        ],
    })
    print('Created firewall')


def admin_url(droplet):
    return f'https://{public_ipv4(droplet).replace(".", "-")}.sslip.io'


def gateway_answers(url, token):
    """True once Traccar is up behind Caddy and accepts the service token."""
    req = urllib.request.Request(url + '/api/server', headers={'Authorization': f'Bearer {token}'})
    try:
        with urllib.request.urlopen(req, timeout=10) as res:
            return res.status == 200
    except Exception:
        return False


def wait_gateway(url, token):
    # Cloud-init downloads Traccar and Caddy fetches a certificate; ~10 minutes.
    for _ in range(90):
        if gateway_answers(url, token):
            return
        time.sleep(10)
    sys.exit(f'{url} is not answering after 15 minutes. Check the droplet console.')


# ── Vercel ───────────────────────────────────────────────────────────────────

def vercel(method, path, body=None, **query):
    team = os.environ.get('VERCEL_TEAM_ID')
    if team:
        query['teamId'] = team
    qs = ('?' + urllib.parse.urlencode(query)) if query else ''
    return request(method, 'https://api.vercel.com' + path + qs, os.environ['VERCEL_TOKEN'], body)


def school_projects():
    wanted = {p.strip() for p in os.environ.get('VERCEL_PROJECTS', '').split(',') if p.strip()}
    projects, cursor = [], None
    while True:
        page = vercel('GET', '/v10/projects', limit='100', **({'from': cursor} if cursor else {}))
        projects += page['projects']
        cursor = (page.get('pagination') or {}).get('next')
        if not cursor:
            break
    out = []
    for p in projects:
        envs = vercel('GET', f'/v10/projects/{p["id"]}/env')['envs']
        if wanted:
            if p['name'] in wanted:
                out.append((p, envs))
        elif any(e['key'] == MARKER_ENV for e in envs):
            out.append((p, envs))
    return out


def env_value(project_id, envs, key):
    for e in envs:
        if e['key'] == key and 'production' in (e.get('target') or []):
            return vercel('GET', f'/v1/projects/{project_id}/env/{e["id"]}').get('value')
    return None


def redeploy(project):
    deployments = vercel('GET', '/v6/deployments', projectId=project['id'], target='production',
                         state='READY', limit='1')['deployments']
    if not deployments:
        return False
    vercel('POST', '/v13/deployments', {
        'name': project['name'],
        'deploymentId': deployments[0]['uid'],
        'target': 'production',
    }, forceNew='1')
    return True


def sync(values):
    projects = school_projects()
    if not projects:
        print('No school projects found on Vercel.')
        return
    for project, envs in projects:
        changed = [k for k in KEYS if env_value(project['id'], envs, k) != values[k]]
        if not changed:
            print(f'  {project["name"]}: up to date')
            continue
        for key in changed:
            vercel('POST', f'/v10/projects/{project["id"]}/env', {
                'key': key,
                'value': values[key],
                'type': 'encrypted',
                'target': ['production', 'preview'],
            }, upsert='true')
        deployed = redeploy(project)
        print(f'  {project["name"]}: set {", ".join(changed)}'
              + ('; redeploying' if deployed else '; takes effect on its next deploy'))


def token_from_vercel():
    for project, envs in school_projects():
        token = env_value(project['id'], envs, 'TRACCAR_TOKEN')
        if token:
            return token
    return None


# ── Main ─────────────────────────────────────────────────────────────────────

def main():
    sync_only = '--sync' in sys.argv[1:]
    missing = [k for k in ('DIGITALOCEAN_TOKEN', 'VERCEL_TOKEN') if not os.environ.get(k)]
    if missing:
        if '--skip-if-unconfigured' in sys.argv[1:]:
            print(f'Skipping: {", ".join(missing)} not set.')
            return
        sys.exit(f'Set {", ".join(missing)} first.')

    droplet = find_droplet()
    token = None
    created = False
    if droplet:
        print(f'Gateway droplet {droplet["id"]} exists')
        token = token_from_vercel()
        if not token:
            sys.exit('The gateway exists but no school on Vercel has its token, so it cannot be recovered. '
                     'Destroy the gateway droplet and run this again to create a fresh one.')
    elif sync_only:
        sys.exit('No gateway droplet yet. Run without --sync to create it.')
    else:
        account = do('GET', '/account')['account']
        if account['status'] != 'active':
            sys.exit(f'DigitalOcean account is {account["status"]}: {account.get("status_message")}')
        token = secrets.token_hex(32)
        droplet = {'id': create_droplet(token)}
        created = True

    droplet = wait_active(droplet['id'])
    host = reserved_ip(droplet['id'], create=not sync_only)
    if not host:
        sys.exit('The gateway has no reserved IP. Run without --sync to assign one.')
    if not sync_only:
        ensure_firewall(droplet['id'])

    url = admin_url(droplet)
    values = {'TRACCAR_URL': url, 'TRACCAR_TOKEN': token, 'GPS_GATEWAY_HOST': host}
    if created:
        # Vercel is the only durable home for a new token, so store it before
        # the long wait: if this run dies, the next one can still recover it.
        print('Connecting schools on Vercel:')
        sync(values)
    print(f'Waiting for {url} (first boot takes about 10 minutes)...')
    wait_gateway(url, token)
    if not created:
        print('Connecting schools on Vercel:')
        sync(values)

    print()
    print(f'GPS server : {url}')
    print(f'Device IP  : {host}  (vendors add this as an extra server; AIS-140 port 5179)')


if __name__ == '__main__':
    main()
