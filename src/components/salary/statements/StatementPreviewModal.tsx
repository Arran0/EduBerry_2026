'use client'

import React, { useState } from 'react'
import dynamic from 'next/dynamic'
import { Download, FileText, Loader2 } from 'lucide-react'
import ModalShell from '@/components/ui/ModalShell'
import { Btn, SALARY_ICON } from '@/components/salary/ui'
import { StatementSpec, downloadStatement } from './generate'

const PDFViewer = dynamic(
  () => import('@react-pdf/renderer').then(m => ({ default: m.PDFViewer })),
  {
    ssr: false,
    loading: () => (
      <div className="h-full flex flex-col items-center justify-center text-slate-400">
        <div className="spinner mb-3" />
        <p className="text-sm">Rendering preview…</p>
      </div>
    ),
  },
)

interface Props {
  spec: StatementSpec
  title: string
  onClose: () => void
  /** Square the panel and its chrome — used from the Salary Manager's sharp-edged
   *  Download Centre, so a preview doesn't read as a different product mid-flow. */
  sharp?: boolean
}

export default function StatementPreviewModal({ spec, title, onClose, sharp = true }: Props) {
  const [downloading, setDownloading] = useState(false)

  const onDownload = async () => {
    setDownloading(true)
    try { await downloadStatement(spec) } catch (e) { console.error('download failed:', e) }
    setDownloading(false)
  }

  // The module's one sheet, so a preview opened from a popup reads as the next
  // step of it rather than a different product. The PDF fills the body edge to
  // edge; the shell keeps the header, the close control and the swipe-down.
  return (
    <ModalShell
      onClose={onClose}
      size="2xl"
      sharp={sharp}
      glass
      zClass="z-[60]"
      title={title}
      icon={<FileText size={16} />}
      iconClassName={SALARY_ICON}
      bodyClassName="!p-0 h-[72dvh] sm:h-[74vh] bg-slate-100"
      headerActions={
        <Btn tone="dark" onClick={onDownload} disabled={downloading}>
          {downloading ? <Loader2 size={13} className="animate-spin" /> : <Download size={13} />}
          <span className="hidden min-[400px]:inline">{downloading ? 'Saving…' : 'Download'}</span>
        </Btn>
      }
    >
      <PDFViewer showToolbar={false} style={{ width: '100%', height: '100%', border: 'none' }}>
        {spec.element}
      </PDFViewer>
    </ModalShell>
  )
}
