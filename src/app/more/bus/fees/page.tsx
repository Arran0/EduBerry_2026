import { redirect } from 'next/navigation'

// The Bus Fees view now lives as a section within the Bus Manager.
export default function BusFeesRedirect() {
  redirect('/more/bus?tab=fees')
}
