/**
 * EduBerry's shared GPS gateway, as a school and its GPS vendor see it.
 *
 * One Traccar server (infra/gps-gateway) serves every school. AIS-140 units
 * keep their government and SOS servers and add this one in a spare slot;
 * Traccar decodes the raw TCP and forwards to the school's ingest endpoint.
 * The address is public by design: it is what vendors type into devices.
 */

export const GPS_GATEWAY = {
  /** Unset until the gateway exists; the panel says so instead of guessing. */
  host: process.env.NEXT_PUBLIC_GPS_GATEWAY_HOST?.trim() || null,
  /** Traccar's `its` decoder: the standard AIS-140 packet format. */
  port: Number(process.env.NEXT_PUBLIC_GPS_GATEWAY_PORT) || 5179,
}

/** The message a school forwards to its GPS vendor, ready for WhatsApp. */
export function vendorMessage(o: { bus: string; imei: string; host: string; port: number }): string {
  return [
    'Hello, we use EduBerry for school bus tracking.',
    '',
    `Please add one more server to the GPS device on ${o.bus} (IMEI ${o.imei}):`,
    '',
    `Server IP: ${o.host}`,
    `Port: ${o.port}`,
    'Protocol: TCP, standard AIS-140 data format (the same format the device sends to the government server)',
    '',
    'Please use a spare or additional server slot. Do NOT change or remove the government (VLTD) server or the emergency (SOS) server.',
    '',
    'When it is done, please reply with the device make and model and the time you made the change.',
    '',
    'Thank you.',
  ].join('\n')
}

/**
 * What EduBerry support needs to link a device on the gateway: the IMEI it
 * reports under, and the address Traccar forwards it to. The address carries
 * the device's secret, because Traccar cannot sign requests.
 */
export function linkDetails(o: { bus: string; imei: string; origin: string; keyId: string; secret: string }): string {
  return [
    `Bus: ${o.bus}`,
    `IMEI: ${o.imei}`,
    `Forward URL: ${o.origin}/api/transport/ingest?key=${o.keyId}&secret=${o.secret}`,
  ].join('\n')
}
