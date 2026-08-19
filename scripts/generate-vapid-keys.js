#!/usr/bin/env node
/**
 * Generates the VAPID key pair used to sign Web Push messages.
 *
 * Run once per deployment:   node scripts/generate-vapid-keys.js
 * Then paste the output into .env.local (and your host's env settings).
 *
 * The keys are yours — Web Push has no vendor account and no per-message
 * cost. Regenerating them invalidates every existing subscription, so keep
 * the pair stable once users have enabled notifications.
 */

const webpush = require('web-push')

const { publicKey, privateKey } = webpush.generateVAPIDKeys()

console.log(`
Add these to .env.local (and your hosting provider's environment):

NEXT_PUBLIC_VAPID_PUBLIC_KEY=${publicKey}
VAPID_PRIVATE_KEY=${privateKey}
VAPID_SUBJECT=mailto:admin@your-school.example

NEXT_PUBLIC_VAPID_PUBLIC_KEY is sent to browsers (that is by design).
VAPID_PRIVATE_KEY must stay server-side only.
`)
