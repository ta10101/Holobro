import { Component, Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState, type ErrorInfo, type ReactNode } from 'react'
import {
  encodeHashToBase64,
  type ActionHash,
  type AppWebsocket,
} from '@holochain/client'
import { invoke } from '@tauri-apps/api/core'
import { tryConnectHolo } from './holochainConnect'
import {
  BrowserPanel,
  effectiveContentProxyUrl,
  isContentProxyActive,
  loadBrowserSettings,
  type BrowserSettings,
  type FetchBridgeResult,
} from './browser/BrowserPanel'
import {
  hcCreateBookmark,
  hcCreateContact,
  hcDeleteBookmark,
  hcListBookmarks,
  hcListContacts,
  hcListSignals,
  hcListThread,
  hcPostSignal,
  hcSendChat,
  type BookmarkRow,
  type ChatMessageRow,
  type ContactRow,
} from './holochain'
import { DependencyCornerDock } from './network/DependencyCornerDock'
import { TerminalMiniDock } from './terminal/TerminalMiniDock'
import { HoloBroLogo } from './components/HoloBroLogo'
import { HoloBroMascot } from './components/HoloBroMascot'
import { HoloBroWanderer } from './components/HoloBroWanderer'
import { StreetTags } from './components/StreetTags'
import { attachLocalVideo, createPeerConnection, wireRemoteStream } from './webrtc'
import './App.css'

const AssistantPanel = lazy(async () => {
  const m = await import('./assistant/AssistantPanel')
  return { default: m.AssistantPanel }
})
const NetworkToolsPanel = lazy(async () => {
  const m = await import('./network/NetworkToolsPanel')
  return { default: m.NetworkToolsPanel }
})
const WeatherPanel = lazy(async () => {
  const m = await import('./weather/WeatherPanel')
  return { default: m.WeatherPanel }
})
const IrcDockPanel = lazy(async () => {
  const m = await import('./irc/IrcDockPanel')
  return { default: m.IrcDockPanel }
})

type Tab = 'browser' | 'bookmarks' | 'contacts' | 'chat' | 'video' | 'assistant' | 'network' | 'weather'

type ContactDisplay = { id: string; name: string; peerKey: string; proof: string }
type AppIdentityResult = { username: string; device: string; displayName: string }

const LS_BOOKMARKS = 'holobro-demo-bookmarks'
const LS_BOOKMARKS_LEGACY = 'hab-demo-bookmarks'
const LS_CONTACTS = 'holobro-demo-contacts'
const LS_CONTACTS_LEGACY = 'hab-demo-contacts'
const LS_CHAT = 'holobro-demo-chat'
const LS_CHAT_LEGACY = 'hab-demo-chat'
const LS_STARTUP_GREETING = 'holobro-startup-greeting'
const LS_COOKIE_JAR = 'holobro-cookie-jar-count'
const LS_WANDERER_ENABLED = 'holobro-wanderer-enabled'
const LS_WANDERER_SOUND_PACK = 'holobro-wanderer-sound-pack'

function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return fallback
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

function loadJsonPrefer<T>(primary: string, legacy: string, fallback: T): T {
  const p = loadJson<T | null>(primary, null)
  if (p !== null && (Array.isArray(p) ? p.length >= 0 : p !== undefined)) {
    if (Array.isArray(p) || (typeof p === 'object' && p !== null)) return p as T
  }
  const fromLegacy = loadJson<T>(legacy, fallback)
  return fromLegacy
}

function saveJson(key: string, value: unknown) {
  localStorage.setItem(key, JSON.stringify(value))
}

function normalizeUrl(raw: string): string {
  const trimmed = raw.trim()
  if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed
  return `https://${trimmed}`
}

function pickWelcomeLine(name: string): string {
  const holobroLines = [
    `Missed you, ${name}. HoloBro is happy you are back.`,
    `Welcome back bro, ${name}. HoloBro was waiting.`,
    `Long time no see, ${name}. holobro has your lane ready.`,
    `${name}, HoloBro missed your style. Good to see you.`,
  ]
  const regularLines = [
    `Welcome back bro, ${name}.`,
    `Long time no see, ${name}. Good to have you here.`,
    `${name}, good to see you again. Let's surf the grid.`,
    `Hey ${name}, your board is waxed and ready.`,
    `${name}, you are back. Feels right.`,
    `Yo ${name}, the city lights stayed on for you.`,
  ]
  const includeHolobro = Math.random() < 0.4
  const source = includeHolobro ? holobroLines : regularLines
  return source[Math.floor(Math.random() * source.length)]
}

function playTranceBed() {
  const Ctx = (window as typeof window & { webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return
  const ctx = new Ctx()
  const now = ctx.currentTime
  const master = ctx.createGain()
  master.gain.value = 0.02
  master.connect(ctx.destination)

  const notes = [220, 246.94, 261.63, 329.63, 392, 329.63, 261.63, 246.94]
  for (let i = 0; i < 20; i += 1) {
    const osc = ctx.createOscillator()
    const g = ctx.createGain()
    osc.type = i % 2 === 0 ? 'triangle' : 'sawtooth'
    osc.frequency.value = notes[i % notes.length]
    g.gain.value = 0.0001
    const t = now + i * 0.25
    g.gain.linearRampToValueAtTime(0.05, t + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.23)
    osc.connect(g)
    g.connect(master)
    osc.start(t)
    osc.stop(t + 0.24)
  }
  window.setTimeout(() => {
    void ctx.close().catch(() => {})
  }, 5200)
}

function AppShell() {
  const [tab, setTab] = useState<Tab>('browser')
  const [hc, setHc] = useState<AppWebsocket | null>(null)
  const [hcStatus, setHcStatus] = useState<string>('Disconnected (demo storage)')
  const [hcAttempted, setHcAttempted] = useState(false)
  const [url, setUrl] = useState('https://example.com')
  const [browserSettings, setBrowserSettings] = useState<BrowserSettings>(() =>
    loadBrowserSettings(),
  )
  const [fetchResult, setFetchResult] = useState<FetchBridgeResult | null>(null)
  const [fetchErr, setFetchErr] = useState<string | null>(null)
  const [fetchBusy, setFetchBusy] = useState(false)

  const [bookmarks, setBookmarks] = useState<BookmarkRow[]>([])
  const [demoBookmarks, setDemoBookmarks] = useState<{ url: string; title: string }[]>(() =>
    loadJsonPrefer(LS_BOOKMARKS, LS_BOOKMARKS_LEGACY, []),
  )

  const [contacts, setContacts] = useState<ContactRow[]>([])
  const [demoContacts, setDemoContacts] = useState<{ name: string; peerKey: string; proof: string }[]>(
    () => loadJsonPrefer(LS_CONTACTS, LS_CONTACTS_LEGACY, []),
  )

  const [threadId, setThreadId] = useState('general')
  const [chatMessages, setChatMessages] = useState<ChatMessageRow[]>([])
  const [demoChat, setDemoChat] = useState<{ thread: string; body: string; at: number }[]>(() =>
    loadJsonPrefer(LS_CHAT, LS_CHAT_LEGACY, []),
  )
  const [chatInput, setChatInput] = useState('')

  const localVid = useRef<HTMLVideoElement>(null)
  const remoteVid = useRef<HTMLVideoElement>(null)
  const pcRef = useRef<RTCPeerConnection | null>(null)
  const hcConnectingRef = useRef(false)
  const [videoPeerB64, setVideoPeerB64] = useState('')
  const [videoLog, setVideoLog] = useState<string[]>([])
  const [appSettingsOpen, setAppSettingsOpen] = useState(false)
  const [startupGreetingEnabled, setStartupGreetingEnabled] = useState(() => {
    const raw = localStorage.getItem(LS_STARTUP_GREETING)
    return raw == null ? true : raw === '1'
  })
  const [wandererEnabled, setWandererEnabled] = useState(() => {
    const raw = localStorage.getItem(LS_WANDERER_ENABLED)
    return raw == null ? true : raw === '1'
  })
  const [wandererSoundPack, setWandererSoundPack] = useState<'calm' | 'chaos' | 'street'>(() => {
    const raw = localStorage.getItem(LS_WANDERER_SOUND_PACK)
    return raw === 'calm' || raw === 'chaos' || raw === 'street' ? raw : 'street'
  })
  const [cookieJarCount, setCookieJarCount] = useState<number>(() => {
    const raw = localStorage.getItem(LS_COOKIE_JAR)
    const n = Number(raw ?? '0')
    return Number.isFinite(n) && n > 0 ? Math.min(999, Math.floor(n)) : 0
  })

  const connectHolo = useCallback(async () => {
    if (hc || hcConnectingRef.current || hcAttempted) return
    hcConnectingRef.current = true
    setHcAttempted(true)
    const r = await tryConnectHolo()
    if (r.ok) {
      setHc(r.client)
      setHcStatus(
        r.signingNote
          ? `Connected (with warning: ${r.signingNote})`
          : 'Connected to Holochain',
      )
      try {
        const b = await hcListBookmarks(r.client)
        setBookmarks(b)
        const c = await hcListContacts(r.client)
        setContacts(c)
      } catch (e) {
        console.error(e)
        setHcStatus((s) => `${s} — zome read failed (see console).`)
      }
    } else {
      setHcStatus(`Demo mode: ${r.reason}`)
    }
    hcConnectingRef.current = false
  }, [hc, hcAttempted])

  useEffect(() => {
    const needsHolo = tab === 'bookmarks' || tab === 'contacts' || tab === 'chat' || tab === 'video'
    if (needsHolo) void connectHolo()
  }, [tab, connectHolo])

  useEffect(() => {
    const t = window.setTimeout(() => void connectHolo(), 2500)
    return () => window.clearTimeout(t)
  }, [connectHolo])

  useEffect(() => {
    saveJson(LS_BOOKMARKS, demoBookmarks)
  }, [demoBookmarks])
  useEffect(() => {
    saveJson(LS_CONTACTS, demoContacts)
  }, [demoContacts])
  useEffect(() => {
    saveJson(LS_CHAT, demoChat)
  }, [demoChat])

  useEffect(() => {
    localStorage.setItem(LS_STARTUP_GREETING, startupGreetingEnabled ? '1' : '0')
  }, [startupGreetingEnabled])
  useEffect(() => {
    localStorage.setItem(LS_WANDERER_ENABLED, wandererEnabled ? '1' : '0')
  }, [wandererEnabled])
  useEffect(() => {
    localStorage.setItem(LS_WANDERER_SOUND_PACK, wandererSoundPack)
  }, [wandererSoundPack])

  useEffect(() => {
    if (tab === 'browser' && !appSettingsOpen) {
      void invoke('content_webview_show').catch(() => {})
    } else {
      void invoke('content_webview_hide').catch(() => {})
    }
  }, [tab, appSettingsOpen])
  useEffect(() => {
    if (!appSettingsOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setAppSettingsOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [appSettingsOpen])
  useEffect(() => {
    localStorage.setItem(LS_COOKIE_JAR, String(cookieJarCount))
  }, [cookieJarCount])

  useEffect(() => {
    if (!startupGreetingEnabled) return
    let done = false
    const run = async () => {
      try {
        const id = await invoke<AppIdentityResult>('app_identity')
        if (done) return
        const line = `${pickWelcomeLine(id.displayName)}`
        playTranceBed()
        console.info('[startup-greeting]', line)
      } catch {
        if (done) return
        playTranceBed()
        console.info('[startup-greeting]', 'Welcome back. HoloBro missed you.')
      }
    }
    void run()
    return () => {
      done = true
    }
  }, [startupGreetingEnabled])

  const refreshThread = useCallback(async () => {
    if (!hc) return
    try {
      const m = await hcListThread(hc, threadId)
      setChatMessages(m)
    } catch (e) {
      console.error(e)
    }
  }, [hc, threadId])

  useEffect(() => {
    void refreshThread()
  }, [refreshThread])

  const fetchReader = useCallback(async () => {
    setFetchErr(null)
    setFetchResult(null)
    setFetchBusy(true)
    const u = normalizeUrl(url)
    const proxy =
      browserSettings.useProxyForFetch && isContentProxyActive(browserSettings)
        ? effectiveContentProxyUrl(browserSettings)
        : null
    try {
      const result = await invoke<FetchBridgeResult>('fetch_url_bridge', {
        req: {
          url: u,
          proxy,
          timeoutSecs: browserSettings.fetchTimeoutSecs,
          maxBytes: browserSettings.fetchMaxKb * 1024,
        },
      })
      setFetchResult(result)
    } catch (e) {
      setFetchErr(e instanceof Error ? e.message : String(e))
    } finally {
      setFetchBusy(false)
    }
  }, [url, browserSettings])

  const addBookmark = async () => {
    const u = normalizeUrl(url)
    const title = new URL(u).hostname
    const now = Date.now()
    setCookieJarCount((c) => Math.min(999, c + 1))
    if (hc) {
      await hcCreateBookmark(hc, { url: u, title, created_at_ms: now })
      setBookmarks(await hcListBookmarks(hc))
    } else {
      setDemoBookmarks((prev) => [...prev, { url: u, title }])
    }
  }

  const removeBookmark = async (hash: ActionHash | undefined, urlStr: string) => {
    if (hc && hash) {
      await hcDeleteBookmark(hc, hash)
      setBookmarks(await hcListBookmarks(hc))
    } else {
      setDemoBookmarks((prev) => prev.filter((b) => b.url !== urlStr))
    }
  }

  const addContact = async (name: string, peerKey: string, proof: string) => {
    const now = Date.now()
    if (hc) {
      await hcCreateContact(hc, {
        display_name: name,
        peer_agent_pubkey_b64: peerKey.trim(),
        invite_proof_b64: proof || '',
        created_at_ms: now,
      })
      setContacts(await hcListContacts(hc))
    } else {
      setDemoContacts((prev) => [...prev, { name, peerKey, proof }])
    }
  }

  const sendChat = async () => {
    const body = chatInput.trim()
    if (!body) return
    const now = Date.now()
    if (hc) {
      await hcSendChat(hc, { thread_id: threadId, body, sent_at_ms: now })
      setChatInput('')
      await refreshThread()
    } else {
      setDemoChat((prev) => [...prev, { thread: threadId, body, at: now }])
      setChatInput('')
    }
  }

  const pushSignal = async (kind: string, payload: unknown) => {
    if (!hc) {
      setVideoLog((l) => [...l, 'Holochain not connected — cannot signal.'])
      return
    }
    await hcPostSignal(hc, {
      peer_pubkey_b64: videoPeerB64 || '_broadcast_',
      signal_kind: kind,
      payload_json: JSON.stringify(payload),
      created_at_ms: Date.now(),
    })
  }

  const startVideo = async () => {
    setVideoLog((l) => [...l, 'Starting local capture…'])
    const pc = createPeerConnection()
    pcRef.current = pc
    wireRemoteStream(pc, remoteVid.current!)
    pc.onicecandidate = (ev) => {
      if (ev.candidate) void pushSignal('ice', ev.candidate.toJSON())
    }
    if (localVid.current) await attachLocalVideo(pc, localVid.current)
    const offer = await pc.createOffer()
    await pc.setLocalDescription(offer)
    await pushSignal('offer', offer)
    setVideoLog((l) => [...l, 'Posted offer to Holochain signaling (poll peer).'])
  }

  const applyRemoteSignals = async () => {
    if (!hc) return
    const rows = await hcListSignals(hc)
    const pc = pcRef.current
    if (!pc) return
    for (const r of rows) {
      if (videoPeerB64 && r.peer_pubkey_b64 !== videoPeerB64 && r.peer_pubkey_b64 !== '_broadcast_')
        continue
      try {
        const payload = JSON.parse(r.payload_json) as Record<string, unknown>
        if (r.signal_kind === 'offer' && payload.type === 'offer') {
          await pc.setRemoteDescription(
            new RTCSessionDescription(payload as unknown as RTCSessionDescriptionInit),
          )
          const ans = await pc.createAnswer()
          await pc.setLocalDescription(ans)
          await pushSignal('answer', ans)
        } else if (r.signal_kind === 'answer' && payload.type === 'answer') {
          await pc.setRemoteDescription(
            new RTCSessionDescription(payload as unknown as RTCSessionDescriptionInit),
          )
        } else if (r.signal_kind === 'ice' && payload.candidate) {
          await pc.addIceCandidate(new RTCIceCandidate(payload as unknown as RTCIceCandidateInit))
        }
      } catch (e) {
        console.warn(e)
      }
    }
  }

  const stopVideo = () => {
    pcRef.current?.close()
    pcRef.current = null
    if (localVid.current?.srcObject) {
      const s = localVid.current.srcObject as MediaStream
      s.getTracks().forEach((t) => t.stop())
      localVid.current.srcObject = null
    }
    if (remoteVid.current) remoteVid.current.srcObject = null
    setVideoLog((l) => [...l, 'Stopped.'])
  }

  const contactList = useMemo<ContactDisplay[]>(() => {
    if (hc) {
      return contacts.map((c) => ({
        id: c.peer_agent_pubkey_b64 || encodeHashToBase64(c.author),
        name: c.display_name,
        peerKey: c.peer_agent_pubkey_b64,
        proof: c.invite_proof_b64,
      }))
    }
    return demoContacts.map((c, i) => ({
      id: `demo-${i}`,
      name: c.name,
      peerKey: c.peerKey,
      proof: c.proof,
    }))
  }, [hc, contacts, demoContacts])

  return (
    <div className="app">
      <header className="topbar graffiti-bar">
        <div className="topbar-left">
          <HoloBroLogo className="topbar-logo" variant="header" />
          <div className="topbar-brand">
            <h1 className="graffiti-wordmark">HoloBro</h1>
            <p className="graffiti-sub">p2p shell · paint the web</p>
          </div>
        </div>
        <StreetTags />
        <div className="topbar-right">
          <span className="hc graffiti-status">{hcStatus}</span>
        </div>
      </header>
      <div className="shell">
        <nav className="nav">
          <div className="nav-links">
            {(
              [
                ['browser', 'Browser', '>>'],
                ['bookmarks', 'Bookmarks', '##'],
                ['contacts', 'Contacts', '@@'],
                ['chat', 'Chat', '//'],
                ['video', 'Video', '[]'],
                ['weather', 'Weather', '**'],
                ['assistant', 'Assistant', 'AI'],
                ['network', 'Network', '::'],
              ] as const
            ).map(([id, label, icon]) => (
              <button
                key={id}
                type="button"
                className={tab === id ? 'nav-btn active' : 'nav-btn'}
                onClick={() => {
                  if (id === 'browser') {
                    if (!appSettingsOpen) void invoke('content_webview_show').catch(() => {})
                  } else {
                    void invoke('content_webview_hide').catch(() => {})
                  }
                  setTab(id)
                  if (id === 'browser') setCookieJarCount((c) => Math.min(999, c + 1))
                }}
              >
                <span className="nav-icon" aria-hidden="true">{icon}</span>
                <span>{label}</span>
              </button>
            ))}
          </div>
          <div className="nav-bottom">
            <section className="cookie-jar-card" aria-label="Cookie counter">
              <div className="cookie-jar-head">
                <span className="cookie-logo" aria-hidden="true">🍪</span>
                <strong className="cookie-title">Cookie Jar</strong>
              </div>
              <p className="cookie-count">
                {cookieJarCount} cookie{cookieJarCount === 1 ? '' : 's'}
              </p>
              <button
                type="button"
                className="small cookie-eat-btn"
                onClick={() => setCookieJarCount(0)}
                disabled={cookieJarCount <= 0}
                title="Eat all cookies in the jar"
              >
                Eat cookies
              </button>
            </section>
            <div className="nav-mascot-wrap" aria-label="HoloBro mascot">
              <HoloBroMascot />
            </div>
            <section className="wander-nav-card" aria-label="HoloBro wanderer settings">
              <label className="check wander-check">
                <input
                  type="checkbox"
                  checked={wandererEnabled}
                  onChange={(e) => setWandererEnabled(e.target.checked)}
                />
                HoloBro wander
              </label>
              <label className="wander-pack-row">
                <span className="deps-label">Sound</span>
                <select
                  value={wandererSoundPack}
                  onChange={(e) => setWandererSoundPack(e.target.value as 'calm' | 'chaos' | 'street')}
                >
                  <option value="calm">Calm</option>
                  <option value="street">Street</option>
                  <option value="chaos">Chaos</option>
                </select>
              </label>
            </section>
            <button
              type="button"
              className={appSettingsOpen ? 'nav-btn active app-settings-toggle' : 'nav-btn app-settings-toggle'}
              onClick={() => setAppSettingsOpen((v) => !v)}
              aria-pressed={appSettingsOpen}
            >
              <span className="nav-icon" aria-hidden="true">⚙</span>
              <span>App Settings</span>
            </button>
            <DependencyCornerDock />
          </div>
        </nav>
        <main className="main">
          {tab === 'browser' && (
            <BrowserPanel
              url={url}
              setUrl={setUrl}
              settings={browserSettings}
              onSettingsChange={setBrowserSettings}
              onBookmark={() => void addBookmark()}
              onFetchBridge={() => void fetchReader()}
              fetchResult={fetchResult}
              fetchErr={fetchErr}
              fetchBusy={fetchBusy}
              active={tab === 'browser'}
            />
          )}
          {tab === 'bookmarks' && (
            <section className="panel">
              <h2>Bookmarks</h2>
              <ul className="list">
                {hc
                  ? bookmarks.map((b) => (
                      <li key={encodeHashToBase64(b.action_hash)}>
                        <a href={b.url} onClick={(e) => { e.preventDefault(); setUrl(b.url); setTab('browser') }}>
                          {b.title}
                        </a>
                        <span className="muted">{b.url}</span>
                        <button type="button" onClick={() => void removeBookmark(b.action_hash, b.url)}>
                          Remove
                        </button>
                      </li>
                    ))
                  : demoBookmarks.map((b) => (
                      <li key={b.url}>
                        <a href={b.url} onClick={(e) => { e.preventDefault(); setUrl(b.url); setTab('browser') }}>
                          {b.title}
                        </a>
                        <button type="button" onClick={() => void removeBookmark(undefined, b.url)}>
                          Remove
                        </button>
                      </li>
                    ))}
              </ul>
            </section>
          )}
          {tab === 'contacts' && (
            <section className="panel">
              <h2>Trusted contacts</h2>
              <p className="hint">
                On-chain contacts are authored by each agent; <code>invite_proof_b64</code> is where you
                store a signed invitation or pairwise secret. Verify cryptographically before trusting.
              </p>
              <ContactForm onAdd={(n, pk, p) => void addContact(n, pk, p)} />
              <ul className="list">
                {contactList.map((c) => (
                  <li key={c.id}>
                    <strong>{c.name}</strong>
                    <span className="mono" title="Peer agent key">
                      {c.peerKey || c.id}
                    </span>
                    {c.proof ? <span className="muted">{c.proof.slice(0, 48)}…</span> : null}
                  </li>
                ))}
              </ul>
            </section>
          )}
          {tab === 'chat' && (
            <section className="panel">
              <h2>P2P chat (Holochain)</h2>
              <div className="row">
                <label>
                  Thread
                  <input value={threadId} onChange={(e) => setThreadId(e.target.value)} />
                </label>
                <button type="button" onClick={() => void refreshThread()}>
                  Refresh
                </button>
              </div>
              <div className="chat">
                {hc
                  ? chatMessages.map((m) => (
                      <div key={encodeHashToBase64(m.action_hash)} className="msg">
                        <span className="mono">{encodeHashToBase64(m.author).slice(0, 12)}…</span>
                        {m.body}
                      </div>
                    ))
                  : demoChat
                      .filter((x) => x.thread === threadId)
                      .map((m) => (
                        <div key={m.at} className="msg">
                          (demo) {m.body}
                        </div>
                      ))}
              </div>
              <div className="row">
                <input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void sendChat()}
                  placeholder="Message…"
                />
                <button type="button" onClick={() => void sendChat()}>
                  Send
                </button>
              </div>
              <p className="hint">
                Encrypt message bodies client-side before production; the DNA stores opaque text for now.
              </p>
              <Suspense fallback={<p className="muted">Loading IRC…</p>}>
                <IrcDockPanel />
              </Suspense>
            </section>
          )}
          {tab === 'video' && (
            <section className="panel">
              <h2>Video (WebRTC + Holochain signaling)</h2>
              <p className="hint">
                Uses browser WebRTC. Offers/answers/ICE are posted to the <code>signaling</code> path
                in the DNA; poll peers in real apps or use app signals. For production, add TURN and
                encrypt signaling for non-trusted relays.
              </p>
              <div className="row">
                <label>
                  Filter peer pubkey (base64)
                  <input value={videoPeerB64} onChange={(e) => setVideoPeerB64(e.target.value)} placeholder="optional" />
                </label>
                <button type="button" onClick={() => void startVideo()}>
                  Start &amp; offer
                </button>
                <button type="button" onClick={() => void applyRemoteSignals()}>
                  Apply remote signals
                </button>
                <button type="button" onClick={stopVideo}>
                  Stop
                </button>
              </div>
              <div className="videos">
                <video ref={localVid} muted playsInline autoPlay />
                <video ref={remoteVid} playsInline autoPlay />
              </div>
              <ul className="log">
                {videoLog.map((line, i) => (
                  <li key={i}>{line}</li>
                ))}
              </ul>
            </section>
          )}
          {tab === 'weather' && (
            <Suspense fallback={<section className="panel"><p className="muted">Loading Weather…</p></section>}>
              <WeatherPanel />
            </Suspense>
          )}
          {tab === 'assistant' && (
            <Suspense fallback={<section className="panel"><p className="muted">Loading Assistant…</p></section>}>
              <AssistantPanel />
            </Suspense>
          )}
          {tab === 'network' && (
            <Suspense fallback={<section className="panel"><p className="muted">Loading Network tools…</p></section>}>
              <NetworkToolsPanel />
            </Suspense>
          )}
        </main>
      </div>
      <TerminalMiniDock />
      <HoloBroWanderer enabled={wandererEnabled} soundPack={wandererSoundPack} alwaysShow />
      {appSettingsOpen && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-label="App settings"
          onClick={(e) => {
            if (e.target === e.currentTarget) setAppSettingsOpen(false)
          }}
        >
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <h3>App settings</h3>
            <label className="check">
              <input
                type="checkbox"
                checked={startupGreetingEnabled}
                onChange={(e) => setStartupGreetingEnabled(e.target.checked)}
              />
              Startup greeting music (low 5s trance bed)
            </label>
            <div className="modal-actions">
              <button type="button" onClick={() => setAppSettingsOpen(false)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

class RootErrorBoundary extends Component<{ children: ReactNode }, { error: string | null }> {
  constructor(props: { children: ReactNode }) {
    super(props)
    this.state = { error: null }
  }

  static getDerivedStateFromError(err: unknown) {
    return { error: err instanceof Error ? err.message : String(err) }
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('UI crash:', error, info.componentStack)
  }

  render() {
    if (this.state.error) {
      return (
        <div className="app">
          <section className="panel">
            <h2>Runtime error</h2>
            <p className="error">
              {this.state.error}
            </p>
            <p className="hint">Open dev logs and share this message so it can be fixed quickly.</p>
          </section>
        </div>
      )
    }
    return this.props.children
  }
}

function ContactForm({
  onAdd,
}: {
  onAdd: (name: string, peerAgentPubkeyB64: string, proof: string) => void
}) {
  const [name, setName] = useState('')
  const [peerKey, setPeerKey] = useState('')
  const [proof, setProof] = useState('')
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault()
        if (!name.trim() || !peerKey.trim()) return
        onAdd(name.trim(), peerKey.trim(), proof.trim())
        setName('')
        setPeerKey('')
        setProof('')
      }}
    >
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Display name" />
      <input
        value={peerKey}
        onChange={(e) => setPeerKey(e.target.value)}
        placeholder="Peer AgentPubKey (base64)"
        className="wide"
      />
      <input value={proof} onChange={(e) => setProof(e.target.value)} placeholder="Invite proof (base64)" />
      <button type="submit">Add contact</button>
    </form>
  )
}

export default function App() {
  return (
    <RootErrorBoundary>
      <AppShell />
    </RootErrorBoundary>
  )
}
