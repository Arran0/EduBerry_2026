#!/usr/bin/env python3
"""
Create the shared GPS gateway on DigitalOcean.

  DIGITALOCEAN_TOKEN=... python3 infra/gps-gateway/provision.py

Makes, or reuses if they already exist:
  - a droplet tagged gps-gateway (Bangalore, 1 GB, weekly backups) that
    installs Traccar from cloud-init.yaml on first boot,
  - a reserved IP, which is the address GPS vendors put into devices,
  - a firewall opening SSH, HTTP/HTTPS for the admin page's certificate, and
    the Traccar protocol ports 5001-5300 on TCP and UDP.

Then it waits for the admin page to answer and prints both addresses. Safe to
re-run: every step looks for what it would create first.
"""

import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

API = 'https://api.digitalocean.com/v2'
TAG = 'gps-gateway'
REGION = 'blr1'
SIZE = 's-1vcpu-1gb'
IMAGE = 'ubuntu-24-04-x64'
ANYWHERE = {'addresses': ['0.0.0.0/0', '::/0']}

TOKEN = os.environ.get('DIGITALOCEAN_TOKEN')
if not TOKEN:
    sys.exit('Set DIGITALOCEAN_TOKEN first.')


def api(method, path, body=None):
    req = urllib.request.Request(
        API + path,
        method=method,
        data=json.dumps(body).encode() if body is not None else None,
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'},
    )
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            raw = res.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as e:
        sys.exit(f'{method} {path} failed: {e.code} {e.read().decode(errors="replace")}')


def public_ipv4(droplet):
    for net in droplet['networks']['v4']:
        if net['type'] == 'public':
            return net['ip_address']
    return None


def ensure_droplet():
    existing = api('GET', f'/droplets?tag_name={TAG}')['droplets']
    if existing:
        print(f'Reusing droplet {existing[0]["id"]}')
        return existing[0]['id']

    user_data = (Path(__file__).parent / 'cloud-init.yaml').read_text()
    created = api('POST', '/droplets', {
        'name': TAG,
        'region': REGION,
        'size': SIZE,
        'image': IMAGE,
        'backups': True,
        'monitoring': True,
        'tags': [TAG],
        'user_data': user_data,
    })['droplet']
    print(f'Created droplet {created["id"]} ({SIZE} in {REGION})')
    return created['id']


def wait_active(droplet_id):
    for _ in range(60):
        d = api('GET', f'/droplets/{droplet_id}')['droplet']
        if d['status'] == 'active' and public_ipv4(d):
            return d
        time.sleep(5)
    sys.exit('Droplet did not become active within 5 minutes.')


def ensure_reserved_ip(droplet_id):
    for ip in api('GET', '/reserved_ips')['reserved_ips']:
        if ip.get('droplet') and ip['droplet']['id'] == droplet_id:
            return ip['ip']
    ip = api('POST', '/reserved_ips', {'droplet_id': droplet_id})['reserved_ip']['ip']
    print(f'Assigned reserved IP {ip}')
    return ip


def ensure_firewall(droplet_id):
    for fw in api('GET', '/firewalls')['firewalls']:
        if fw['name'] == TAG:
            if droplet_id not in fw['droplet_ids']:
                api('POST', f'/firewalls/{fw["id"]}/droplets', {'droplet_ids': [droplet_id]})
            return
    api('POST', '/firewalls', {
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


def wait_admin(url):
    # Cloud-init downloads Traccar and Caddy fetches a certificate; ~10 minutes.
    for _ in range(90):
        try:
            with urllib.request.urlopen(url, timeout=10) as res:
                if res.status == 200:
                    return True
        except Exception:
            pass
        time.sleep(10)
    return False


def main():
    account = api('GET', '/account')['account']
    if account['status'] != 'active':
        sys.exit(f'DigitalOcean account is {account["status"]}: {account.get("status_message")}')

    droplet_id = ensure_droplet()
    droplet = wait_active(droplet_id)
    reserved = ensure_reserved_ip(droplet_id)
    ensure_firewall(droplet_id)

    admin = f'https://{public_ipv4(droplet).replace(".", "-")}.sslip.io'
    print(f'Waiting for {admin} (first boot takes about 10 minutes)...')
    ready = wait_admin(admin)

    print()
    print(f'Admin page : {admin}' + ('' if ready else '  (not answering yet: check again in a few minutes)'))
    print(f'Device IP  : {reserved}  (vendors set this as the second server; AIS-140 port 5179)')
    print('Next       : open the admin page and Register now. The first account becomes the admin.')


if __name__ == '__main__':
    main()
