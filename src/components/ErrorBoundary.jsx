import React from 'react'
import { useStore } from '../store'

function downloadBackup() {
  try {
    const data = useStore.getState().exportData()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `erp-backup-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
  } catch (e) {
    alert('Could not create a backup: ' + e.message)
  }
}

export default class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(error) {
    return { error }
  }

  componentDidCatch(error, info) {
    // Surfaced for debugging; the UI stays usable.
    console.error('ERP caught an error:', error, info)
  }

  componentDidUpdate(prevProps) {
    // Reset the error when the route (resetKey) changes so navigation recovers
    if (this.state.error && prevProps.resetKey !== this.props.resetKey) {
      this.setState({ error: null })
    }
  }

  render() {
    if (this.state.error) {
      return (
        <div className="min-h-[60vh] flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-white dark:bg-slate-800 rounded-2xl shadow-lg border border-gray-100 dark:border-slate-700 p-8 text-center">
            <div className="text-5xl mb-4">⚠️</div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-slate-100 mb-2">Something went wrong on this screen</h1>
            <p className="text-sm text-gray-500 dark:text-slate-400 mb-1">
              Don’t worry — <strong>your data is safe</strong>. Only this page hit a snag.
            </p>
            <p className="text-xs text-gray-400 dark:text-slate-500 mb-6 break-words font-mono">{String(this.state.error?.message || this.state.error)}</p>
            <div className="flex flex-col gap-2">
              <button onClick={() => this.setState({ error: null })} className="w-full bg-blue-600 text-white rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-blue-700">
                Try again
              </button>
              <button onClick={() => { window.location.hash = ''; window.location.reload() }} className="w-full bg-gray-100 dark:bg-slate-700 text-gray-700 dark:text-slate-200 rounded-lg px-4 py-2.5 text-sm font-medium hover:bg-gray-200 dark:hover:bg-slate-600">
                Reload the app
              </button>
              <button onClick={downloadBackup} className="w-full text-blue-600 dark:text-blue-400 rounded-lg px-4 py-2 text-sm font-medium hover:underline">
                Download a backup of my data
              </button>
            </div>
          </div>
        </div>
      )
    }
    return this.props.children
  }
}
