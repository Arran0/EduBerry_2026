'use client'

import React from 'react'

interface Props {
  children: React.ReactNode
  onClose?: () => void
}

interface State {
  error: Error | null
}

/**
 * Contains a crash to the popup that caused it.
 *
 * React's default recovery from an uncaught render/commit error below here —
 * with no error boundary anywhere above it — is to unmount the whole app.
 * From the outside that reads as the entire page going unresponsive: every
 * button and link stops working, not just this popup's, because there is no
 * app left mounted to handle the click. Wrapping a popup here means a bug in
 * it shows an apologetic dialog instead of taking the rest of the page down
 * with it.
 */
export default class ModalErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null }

  static getDerivedStateFromError(error: Error): State {
    return { error }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Modal crashed:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
          onClick={this.props.onClose}
        >
          <div
            className="bg-white border border-[#E4E4E7] p-5 max-w-sm w-full text-center shadow-2xl"
            onClick={e => e.stopPropagation()}
          >
            <p className="text-sm font-semibold text-[#18181B] mb-1">Something went wrong opening this.</p>
            <p className="text-xs text-[#71717A] mb-4 leading-relaxed">
              {this.state.error.message || 'Please close this and try again.'}
            </p>
            <button
              onClick={this.props.onClose}
              className="bg-[#27272A] hover:bg-[#18181B] text-white text-xs font-semibold px-4 py-2 transition-colors"
            >
              Close
            </button>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
