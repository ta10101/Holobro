import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
import { AssistantPanel } from './assistant/AssistantPanel'
import { NetworkToolsPanel, type IpStatsResult } from './network/NetworkToolsPanel'
import { IrcDockPanel } from './irc/IrcDockPanel'
import { HoloBroLogo } from './components/HoloBroLogo'
import { StreetTags } from './components/StreetTags'
import { attachLocalVideo, createPeerConnection, wireRemoteStream } from './webrtc'
import './App.css'

type Tab = 'browser' | 'bookmarks' | 'contacts' | 'chat' | 'video' | 'assistant' | 'network'

type ContactDisplay = { id: string; name: string; peerKey: string; proof: string }
type NetBadgeInfo = { hostname: string; localIp: string; wanIp: string }

const LS_BOOKMARKS = 'holobro-demo-bookmarks'
const LS_BOOKMARKS_LEGACY = 'hab-demo-bookmarks'
const LS_CONTACTS = 'holobro-demo-contacts'
const LS_CONTACTS_LEGACY = 'hab-demo-contacts'
const LS_CHAT = 'holobro-demo-chat'
const LS_CHAT_LEGACY = 'hab-demo-chat'

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

function App() {
  const [tab, setTab] = useState<Tab>('browser')
  const [hc, setHc] = useState<AppWebsocket | null>(null)
  const [hcStatus, setHcStatus] = useState<string>('Disconnected (demo storage)')
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
  const [videoPeerB64, setVideoPeerB64] = useState('')
  const [videoLog, setVideoLog] = useState<string[]>([])
  const [netBadge, setNetBadge] = useState<NetBadgeInfo>({
    hostname: 'loading…',
    localIp: '—',
    wanIp: '—',
  })

  useEffect(() => {
    void (async () => {
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
    })()
  }, [])

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
    let cancelled = false
    const refresh = async () => {
      try {
        const stats = await invoke<IpStatsResult>('net_ip_stats')
        if (cancelled) return
        const localCandidate =
          stats.interfaces.find((i) => i.family === 'ipv4' && !i.isLoopback)?.addr ||
          stats.interfaces.find((i) => !i.isLoopback)?.addr ||
          stats.interfaces[0]?.addr ||
          '—'
        setNetBadge({
          hostname: stats.hostname || '(unknown)',
          localIp: localCandidate,
          wanIp: stats.public?.ip || '—',
        })
      } catch {
        if (cancelled) return
        setNetBadge((p) => ({ ...p, wanIp: 'unavailable' }))
      }
    }
    void refresh()
    const t = window.setInterval(() => void refresh(), 60_000)
    return () => {
      cancelled = true
      window.clearInterval(t)
    }
  }, [])

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
        <span className="hc graffiti-status">{hcStatus}</span>
      </header>
      <div className="shell">
        <nav className="nav">
          {(
            [
              ['browser', 'Browser'],
              ['bookmarks', 'Bookmarks'],
              ['contacts', 'Contacts'],
              ['chat', 'Chat'],
              ['video', 'Video'],
              ['assistant', 'Assistant'],
              ['network', 'Network'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              className={tab === id ? 'nav-btn active' : 'nav-btn'}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <main className="main">
          {tab === 'browser' && (
            <>
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
              <IrcDockPanel />
            </>
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
          {tab === 'assistant' && <AssistantPanel />}
          {tab === 'network' && <NetworkToolsPanel />}
        </main>
      </div>
      <aside className="corner-net-badge" aria-label="Current host network identity">
        <span className="badge-row">
          <strong>Host</strong> <span className="mono">{netBadge.hostname}</span>
        </span>
        <span className="badge-row">
          <strong>LAN</strong> <span className="mono">{netBadge.localIp}</span>
        </span>
        <span className="badge-row">
          <strong>WAN</strong> <span className="mono">{netBadge.wanIp}</span>
        </span>
      </aside>
    </div>
  )
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

export default App
