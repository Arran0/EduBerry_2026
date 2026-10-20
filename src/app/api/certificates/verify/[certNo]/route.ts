import { createClient } from '@supabase/supabase-js'
import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Public certificate verification. The certificates table has no anon SELECT
// policy, so this route reads with the service-role key and returns ONLY the
// safe snapshot fields a verifier needs — never the full data JSONB or internal
// ids. This is what the QR code on every certificate points at.

export async function GET(_request: NextRequest, props: { params: Promise<{ certNo: string }> }) {
  const params = await props.params;
  const certNo = decodeURIComponent(params.certNo ?? '').trim()
  if (!certNo) {
    return NextResponse.json({ found: false, error: 'Missing certificate number' }, { status: 400 })
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  if (!supabaseUrl || (!serviceRoleKey && !anonKey)) {
    return NextResponse.json({ found: false, error: 'Server not configured' }, { status: 500 })
  }

  const client = createClient(supabaseUrl, serviceRoleKey || anonKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await client
    .from('certificates')
    .select('certificate_no, cert_type, student_name, academic_year, issue_date, status')
    .eq('certificate_no', certNo)
    .maybeSingle()

  if (error) {
    console.error('certificate verify failed:', error)
    return NextResponse.json({ found: false, error: 'Lookup failed' }, { status: 500 })
  }
  if (!data) {
    return NextResponse.json({ found: false }, { status: 404 })
  }

  return NextResponse.json({
    found: true,
    revoked: data.status === 'revoked',
    certificate: {
      certificate_no: data.certificate_no,
      cert_type: data.cert_type,
      student_name: data.student_name,
      academic_year: data.academic_year,
      issue_date: data.issue_date,
      status: data.status,
    },
  })
}
