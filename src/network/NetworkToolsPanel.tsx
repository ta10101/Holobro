import { useCallback, useEffect, useState } from 'react'
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

export type DnsLookupResult = {
  query: string
  recordType: string
  lines: string[]
  notes: string[]
}

export type NetJsonHttpResult = {
  url: string
  status: number
  body: string
  notes: string[]
}

export type NmapScanResult = {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
}

export type RuntimeDiagnostics = {
  os: string
  tracerouteAvailable: boolean
  tracerouteTool?: string
  nmapAvailable: boolean
  nmapPath?: string
  shellAvailable: boolean
  shellName?: string
  nmapInstallHint: string
  tracerouteHint: string
  notes: string[]
}

type NetIdentity = {
  hostname: string
  localIp: string
  wanIp: string
}

type NmapPreset = {
  id: string
  label: string
  description: string
  profile: string
  ports?: string
  timing: string
  extraArgs?: string
}

const NMAP_PRESETS: NmapPreset[] = [
  {
    id: 'quick-web',
    label: 'Quick web recon',
    description: 'Fast scan of common web ports with service detection.',
    profile: 'version',
    ports: '80,443,8080,8443',
    timing: 'T4',
  },
  {
    id: 'top-1000',
    label: 'Top 1000 TCP',
    description: 'Default nmap popular TCP port sweep (great first pass).',
    profile: 'default',
    timing: 'T4',
  },
  {
    id: 'full-tcp-services',
    label: 'Full TCP + services',
    description: 'Scans all TCP ports and fingerprints service versions.',
    profile: 'full_tcp',
    timing: 'T4',
  },
  {
    id: 'stealth-syn',
    label: 'Stealth SYN',
    description: 'SYN scan profile, useful for fast host/service reconnaissance.',
    profile: 'syn',
    timing: 'T3',
  },
  {
    id: 'udp-core',
    label: 'UDP core services',
    description: 'Checks common UDP ports (DNS/NTP/SNMP/VPN) with UDP scan.',
    profile: 'udp',
    ports: '53,67,68,69,123,137,138,161,162,500,514,520,1900,4500',
    timing: 'T3',
  },
  {
    id: 'safe-scripts',
    label: 'Safe scripts',
    description: 'Version detect + default safe scripts for quick audit context.',
    profile: 'version',
    timing: 'T3',
    extraArgs: '--script default',
  },
  {
    id: 'aggressive-audit',
    label: 'Aggressive audit',
    description: 'A profile with OS, traceroute, and richer service probing.',
    profile: 'aggressive',
    timing: 'T4',
  },
  {
    id: 'firewalk-gateway',
    label: 'Firewalk path check',
    description: 'Uses traceroute + NSE firewalk to infer ACL/firewall behavior by hop.',
    profile: 'firewalk',
    timing: 'T3',
  },
  {
    id: 'evasion-frag-sp53',
    label: 'Evasion: frag + source-port 53',
    description: 'Fragmented probes with spoofed source port 53 to test simple filters.',
    profile: 'evasion',
    timing: 'T2',
  },
  {
    id: 'ack-firewall-map',
    label: 'Firewall map (ACK)',
    description: 'ACK scan profile to distinguish filtered vs unfiltered host paths.',
    profile: 'ack_map',
    timing: 'T3',
  },
]

function formatMbps(n: number): string {
  if (!Number.isFinite(n)) return '—'
  return `${n.toFixed(2)} Mbps`
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

function bgpProviderLabel(url: string): string {
  const u = url.toLowerCase()
  if (u.includes('bgpview.io')) return 'BGPView'
  if (u.includes('stat.ripe.net')) return 'RIPE Stat'
  return 'Unknown provider'
}

export function NetworkToolsPanel() {
  const [ipBusy, setIpBusy] = useState(false)
  const [ipErr, setIpErr] = useState<string | null>(null)
  const [ipStats, setIpStats] = useState<IpStatsResult | null>(null)
  const [identity, setIdentity] = useState<NetIdentity>({
    hostname: 'loading…',
    localIp: '—',
    wanIp: '—',
  })

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

  const [dnsName, setDnsName] = useState('example.com')
  const [dnsType, setDnsType] = useState('A')
  const [dnsBusy, setDnsBusy] = useState(false)
  const [dnsErr, setDnsErr] = useState<string | null>(null)
  const [dnsOut, setDnsOut] = useState<DnsLookupResult | null>(null)

  const [bgpIp, setBgpIp] = useState('1.1.1.1')
  const [bgpBusy, setBgpBusy] = useState(false)
  const [bgpErr, setBgpErr] = useState<string | null>(null)
  const [bgpOut, setBgpOut] = useState<NetJsonHttpResult | null>(null)

  const [rdapQuery, setRdapQuery] = useState('example.com')
  const [rdapBusy, setRdapBusy] = useState(false)
  const [rdapErr, setRdapErr] = useState<string | null>(null)
  const [rdapOut, setRdapOut] = useState<NetJsonHttpResult | null>(null)

  const [nmapTarget, setNmapTarget] = useState('scanme.nmap.org')
  const [nmapProfile, setNmapProfile] = useState('default')
  const [nmapPorts, setNmapPorts] = useState('')
  const [nmapTiming, setNmapTiming] = useState('T4')
  const [nmapExtra, setNmapExtra] = useState('')
  const [nmapPresetId, setNmapPresetId] = useState('top-1000')
  const [nmapBusy, setNmapBusy] = useState(false)
  const [nmapErr, setNmapErr] = useState<string | null>(null)
  const [nmapOut, setNmapOut] = useState<NmapScanResult | null>(null)
  const [diag, setDiag] = useState<RuntimeDiagnostics | null>(null)

  const refreshIp = useCallback(async () => {
    setIpBusy(true)
    setIpErr(null)
    try {
      const r = await invoke<IpStatsResult>('net_ip_stats')
      setIpStats(r)
      const localCandidate =
        r.interfaces.find((i) => i.family === 'ipv4' && !i.isLoopback)?.addr ||
        r.interfaces.find((i) => !i.isLoopback)?.addr ||
        r.interfaces[0]?.addr ||
        '—'
      setIdentity({
        hostname: r.hostname || '(unknown)',
        localIp: localCandidate,
        wanIp: r.public?.ip || '—',
      })
    } catch (e) {
      setIpErr(String(e))
      setIpStats(null)
      setIdentity((prev) => ({ ...prev, wanIp: 'unavailable' }))
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

  const runDns = useCallback(async () => {
    setDnsBusy(true)
    setDnsErr(null)
    setDnsOut(null)
    try {
      const r = await invoke<DnsLookupResult>('net_dns_lookup', {
        req: { name: dnsName.trim(), recordType: dnsType.trim() },
      })
      setDnsOut(r)
    } catch (e) {
      setDnsErr(String(e))
    } finally {
      setDnsBusy(false)
    }
  }, [dnsName, dnsType])

  const runBgp = useCallback(async () => {
    setBgpBusy(true)
    setBgpErr(null)
    setBgpOut(null)
    try {
      const r = await invoke<NetJsonHttpResult>('net_bgp_lookup', {
        req: { ip: bgpIp.trim() },
      })
      setBgpOut(r)
    } catch (e) {
      setBgpErr(String(e))
    } finally {
      setBgpBusy(false)
    }
  }, [bgpIp])

  const runRdap = useCallback(async () => {
    setRdapBusy(true)
    setRdapErr(null)
    setRdapOut(null)
    try {
      const r = await invoke<NetJsonHttpResult>('net_rdap_lookup', {
        req: { query: rdapQuery.trim() },
      })
      setRdapOut(r)
    } catch (e) {
      setRdapErr(String(e))
    } finally {
      setRdapBusy(false)
    }
  }, [rdapQuery])

  const runNmap = useCallback(async () => {
    setNmapBusy(true)
    setNmapErr(null)
    setNmapOut(null)
    try {
      const r = await invoke<NmapScanResult>('net_nmap_scan', {
        req: {
          target: nmapTarget.trim(),
          profile: nmapProfile,
          ports: nmapPorts.trim() || undefined,
          timing: nmapTiming,
          extraArgs: nmapExtra.trim() || undefined,
        },
      })
      setNmapOut(r)
    } catch (e) {
      setNmapErr(String(e))
    } finally {
      setNmapBusy(false)
    }
  }, [nmapTarget, nmapProfile, nmapPorts, nmapTiming, nmapExtra])

  const refreshDiagnostics = useCallback(async () => {
    try {
      const r = await invoke<RuntimeDiagnostics>('net_runtime_diagnostics')
      setDiag(r)
    } catch (e) {
      console.warn('Dependency diagnostics failed:', e)
      setDiag(null)
    }
  }, [])

  useEffect(() => {
    void refreshIp()
    const t = window.setInterval(() => void refreshIp(), 60_000)
    return () => window.clearInterval(t)
  }, [refreshIp])

  useEffect(() => {
    void refreshDiagnostics()
  }, [refreshDiagnostics])

  const selectedNmapPreset =
    NMAP_PRESETS.find((p) => p.id === nmapPresetId) ?? NMAP_PRESETS[0]

  const applyNmapPreset = useCallback((id: string) => {
    const p = NMAP_PRESETS.find((x) => x.id === id)
    if (!p) return
    setNmapPresetId(p.id)
    setNmapProfile(p.profile)
    setNmapPorts(p.ports ?? '')
    setNmapTiming(p.timing)
    setNmapExtra(p.extraArgs ?? '')
  }, [])

  return (
    <section className="panel network-tools-panel">
      <h2 className="network-tools-title">Network lab</h2>
      <aside className="network-identity-badge" aria-label="Current host network identity">
        <span className="badge-row">
          <strong>Host</strong> <span className="mono">{identity.hostname}</span>
        </span>
        <span className="badge-row">
          <strong>LAN</strong> <span className="mono">{identity.localIp}</span>
        </span>
        <span className="badge-row">
          <strong>WAN</strong> <span className="mono">{identity.wanIp}</span>
        </span>
      </aside>
      <p className="hint">
        Traceroute uses your OS (<code>tracert</code> / <code>traceroute</code>). DNS uses the system resolver (hickory).
        BGP snapshot comes from BGPView; RDAP uses the rdap.org bootstrap — not a live interactive looking glass.
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
          <h3>DNS lookup</h3>
          <p className="muted network-card-desc">A, AAAA, MX, TXT, NS, CNAME, or PTR (reverse: enter an IP).</p>
          <div className="network-trace-row network-dns-row">
            <input
              className="url"
              value={dnsName}
              onChange={(e) => setDnsName(e.target.value)}
              placeholder="Hostname or IP (for PTR)"
              aria-label="DNS name or IP"
            />
            <label className="network-hops-label">
              Type
              <select value={dnsType} onChange={(e) => setDnsType(e.target.value)} aria-label="DNS record type">
                {['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'PTR'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
            <button type="button" disabled={dnsBusy} onClick={() => void runDns()}>
              {dnsBusy ? 'Querying…' : 'Lookup'}
            </button>
          </div>
          {dnsErr ? <p className="error">{dnsErr}</p> : null}
          {dnsOut ? (
            <div className="network-trace-out">
              <p className="muted mono network-trace-cmd">
                {dnsOut.recordType} {dnsOut.query}
              </p>
              <ul className="network-dns-lines">
                {dnsOut.lines.map((line, i) => (
                  <li key={`${i}-${line.slice(0, 32)}`} className="mono">
                    {line}
                  </li>
                ))}
              </ul>
              {dnsOut.notes.length ? (
                <ul className="hint network-speed-notes">
                  {dnsOut.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </article>

        <article className="network-card net-tools-chrome">
          <h3>BGP snapshot</h3>
          <p className="muted network-card-desc">Route/origin summary for an IP (BGPView JSON).</p>
          <div className="network-trace-row">
            <input
              className="url"
              value={bgpIp}
              onChange={(e) => setBgpIp(e.target.value)}
              placeholder="IPv4 or IPv6"
              aria-label="IP for BGP lookup"
            />
            <button type="button" disabled={bgpBusy} onClick={() => void runBgp()}>
              {bgpBusy ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
          {bgpErr ? <p className="error">{bgpErr}</p> : null}
          {bgpOut ? (
            <div className="network-trace-out">
              <p>
                <span className="network-provider-badge">{bgpProviderLabel(bgpOut.url)}</span>
              </p>
              <p className="muted mono network-trace-cmd">
                HTTP {bgpOut.status} — {bgpOut.url}
              </p>
              <pre className="network-pre network-pre-json">{bgpOut.body}</pre>
              {bgpOut.notes.length ? (
                <ul className="hint network-speed-notes">
                  {bgpOut.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </article>

        <article className="network-card net-tools-chrome">
          <h3>RDAP / WHOIS</h3>
          <p className="muted network-card-desc">Registration data for a domain or IP (rdap.org → registry).</p>
          <div className="network-trace-row">
            <input
              className="url"
              value={rdapQuery}
              onChange={(e) => setRdapQuery(e.target.value)}
              placeholder="example.com or 203.0.113.1"
              aria-label="RDAP query"
            />
            <button type="button" disabled={rdapBusy} onClick={() => void runRdap()}>
              {rdapBusy ? 'Fetching…' : 'Fetch'}
            </button>
          </div>
          {rdapErr ? <p className="error">{rdapErr}</p> : null}
          {rdapOut ? (
            <div className="network-trace-out">
              <p className="muted mono network-trace-cmd">
                HTTP {rdapOut.status} — {rdapOut.url}
              </p>
              <pre className="network-pre network-pre-json">{rdapOut.body}</pre>
              {rdapOut.notes.length ? (
                <ul className="hint network-speed-notes">
                  {rdapOut.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
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
            <button
              type="button"
              disabled={traceBusy || (diag ? !diag.tracerouteAvailable : false)}
              onClick={() => void runTrace()}
            >
              {traceBusy ? 'Running…' : 'Run'}
            </button>
          </div>
          {diag && !diag.tracerouteAvailable ? <p className="error">{diag.tracerouteHint}</p> : null}
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
          <h3>Nmap scan</h3>
          <p className="muted network-card-desc">
            Full nmap wrapper (profile + custom args). Requires <code>nmap</code> installed and available on PATH.
          </p>
          <div className="network-trace-row">
            <label className="network-hops-label">
              Preset
              <select value={nmapPresetId} onChange={(e) => applyNmapPreset(e.target.value)}>
                {NMAP_PRESETS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            <input
              className="url"
              value={nmapTarget}
              onChange={(e) => setNmapTarget(e.target.value)}
              placeholder="Host / IP / CIDR"
              aria-label="Nmap target"
            />
            <label className="network-hops-label">
              Profile
              <select value={nmapProfile} onChange={(e) => setNmapProfile(e.target.value)}>
                {[
                  'default',
                  'ping',
                  'quick',
                  'syn',
                  'udp',
                  'version',
                  'os',
                  'aggressive',
                  'full_tcp',
                  'firewalk',
                  'evasion',
                  'ack_map',
                ].map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </label>
            <label className="network-hops-label">
              Timing
              <select value={nmapTiming} onChange={(e) => setNmapTiming(e.target.value)}>
                {['T0', 'T1', 'T2', 'T3', 'T4', 'T5'].map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="muted network-preset-desc">{selectedNmapPreset.description}</p>
          <div className="network-trace-row network-nmap-extra">
            <input
              className="url"
              value={nmapPorts}
              onChange={(e) => setNmapPorts(e.target.value)}
              placeholder="Ports, e.g. 22,80,443 or 1-1024 (optional)"
              aria-label="Nmap ports"
            />
            <input
              className="url"
              value={nmapExtra}
              onChange={(e) => setNmapExtra(e.target.value)}
              placeholder="Extra args, e.g. --script vuln --reason (optional)"
              aria-label="Nmap extra args"
            />
            <button
              type="button"
              disabled={nmapBusy || (diag ? !diag.nmapAvailable : false)}
              onClick={() => void runNmap()}
            >
              {nmapBusy ? 'Scanning…' : 'Run nmap'}
            </button>
          </div>
          {diag && !diag.nmapAvailable ? <p className="error mono">{diag.nmapInstallHint}</p> : null}
          {nmapErr ? <p className="error">{nmapErr}</p> : null}
          {nmapOut ? (
            <div className="network-trace-out">
              <p className="muted mono network-trace-cmd">{nmapOut.command}</p>
              {nmapOut.exitCode !== null && nmapOut.exitCode !== 0 ? (
                <p className="error">Exit code {nmapOut.exitCode}</p>
              ) : null}
              <pre className="network-pre network-pre-large">{nmapOut.stdout || '(no stdout)'}</pre>
              {nmapOut.stderr ? <pre className="network-pre network-pre-err">{nmapOut.stderr}</pre> : null}
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
