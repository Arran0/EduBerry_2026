import { redirect } from 'next/navigation'

// The Driver Payroll view now lives as a section within the Bus Manager.
export default function DriverPayrollRedirect() {
  redirect('/more/bus?tab=payroll')
}
