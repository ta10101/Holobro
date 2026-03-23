import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { RuntimeDiagnostics } from './NetworkToolsPanel'

export function DependencyCornerDock() {
  const [diag, setDiag] = useState<RuntimeDiagnostics | null>(null)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    setBusy(true)
    try {
      const r = await invoke<RuntimeDiagnostics>('net_runtime_diagnostics')
      setDiag(r)
    } catch {
      // keep last known state
    } finally {
      setBusy(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const t = window.setInterval(() => void refresh(), 60_000)
    return () => window.clearInterval(t)
  }, [refresh])

  return (
    <section className="deps-nav-card" aria-label="Runtime dependency health">
      <div className="deps-nav-head">
        <strong className="deps-title">Dependencies</strong>
        <button type="button" className="deps-refresh-btn" disabled={busy} onClick={() => void refresh()}>
          {busy ? '...' : '↻'}
        </button>
      </div>
      <div className="deps-nav-list">
        <p className="deps-nav-line">
          <span className="deps-label">Traceroute</span>
          <span className={diag?.tracerouteAvailable ? 'network-ok-badge' : 'network-miss-badge'}>
            {diag?.tracerouteAvailable ? (diag.tracerouteTool ?? 'Ready') : 'Missing'}
          </span>
        </p>
        <p className="deps-nav-line">
          <span className="deps-label">Nmap</span>
          <span className={diag?.nmapAvailable ? 'network-ok-badge' : 'network-miss-badge'}>
            {diag?.nmapAvailable ? 'Ready' : 'Missing'}
          </span>
        </p>
        <p className="deps-nav-line">
          <span className="deps-label">Shell</span>
          <span className={diag?.shellAvailable ? 'network-ok-badge' : 'network-miss-badge'}>
            {diag?.shellAvailable ? (diag.shellName ?? 'Ready') : 'Missing'}
          </span>
        </p>
      </div>
    </section>
  )
}
