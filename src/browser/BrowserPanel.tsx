import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

/** Embedded page proxy: Off, Tor SOCKS, [AN.ON / JonDo / JAP](https://anon.inf.tu-dresden.de/index_en.html) local HTTP, or arbitrary URL. */
export type ContentProxyPreset = 'off' | 'tor' | 'jondo' | 'custom'

export type BrowserSettings = {
  zoom: number
  /** Tor / SOCKS or custom HTTP/SOCKS URL (used when preset is `tor` or `custom`). */
  torProxyUrl: string
  /**
   * JonDo / JAP local HTTP proxy when preset is `jondo` (JonDo often defaults to port 4001 — check your client).
   * @see https://anon.inf.tu-dresden.de/index_en.html
   */
  jondoProxyUrl: string
  /** Route embedded page through selected proxy; choose `off` for a normal direct connection. */
  contentProxyPreset: ContentProxyPreset
  useProxyForFetch: boolean
  /** HTTP bridge request timeout (seconds). */
  fetchTimeoutSecs: number
  /** Max response size for Fetch bridge (KiB). */
  fetchMaxKb: number
  /** Use WebView2 default User-Agent (Edge-class) — avoids a unique custom token. */
  stealthUserAgent: boolean
  /** Document-start script: block WebRTC constructors & lock down getUserMedia (best-effort). */
  privacyHardenContent: boolean
  /** Best-effort ad/tracker filtering for embedded pages. */
  blockAdsContent: boolean
  /** NoScript-like mode: block page JavaScript execution. */
  blockScriptsContent: boolean
  /** Non-persistent WebView2 profile for the embedded page. */
  contentIncognito: boolean
}

const JONDO_DEFAULT_HTTP = 'http://127.0.0.1:4001'

export function isContentProxyActive(s: BrowserSettings): boolean {
  return s.contentProxyPreset !== 'off'
}

/** URL passed to WebView2 / fetch bridge when a proxy preset is active. */
export function effectiveContentProxyUrl(s: BrowserSettings): string {
  switch (s.contentProxyPreset) {
    case 'jondo':
      return (s.jondoProxyUrl.trim() || JONDO_DEFAULT_HTTP)
    case 'tor':
    case 'custom':
      return (s.torProxyUrl.trim() || 'socks5://127.0.0.1:9050')
    default:
      return s.torProxyUrl.trim() || 'socks5://127.0.0.1:9050'
  }
}

function migrateLegacyContentProxy(p: Partial<BrowserSettings> & { useProxyForContent?: boolean }): {
  preset: ContentProxyPreset
  jondoUrl: string
} {
  if (
    typeof p.contentProxyPreset === 'string' &&
    ['off', 'tor', 'jondo', 'custom'].includes(p.contentProxyPreset)
  ) {
    return {
      preset: p.contentProxyPreset as ContentProxyPreset,
      jondoUrl:
        typeof p.jondoProxyUrl === 'string' && p.jondoProxyUrl.trim()
          ? p.jondoProxyUrl.trim()
          : JONDO_DEFAULT_HTTP,
    }
  }
  if (!p.useProxyForContent) {
    return { preset: 'off', jondoUrl: JONDO_DEFAULT_HTTP }
  }
  const u = (p.torProxyUrl || '').trim().toLowerCase()
  if (u.startsWith('socks')) return { preset: 'tor', jondoUrl: JONDO_DEFAULT_HTTP }
  if (u.startsWith('http')) {
    const legacyHttp = (p.torProxyUrl || '').trim()
    if (u.includes(':4001') || u.includes('jondo') || u.includes('jap')) {
      return { preset: 'jondo', jondoUrl: legacyHttp || JONDO_DEFAULT_HTTP }
    }
    return { preset: 'custom', jondoUrl: JONDO_DEFAULT_HTTP }
  }
  return { preset: 'custom', jondoUrl: JONDO_DEFAULT_HTTP }
}

export type FetchBridgeResult = {
  body: string
  status: number
  contentType: string
  finalUrl: string
  byteLength: number
}

const LS_SETTINGS = 'holobro-browser-settings'
const LS_SETTINGS_LEGACY = 'hab-browser-settings'

const ZOOM_PRESETS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2] as const

const PREVIEW_LIMIT = 12000

function zoomPercentOptions(currentZoom: number): number[] {
  const presetPcts = new Set(ZOOM_PRESETS.map((z) => Math.round(z * 100)))
  const p = Math.round(currentZoom * 100)
  const list = ZOOM_PRESETS.map((z) => Math.round(z * 100))
  if (!presetPcts.has(p)) {
    list.push(p)
    list.sort((a, b) => a - b)
  }
  return list
}

export function loadBrowserSettings(): BrowserSettings {
  try {
    const raw =
      localStorage.getItem(LS_SETTINGS) ?? localStorage.getItem(LS_SETTINGS_LEGACY)
    if (!raw) {
      return {
        zoom: 1,
        torProxyUrl: 'socks5://127.0.0.1:9050',
        jondoProxyUrl: JONDO_DEFAULT_HTTP,
        contentProxyPreset: 'off',
        useProxyForFetch: false,
        fetchTimeoutSecs: 45,
        fetchMaxKb: 2048,
        stealthUserAgent: true,
        privacyHardenContent: true,
        blockAdsContent: true,
        blockScriptsContent: false,
        contentIncognito: true,
      }
    }
    const p = JSON.parse(raw) as Partial<BrowserSettings> & { useProxyForContent?: boolean }
    const { preset: contentProxyPreset, jondoUrl: migratedJondo } = migrateLegacyContentProxy(p)
    return {
      zoom: typeof p.zoom === 'number' ? Math.min(2, Math.max(0.5, p.zoom)) : 1,
      torProxyUrl: typeof p.torProxyUrl === 'string' ? p.torProxyUrl : 'socks5://127.0.0.1:9050',
      jondoProxyUrl:
        typeof p.jondoProxyUrl === 'string' && p.jondoProxyUrl.trim()
          ? p.jondoProxyUrl.trim()
          : migratedJondo,
      contentProxyPreset,
      useProxyForFetch: Boolean(p.useProxyForFetch),
      fetchTimeoutSecs:
        typeof p.fetchTimeoutSecs === 'number'
          ? Math.min(600, Math.max(5, Math.round(p.fetchTimeoutSecs)))
          : 45,
      fetchMaxKb:
        typeof p.fetchMaxKb === 'number' ? Math.min(2048, Math.max(16, Math.round(p.fetchMaxKb))) : 2048,
      stealthUserAgent: typeof p.stealthUserAgent === 'boolean' ? p.stealthUserAgent : true,
      privacyHardenContent: typeof p.privacyHardenContent === 'boolean' ? p.privacyHardenContent : true,
      blockAdsContent: typeof p.blockAdsContent === 'boolean' ? p.blockAdsContent : true,
      blockScriptsContent: typeof p.blockScriptsContent === 'boolean' ? p.blockScriptsContent : false,
      contentIncognito: typeof p.contentIncognito === 'boolean' ? p.contentIncognito : true,
    }
  } catch {
    return {
      zoom: 1,
      torProxyUrl: 'socks5://127.0.0.1:9050',
      jondoProxyUrl: JONDO_DEFAULT_HTTP,
      contentProxyPreset: 'off',
      useProxyForFetch: false,
      fetchTimeoutSecs: 45,
      fetchMaxKb: 2048,
      stealthUserAgent: true,
      privacyHardenContent: true,
      blockAdsContent: true,
      blockScriptsContent: false,
      contentIncognito: true,
    }
  }
}

export function saveBrowserSettings(s: BrowserSettings) {
  localStorage.setItem(LS_SETTINGS, JSON.stringify(s))
}

function normalizeUrl(raw: string): string {
  const t = raw.trim()
  if (t.startsWith('http://') || t.startsWith('https://')) return t
  return `https://${t}`
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    return false
  }
}

export type BrowserPanelProps = {
  url: string
  setUrl: (u: string) => void
  settings: BrowserSettings
  onSettingsChange: (s: BrowserSettings) => void
  onBookmark: () => void
  onFetchBridge: () => void
  fetchResult: FetchBridgeResult | null
  fetchErr: string | null
  fetchBusy: boolean
  active: boolean
}

export function BrowserPanel({
  url,
  setUrl,
  settings,
  onSettingsChange,
  onBookmark,
  onFetchBridge,
  fetchResult,
  fetchErr,
  fetchBusy,
  active,
}: BrowserPanelProps) {
  const surfaceRef = useRef<HTMLDivElement>(null)
  const findInputRef = useRef<HTMLInputElement>(null)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [findCase, setFindCase] = useState(false)
  const [status, setStatus] = useState('Embedded page area below — click Go to load.')
  const [clipboardNote, setClipboardNote] = useState<string | null>(null)
  const [fetchPreviewExpanded, setFetchPreviewExpanded] = useState(false)

  useEffect(() => {
    if (!clipboardNote) return
    const t = window.setTimeout(() => setClipboardNote(null), 2200)
    return () => window.clearTimeout(t)
  }, [clipboardNote])

  useEffect(() => {
    setFetchPreviewExpanded(false)
  }, [fetchResult])

  // Persist every change (proxy Off, etc.) — avoids relying on the modal Save button alone.
  useEffect(() => {
    saveBrowserSettings(settings)
  }, [settings])

  const readBounds = useCallback(() => {
    const el = surfaceRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    return { x: r.left, y: r.top, width: r.width, height: r.height }
  }, [])

  const syncBounds = useCallback(async () => {
    const b = readBounds()
    if (!b || b.width < 8 || b.height < 8) return
    try {
      await invoke('content_webview_set_bounds', { bounds: b })
    } catch {
      /* no webview yet */
    }
  }, [readBounds])

  // Native child WebView2 stacks above HTML; while Settings is open it would steal every click (Save/Close dead).
  // Park it off-screen until the modal closes, then restore bounds.
  useEffect(() => {
    if (!active) return
    if (settingsOpen) {
      void invoke('content_webview_hide').catch(() => {})
      return
    }
    void invoke('content_webview_show').catch(() => {})
    void syncBounds()
    const t = window.setTimeout(() => void syncBounds(), 80)
    return () => window.clearTimeout(t)
  }, [settingsOpen, active, syncBounds])

  useLayoutEffect(() => {
    if (!active) return
    void syncBounds()
    const el = surfaceRef.current
    if (!el || typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => void syncBounds())
    ro.observe(el)
    window.addEventListener('resize', syncBounds)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', syncBounds)
    }
  }, [active, syncBounds])

  // Park native child webview off-screen when leaving this tab (see Rust: avoid WebView2 hide()).
  // Re-sync bounds when returning — do not call content_webview_focus here; it steals focus from the URL bar.
  useEffect(() => {
    if (!active) {
      void invoke('content_webview_hide').catch(() => {})
      return
    }
    let cancelled = false
    let timeoutId: ReturnType<typeof setTimeout> | undefined

    const bump = async () => {
      await invoke('content_webview_show').catch(() => {})
      await syncBounds()
      await new Promise<void>((r) => requestAnimationFrame(() => r()))
      if (cancelled) return
      await syncBounds()
      timeoutId = window.setTimeout(() => {
        if (cancelled) return
        void syncBounds()
      }, 120)
    }
    void bump()

    return () => {
      cancelled = true
      if (timeoutId !== undefined) window.clearTimeout(timeoutId)
      void invoke('content_webview_hide').catch(() => {})
    }
  }, [active, syncBounds])

  const applyZoom = useCallback(
    async (next: number) => {
      const z = Math.min(2, Math.max(0.25, Math.round(next * 100) / 100))
      const nextSettings = { ...settings, zoom: z }
      onSettingsChange(nextSettings)
      saveBrowserSettings(nextSettings)
      try {
        await invoke('content_webview_set_zoom', { scale: z })
      } catch {
        /* no webview */
      }
    },
    [settings, onSettingsChange],
  )

  const runFind = useCallback(
    (backwards: boolean) => {
      const q = findQuery.trim()
      if (!q) return
      void invoke('content_webview_find', {
        args: {
          query: q,
          caseSensitive: findCase,
          backwards,
        },
      })
    },
    [findQuery, findCase],
  )

  const openPage = async (settingsOverride?: BrowserSettings) => {
    const s = settingsOverride ?? settings
    const u = normalizeUrl(url)
    setUrl(u)
    const b = readBounds()
    if (!b) {
      setStatus('Layout not ready; try again.')
      return
    }
    try {
      await invoke('content_webview_ensure', {
        req: {
          url: u,
          bounds: b,
          privacy: {
            stealthUserAgent: s.stealthUserAgent,
            blockWebrtc: s.privacyHardenContent,
            blockAds: s.blockAdsContent,
            blockScripts: s.blockScriptsContent,
            useProxy: isContentProxyActive(s),
            proxyUrl: effectiveContentProxyUrl(s),
            incognito: s.contentIncognito,
          },
        },
      })
      await invoke('content_webview_set_zoom', { scale: s.zoom })
      await syncBounds()
      setStatus(
        isContentProxyActive(s)
          ? `Loaded via proxy (${s.contentProxyPreset}): ${u}`
          : `Loaded in app: ${u}`,
      )
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`Embed failed: ${msg}`)
    }
  }

  useEffect(() => {
    if (!active) return
    const onKey = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey

      if (e.key === 'Escape' && findOpen) {
        e.preventDefault()
        setFindOpen(false)
        return
      }

      if (mod && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setFindOpen(true)
        queueMicrotask(() => findInputRef.current?.focus())
        return
      }

      if (mod && e.key.toLowerCase() === 'p') {
        e.preventDefault()
        void invoke('content_webview_print')
          .then(() => setStatus('Print dialog requested.'))
          .catch((e) => {
            const msg = e instanceof Error ? e.message : String(e)
            setStatus(`Print failed: ${msg}`)
          })
        return
      }

      if (mod && (e.key === '+' || e.key === '=')) {
        e.preventDefault()
        void applyZoom(settings.zoom + 0.1)
        return
      }
      if (mod && e.key === '-') {
        e.preventDefault()
        void applyZoom(settings.zoom - 0.1)
        return
      }
      if (mod && e.key === '0') {
        e.preventDefault()
        void applyZoom(1)
        return
      }

      if (mod && e.shiftKey && e.key.toLowerCase() === 'r') {
        e.preventDefault()
        void invoke('content_webview_hard_reload')
        return
      }

      if (e.key === 'F3') {
        e.preventDefault()
        if (findQuery.trim()) {
          void invoke('content_webview_find', {
            args: {
              query: findQuery.trim(),
              caseSensitive: findCase,
              backwards: e.shiftKey,
            },
          })
        } else {
          setFindOpen(true)
        }
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [active, findOpen, findQuery, findCase, settings.zoom, applyZoom])

  useEffect(() => {
    if (findOpen) {
      queueMicrotask(() => findInputRef.current?.focus())
    }
  }, [findOpen])

  const copyUrlBar = async () => {
    const ok = await copyToClipboard(normalizeUrl(url))
    setClipboardNote(ok ? 'Address copied' : 'Copy failed')
  }

  const triggerPrint = useCallback(async () => {
    try {
      await invoke('content_webview_print')
      setStatus('Print dialog requested.')
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`Print failed: ${msg}`)
    }
  }, [])

  const toggleWebRtcHardening = useCallback(() => {
    const u = normalizeUrl(url)
    const next = { ...settings, privacyHardenContent: !settings.privacyHardenContent }
    onSettingsChange(next)
    saveBrowserSettings(next)
    setStatus(
      next.privacyHardenContent
        ? 'WebRTC hardening enabled. Rebuilding embedded page...'
        : 'WebRTC hardening disabled. Rebuilding embedded page...',
    )
    setUrl(u)
    window.setTimeout(() => {
      void openPage(next)
    }, 0)
  }, [settings, onSettingsChange, url, setUrl])

  const toggleAdBlocking = useCallback(() => {
    const u = normalizeUrl(url)
    const next = { ...settings, blockAdsContent: !settings.blockAdsContent }
    onSettingsChange(next)
    saveBrowserSettings(next)
    setStatus(
      next.blockAdsContent
        ? 'Ad block enabled. Rebuilding embedded page...'
        : 'Ad block disabled. Rebuilding embedded page...',
    )
    setUrl(u)
    window.setTimeout(() => {
      void openPage(next)
    }, 0)
  }, [settings, onSettingsChange, url, setUrl])

  const toggleNoScript = useCallback(() => {
    const u = normalizeUrl(url)
    const next = { ...settings, blockScriptsContent: !settings.blockScriptsContent }
    onSettingsChange(next)
    saveBrowserSettings(next)
    setStatus(
      next.blockScriptsContent
        ? 'NoScript enabled. Rebuilding embedded page...'
        : 'NoScript disabled. Rebuilding embedded page...',
    )
    setUrl(u)
    window.setTimeout(() => {
      void openPage(next)
    }, 0)
  }, [settings, onSettingsChange, url, setUrl])

  const runNavCommand = useCallback(async (command: string, okLabel: string) => {
    try {
      await invoke(command)
      setStatus(okLabel)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      setStatus(`${okLabel} failed: ${msg}`)
    }
  }, [])

  const fetchBodyPreview = fetchResult
    ? fetchPreviewExpanded
      ? fetchResult.body
      : fetchResult.body.slice(0, PREVIEW_LIMIT) +
        (fetchResult.body.length > PREVIEW_LIMIT ? '…' : '')
    : ''

  return (
    <section className="panel browser-panel">
      <div className="browser-chrome">
        <div className="browser-nav-row browser-nav-primary">
          <button
            type="button"
            title="Back (Alt+←)"
            onClick={() => void runNavCommand('content_webview_back', 'Back')}
          >
            ←
          </button>
          <button
            type="button"
            title="Forward"
            onClick={() => void runNavCommand('content_webview_forward', 'Forward')}
          >
            →
          </button>
          <button
            type="button"
            title="Reload"
            onClick={() => void runNavCommand('content_webview_reload', 'Reload requested')}
          >
            ↻
          </button>
          <button
            type="button"
            title="Hard reload (Ctrl+Shift+R)"
            onClick={() => void runNavCommand('content_webview_hard_reload', 'Hard reload requested')}
          >
            ⟳
          </button>
          <button
            type="button"
            title="Stop loading"
            onClick={() => void runNavCommand('content_webview_stop', 'Stop requested')}
          >
            ■
          </button>
          <input
            className="url"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void openPage()}
            placeholder="https://…"
            aria-label="URL"
          />
          <button type="button" onClick={() => void openPage()}>
            Go
          </button>
          <button type="button" title="Copy address" onClick={() => void copyUrlBar()}>
            Copy URL
          </button>
        </div>
        <div className="browser-nav-row browser-nav-secondary">
          <button type="button" disabled={fetchBusy} onClick={() => void onFetchBridge()}>
            {fetchBusy ? 'Fetching…' : 'Fetch (bridge)'}
          </button>
          <button type="button" onClick={onBookmark}>
            Bookmark
          </button>
          <button type="button" onClick={() => void openUrl(normalizeUrl(url))}>
            System browser
          </button>
          <label className="zoom-select-label">
            Zoom
            <select
              value={Math.round(settings.zoom * 100)}
              onChange={(e) => void applyZoom(Number(e.target.value) / 100)}
            >
              {zoomPercentOptions(settings.zoom).map((pct) => (
                <option key={pct} value={pct}>
                  {pct}%
                </option>
              ))}
            </select>
          </label>
          <button type="button" title="Zoom out (Ctrl+-)" onClick={() => void applyZoom(settings.zoom - 0.1)}>
            −
          </button>
          <span className="zoom-label">{Math.round(settings.zoom * 100)}%</span>
          <button type="button" title="Zoom in (Ctrl++)" onClick={() => void applyZoom(settings.zoom + 0.1)}>
            +
          </button>
          <button type="button" title="Reset zoom (Ctrl+0)" onClick={() => void applyZoom(1)}>
            100%
          </button>
          <button
            type="button"
            className={findOpen ? 'toggle active' : 'toggle'}
            onClick={() => setFindOpen((v) => !v)}
          >
            Find
          </button>
          <button type="button" title="Print (Ctrl+P)" onClick={() => void triggerPrint()}>
            Print
          </button>
          <button
            type="button"
            title="Toggle WebRTC hardening for embedded page"
            onClick={toggleWebRtcHardening}
          >
            WebRTC {settings.privacyHardenContent ? 'Off' : 'On'}
          </button>
          <button type="button" title="Toggle ad blocking for embedded page" onClick={toggleAdBlocking}>
            Ads {settings.blockAdsContent ? 'Off' : 'On'}
          </button>
          <button type="button" title="Toggle NoScript mode for embedded page" onClick={toggleNoScript}>
            NoScript {settings.blockScriptsContent ? 'Off' : 'On'}
          </button>
          <button type="button" onClick={() => setSettingsOpen(true)}>
            Settings
          </button>
        </div>
        {findOpen && (
          <div className="browser-find-row">
            <input
              ref={findInputRef}
              value={findQuery}
              onChange={(e) => setFindQuery(e.target.value)}
              placeholder="Find in page… (Enter / F3 next, Shift+F3 prev)"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  runFind(e.shiftKey)
                }
              }}
            />
            <label className="find-case">
              <input type="checkbox" checked={findCase} onChange={(e) => setFindCase(e.target.checked)} />
              Match case
            </label>
            <button type="button" onClick={() => runFind(false)}>
              Next
            </button>
            <button type="button" onClick={() => runFind(true)}>
              Previous
            </button>
            <button type="button" onClick={() => setFindQuery('')}>
              Clear
            </button>
          </div>
        )}
      </div>

      <div className="browser-privacy-badges" aria-label="Privacy mode">
        {settings.privacyHardenContent ? (
          <span className="privacy-badge" title="WebRTC/media hardening script enabled">
            Hardened
          </span>
        ) : null}
        {settings.stealthUserAgent ? (
          <span className="privacy-badge" title="Default WebView2 User-Agent">
            Stealth UA
          </span>
        ) : null}
        {isContentProxyActive(settings) ? (
          <span
            className="privacy-badge proxy"
            title={`Embedded page uses proxy (${settings.contentProxyPreset})`}
          >
            Proxy: {settings.contentProxyPreset}
          </span>
        ) : null}
        {settings.blockAdsContent ? (
          <span className="privacy-badge" title="Best-effort ad/tracker filtering is enabled">
            Ad block
          </span>
        ) : null}
        {settings.blockScriptsContent ? (
          <span className="privacy-badge" title="NoScript mode active (page JavaScript blocked)">
            NoScript
          </span>
        ) : null}
      </div>

      <p className="hint browser-shortcuts">
        <strong>Shortcuts:</strong> Ctrl+F find · F3 / Shift+F3 next/prev · Ctrl+P print · Ctrl± zoom · Ctrl+0 reset
        · Ctrl+Shift+R hard reload · Esc closes find.
        {clipboardNote ? <span className="clipboard-toast"> {clipboardNote}</span> : null}
      </p>
      <p className="hint">
        <strong>Stronger anonymity:</strong> run a local proxy (Tor SOCKS, or{' '}
        <a href="https://anon.inf.tu-dresden.de/index_en.html" target="_blank" rel="noreferrer">
          AN.ON / JAP / JonDo
        </a>{' '}
        HTTP proxy), set <em>Embedded page → mix / proxy</em> in Settings, then <strong>Go</strong> again so the
        webview rebuilds. Choose <strong>Off</strong> there to browse directly. Hardening reduces WebRTC-style IP
        leaks; this is not Tor Browser–grade anonymity.
      </p>

      <div ref={surfaceRef} className="browser-surface" />

      <div className="browser-note">
        <span className="muted">{status}</span>
      </div>

      {fetchErr && <p className="error">{fetchErr}</p>}

      {fetchResult && (
        <div className="fetch-result">
          <div className="fetch-meta">
            <span className={fetchResult.status >= 400 ? 'fetch-status err' : 'fetch-status'}>
              HTTP {fetchResult.status}
            </span>
            <span className="fetch-meta-item" title="Content-Type">
              {fetchResult.contentType || '—'}
            </span>
            <span className="fetch-meta-item">{fetchResult.byteLength.toLocaleString()} bytes</span>
            <span className="fetch-meta-url" title={fetchResult.finalUrl}>
              {fetchResult.finalUrl}
            </span>
          </div>
          <div className="fetch-actions">
            <button
              type="button"
              onClick={async () => {
                const ok = await copyToClipboard(fetchResult.body)
                setClipboardNote(ok ? 'Body copied' : 'Copy failed')
              }}
            >
              Copy body
            </button>
            <button
              type="button"
              onClick={async () => {
                const ok = await copyToClipboard(fetchResult.finalUrl)
                setClipboardNote(ok ? 'Final URL copied' : 'Copy failed')
              }}
            >
              Copy final URL
            </button>
            {fetchResult.body.length > PREVIEW_LIMIT && (
              <button type="button" onClick={() => setFetchPreviewExpanded((v) => !v)}>
                {fetchPreviewExpanded ? 'Show less' : 'Show full body'}
              </button>
            )}
          </div>
          <pre className="reader fetch-reader">{fetchBodyPreview}</pre>
        </div>
      )}

      {settingsOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="Browser settings"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSettingsOpen(false)
          }}
        >
          <div className="modal modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3>Browser settings</h3>
            <div className="settings-grid">
              <h4 className="settings-sub">Embedded page (privacy)</h4>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.stealthUserAgent}
                  onChange={(e) => onSettingsChange({ ...settings, stealthUserAgent: e.target.checked })}
                />
                Stealth User-Agent (WebView2 default — no custom browser token)
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.privacyHardenContent}
                  onChange={(e) => onSettingsChange({ ...settings, privacyHardenContent: e.target.checked })}
                />
                Block WebRTC / lock media APIs (best-effort anti IP-leak)
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.blockAdsContent}
                  onChange={(e) => onSettingsChange({ ...settings, blockAdsContent: e.target.checked })}
                />
                Block common ad/tracker hosts and ad elements (best-effort)
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.blockScriptsContent}
                  onChange={(e) => onSettingsChange({ ...settings, blockScriptsContent: e.target.checked })}
                />
                NoScript mode (disable page JavaScript; many modern sites will break)
              </label>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.contentIncognito}
                  onChange={(e) => onSettingsChange({ ...settings, contentIncognito: e.target.checked })}
                />
                Incognito embedded profile (non-persistent)
              </label>
              <label className="proxy-preset-label">
                Embedded page → mix / proxy
                <select
                  value={settings.contentProxyPreset}
                  onChange={(e) =>
                    onSettingsChange({
                      ...settings,
                      contentProxyPreset: e.target.value as ContentProxyPreset,
                    })
                  }
                >
                  <option value="off">Off — direct connection (no proxy)</option>
                  <option value="tor">Tor — SOCKS5 (local Tor, e.g. port 9050)</option>
                  <option value="jondo">AN.ON / JonDo / JAP — local HTTP proxy (mix cascades)</option>
                  <option value="custom">Custom — any HTTP or SOCKS URL below</option>
                </select>
              </label>
              {settings.contentProxyPreset === 'jondo' ? (
                <label>
                  JonDo / JAP local HTTP proxy URL
                  <input
                    value={settings.jondoProxyUrl}
                    onChange={(e) => onSettingsChange({ ...settings, jondoProxyUrl: e.target.value })}
                    placeholder={JONDO_DEFAULT_HTTP}
                  />
                </label>
              ) : settings.contentProxyPreset === 'tor' || settings.contentProxyPreset === 'custom' ? (
                <label>
                  {settings.contentProxyPreset === 'tor' ? 'Tor / SOCKS5 URL' : 'Custom proxy URL (HTTP or SOCKS5)'}
                  <input
                    value={settings.torProxyUrl}
                    onChange={(e) => onSettingsChange({ ...settings, torProxyUrl: e.target.value })}
                    placeholder={
                      settings.contentProxyPreset === 'tor'
                        ? 'socks5://127.0.0.1:9050'
                        : 'http://127.0.0.1:8080 or socks5://…'
                    }
                  />
                </label>
              ) : null}
              <p className="hint">
                <strong>AN.ON / JAP:</strong> install and start{' '}
                <a href="https://anon.inf.tu-dresden.de/index_en.html" target="_blank" rel="noreferrer">
                  JAP or JonDo
                </a>
                , note the <strong>local HTTP proxy</strong> host/port in the client (JonDo often uses{' '}
                <code>127.0.0.1:4001</code> — yours may differ), set preset to <em>AN.ON / JonDo</em>, then{' '}
                <strong>Go</strong>. Set to <em>Off</em> to disable. After changing these, press <strong>Go</strong>{' '}
                once — the embedded webview is recreated when privacy settings change.
              </p>

              <h4 className="settings-sub">Network</h4>
              <label className="check">
                <input
                  type="checkbox"
                  checked={settings.useProxyForFetch}
                  onChange={(e) => onSettingsChange({ ...settings, useProxyForFetch: e.target.checked })}
                />
                Use same proxy for Fetch (bridge)
              </label>
              <label>
                Fetch timeout (seconds)
                <input
                  type="number"
                  min={5}
                  max={600}
                  step={1}
                  value={settings.fetchTimeoutSecs}
                  onChange={(e) =>
                    onSettingsChange({
                      ...settings,
                      fetchTimeoutSecs: Math.min(600, Math.max(5, Number(e.target.value) || 45)),
                    })
                  }
                />
              </label>
              <label>
                Max Fetch response size (KiB)
                <input
                  type="number"
                  min={16}
                  max={2048}
                  step={64}
                  value={settings.fetchMaxKb}
                  onChange={(e) =>
                    onSettingsChange({
                      ...settings,
                      fetchMaxKb: Math.min(2048, Math.max(16, Number(e.target.value) || 2048)),
                    })
                  }
                />
              </label>
            </div>
            <p className="hint">
              With a non-<strong>Off</strong> preset and a running local proxy (Tor, JonDo/JAP, etc.), embedded
              traffic exits through that path. DNS and advanced leaks may still differ from a dedicated anonymity
              browser; this remains best-effort hardening, not a formal anonymity guarantee.
            </p>
            <div className="modal-actions">
              <button
                type="button"
                onClick={() => {
                  saveBrowserSettings(settings)
                  setSettingsOpen(false)
                }}
                title="Settings are also saved as you change them. Press Go on the Browser tab to apply proxy/privacy to the embedded page."
              >
                Save & close
              </button>
              <button type="button" onClick={() => setSettingsOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  )
}
