import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

export type IpInterfaceRow = {
  name: string
  addr: string
  family: string
  isLoopback: boolean
}

export type PublicIpInfo = {
  ip?: string
  city?: string
  region?: string
  country?: string
  isp?: string
}

export type IpStatsResult = {
  hostname: string
  interfaces: IpInterfaceRow[]
  public?: PublicIpInfo
  warnings: string[]
}

export type TracerouteResult = {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
}

export type SpeedTestResult = {
  downloadBytes: number
  downloadSecs: number
  downloadMbps: number
  uploadBytes: number
  uploadSecs: number
  uploadMbps: number
  notes: string[]
}

function formatMbps(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(2)} Mbps`
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export function NetworkToolsPanel() {
  const [ipBusy, setIpBusy] = useState(false)
  const [ipErr, setIpErr] = useState<string | null>(null)
  const [ipStats, setIpStats] = useState<IpStatsResult | null>(null)

  const [traceHost, setTraceHost] = useState('1.1.1.1')
  const [traceHops, setTraceHops] = useState(20)
  const [traceBusy, setTraceBusy] = useState(false)
  const [traceErr, setTraceErr] = useState<string | null>(null)
  const [traceOut, setTraceOut] = useState<TracerouteResult | null>(null)

  const [dlMb, setDlMb] = useState(5)
  const [ulKb, setUlKb] = useState(512)
  const [speedBusy, setSpeedBusy] = useState(false)
  const [speedErr, setSpeedErr] = useState<string | null>(null)
  const [speedOut, setSpeedOut] = useState<SpeedTestResult | null>(null)

  const refreshIp = useCallback(async () => {
    setIpBusy(true)
    setIpErr(null)
    try {
      const r = await invoke<IpStatsResult>('net_ip_stats')
      setIpStats(r)
    } catch (e) {
      setIpErr(String(e))
      setIpStats(null)
    } finally {
      setIpBusy(false)
    }
  }, [])

  const runTrace = useCallback(async () => {
    setTraceBusy(true)
    setTraceErr(null)
    setTraceOut(null)
    try {
      const r = await invoke<TracerouteResult>('net_traceroute', {
        req: { host: traceHost.trim(), maxHops: traceHops },
      })
      setTraceOut(r)
    } catch (e) {
      setTraceErr(String(e))
    } finally {
      setTraceBusy(false)
    }
  }, [traceHost, traceHops])

  const runSpeed = useCallback(async () => {
    setSpeedBusy(true)
    setSpeedErr(null)
    setSpeedOut(null)
    const downloadBytes = Math.round(Math.max(0.25, dlMb) * 1024 * 1024)
    const uploadBytes = Math.round(Math.max(16, ulKb) * 1024)
    try {
      const r = await invoke<SpeedTestResult>('net_speed_test', {
        req: { downloadBytes, uploadBytes },
      })
      setSpeedOut(r)
    } catch (e) {
      setSpeedErr(String(e))
    } finally {
      setSpeedBusy(false)
    }
  }, [dlMb, ulKb])

  return (
    <section className="panel network-tools-panel">
      <h2 className="network-tools-title">Network lab</h2>
      <p className="hint">
        Traceroute uses your OS (<code>tracert</code> / <code>traceroute</code>). Speed test is a rough HTTP sample — not a
        full speedtest.net session.
      </p>

      <div className="network-tools-grid">
        <article className="network-card net-tools-chrome">
          <h3>IP & interfaces</h3>
          <p className="muted network-card-desc">Machine name, local addresses, and public IP (via ipwho.is).</p>
          <button type="button" disabled={ipBusy} onClick={() => void refreshIp()}>
            {ipBusy ? 'Refreshing…' : 'Refresh stats'}
          </button>
          {ipErr ? <p className="error">{ipErr}</p> : null}
          {ipStats ? (
            <div className="network-ip-block">
              <p>
                <strong>Hostname</strong> <span className="mono">{ipStats.hostname}</span>
              </p>
              {ipStats.public ? (
                <div className="network-public">
                  <p>
                    <strong>Public</strong>{' '}
                    <span className="mono">{ipStats.public.ip ?? '—'}</span>
                  </p>
                  <ul className="network-meta-list">
                    {[ipStats.public.city, ipStats.public.region, ipStats.public.country].filter(Boolean).length ? (
                      <li>{[ipStats.public.city, ipStats.public.region, ipStats.public.country].filter(Boolean).join(' · ')}</li>
                    ) : null}
                    {ipStats.public.isp ? <li className="muted">ISP: {ipStats.public.isp}</li> : null}
                  </ul>
                </div>
              ) : null}
              {ipStats.warnings.length ? (
                <ul className="network-warnings">
                  {ipStats.warnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              ) : null}
              <table className="network-if-table">
                <thead>
                  <tr>
                    <th>Interface</th>
                    <th>Address</th>
                    <th>Family</th>
                  </tr>
                </thead>
                <tbody>
                  {ipStats.interfaces.map((row) => (
                    <tr key={`${row.name}-${row.addr}`} className={row.isLoopback ? 'loopback' : undefined}>
                      <td>{row.name}</td>
                      <td className="mono">{row.addr}</td>
                      <td>{row.family}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </article>

        <article className="network-card net-tools-chrome">
          <h3>Traceroute</h3>
          <p className="muted network-card-desc">Max ~2–3 minutes for distant hosts.</p>
          <div className="network-trace-row">
            <input
              className="url"
              value={traceHost}
              onChange={(e) => setTraceHost(e.target.value)}
              placeholder="Host or IP"
              aria-label="Traceroute host"
            />
            <label className="network-hops-label">
              Hops
              <input
                type="number"
                min={1}
                max={64}
                value={traceHops}
                onChange={(e) => setTraceHops(Number(e.target.value) || 20)}
              />
            </label>
            <button type="button" disabled={traceBusy} onClick={() => void runTrace()}>
              {traceBusy ? 'Running…' : 'Run'}
            </button>
          </div>
          {traceErr ? <p className="error">{traceErr}</p> : null}
          {traceOut ? (
            <div className="network-trace-out">
              <p className="muted mono network-trace-cmd">{traceOut.command}</p>
              {traceOut.exitCode !== null && traceOut.exitCode !== 0 ? (
                <p className="error">Exit code {traceOut.exitCode}</p>
              ) : null}
              <pre className="network-pre">{traceOut.stdout || '(no stdout)'}</pre>
              {traceOut.stderr ? <pre className="network-pre network-pre-err">{traceOut.stderr}</pre> : null}
            </div>
          ) : null}
        </article>

        <article className="network-card net-tools-chrome network-card-wide">
          <h3>Speed check</h3>
          <p className="muted network-card-desc">
            Download from Cloudflare edge; upload via httpbin POST. Tune payload sizes to reduce noise from overhead.
          </p>
          <div className="network-speed-row">
            <label>
              Download ~MB
              <input
                type="number"
                min={0.25}
                max={25}
                step={0.25}
                value={dlMb}
                onChange={(e) => setDlMb(Number(e.target.value) || 5)}
              />
            </label>
            <label>
              Upload KB
              <input type="number" min={16} max={4096} step={64} value={ulKb} onChange={(e) => setUlKb(Number(e.target.value) || 512)} />
            </label>
            <button type="button" disabled={speedBusy} onClick={() => void runSpeed()}>
              {speedBusy ? 'Testing…' : 'Run speed check'}
            </button>
          </div>
          {speedErr ? <p className="error">{speedErr}</p> : null}
          {speedOut ? (
            <div className="network-speed-results">
              <div className="network-speed-metric">
                <span className="network-speed-label">↓ Download</span>
                <strong>{formatMbps(speedOut.downloadMbps)}</strong>
                <span className="muted">
                  {formatMb(speedOut.downloadBytes)} in {speedOut.downloadSecs.toFixed(2)}s
                </span>
              </div>
              <div className="network-speed-metric">
                <span className="network-speed-label">↑ Upload</span>
                <strong>{speedOut.uploadBytes ? formatMbps(speedOut.uploadMbps) : '—'}</strong>
                <span className="muted">
                  {speedOut.uploadBytes
                    ? `${(speedOut.uploadBytes / 1024).toFixed(0)} KB in ${speedOut.uploadSecs.toFixed(2)}s`
                    : 'Upload skipped or failed'}
                </span>
              </div>
              <ul className="hint network-speed-notes">
                {speedOut.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </article>
      </div>
    </section>
  )
}
