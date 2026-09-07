export default function Footer() {
  return (
    <footer className="relative pt-4 pb-4 text-center text-xs text-slate-400 border-t border-slate-100 bg-white">
      {/* white pseudo-fill — covers the bottom padding gap so the page gradient doesn't bleed through */}
      <span className="pointer-events-none absolute inset-x-0 top-full bg-white" style={{ height: 'calc(4rem + env(safe-area-inset-bottom))' }} aria-hidden />
      Powered by{' '}
      <a href="https://edzee.org/" target="_blank" rel="noopener noreferrer" className="font-medium text-slate-500 hover:text-slate-700 transition-colors">Edzee</a>
      <span className="mx-2 text-slate-300">·</span>
      <a href="https://edzee.org/terms" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600 transition-colors">Terms</a>
      <span className="mx-2 text-slate-300">·</span>
      <a href="https://edzee.org/privacy" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600 transition-colors">Privacy</a>
      <span className="mx-2 text-slate-300">·</span>
      <a href="https://edzee.org/cookies" target="_blank" rel="noopener noreferrer" className="hover:text-slate-600 transition-colors">Cookies</a>
    </footer>
  )
}
