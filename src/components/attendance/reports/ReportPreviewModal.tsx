'use client'

import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import type { DocumentProps } from '@react-pdf/renderer'
import { Download, FileSpreadsheet, FileText, Loader2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { GBTN } from '@/components/transport/glass'
import { ReportData, StatementSpec, downloadReportExcel, downloadStatement } from './generate'

const PDFViewer = dynamic(
  () => import('@react-pdf/renderer').then(m => ({ default: m.PDFViewer })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex flex-col items-center justify-center text-slate-400">
        <Loader2 size={22} className="animate-spin mb-3" />
        <p className="text-sm">Rendering preview…</p>
      </div>
    ),
  },
)

interface Props {
  spec: StatementSpec
  data: ReportData
  title: string
  subtitle?: string
  onClose: () => void
}

/** The document as it will download — the only way to the download buttons. */
export default function ReportPreviewModal({ spec, data, title, subtitle, onClose }: Props) {
  const [busy, setBusy] = useState<'pdf' | 'excel' | null>(null)

  const onPdf = async () => {
    setBusy('pdf')
    try { await downloadStatement(spec) } catch (e) { console.error('download failed:', e) }
    setBusy(null)
  }

  const onExcel = async () => {
    setBusy('excel')
    try { await downloadReportExcel(data) } catch (e) { console.error('excel export failed:', e) }
    setBusy(null)
  }

  return (
    <ModalShell
      onClose={onClose}
      glass
      size="2xl"
      title={title}
      subtitle={subtitle}
      icon={<FileText size={17} className="text-white" />}
      iconClassName="bg-[linear-gradient(135deg,#3D3B40,#27272A)]"
      bodyClassName="!p-0 h-[min(72dvh,52rem)]"
      footer={
        <div className="grid grid-cols-2 sm:flex sm:justify-end gap-2">
          <button onClick={onExcel} disabled={busy !== null} className={GBTN.secondary}>
            {busy === 'excel' ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            Excel
          </button>
          <button onClick={onPdf} disabled={busy !== null} className={GBTN.primary}>
            {busy === 'pdf' ? <Loader2 size={14} className="animate-spin" /> : <Download size={14} />}
            {busy === 'pdf' ? 'Saving…' : 'Download PDF'}
          </button>
        </div>
      }
    >
      <div className="relative h-full bg-[#EEEBE5]">
        {/* Shows through until the PDF has been laid out and paints over it. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center text-slate-400 pointer-events-none">
          <Loader2 size={22} className="animate-spin mb-3" />
          <p className="text-sm">Rendering preview…</p>
        </div>
        <PDFViewer showToolbar={false} style={{ position: 'relative', width: '100%', height: '100%', border: 'none' }}>
          {spec.element as React.ReactElement<DocumentProps>}
        </PDFViewer>
      </div>
    </ModalShell>
  )
}
