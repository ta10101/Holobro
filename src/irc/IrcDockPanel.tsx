import { useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

type IrcNetworkPreset = {
  id: string
  label: string
  server: string
  port: number
  tls: boolean
  channelHint: string
}

const NETWORKS: IrcNetworkPreset[] = [
  { id: 'efnet', label: 'EFnet', server: 'irc.efnet.org', port: 6667, tls: false, channelHint: '#efnet' },
  { id: 'darknet', label: 'Darknet', server: 'irc.darkscience.net', port: 6697, tls: true, channelHint: '#darkscience' },
  { id: 'libera', label: 'LiberaChat', server: 'irc.libera.chat', port: 6697, tls: true, channelHint: '#libera' },
  { id: 'oftc', label: 'OFTC', server: 'irc.oftc.net', port: 6697, tls: true, channelHint: '#oftc' },
  { id: 'quakenet', label: 'QuakeNet', server: 'irc.quakenet.org', port: 6697, tls: true, channelHint: '#quakenet' },
]

const TOP_20_COMMANDS = [
  '/nick newNick',
  '/user user 0 * :Real Name',
  '/join #channel',
  '/join #channel key',
  '/part #channel',
  '/part #channel :reason',
  '/msg nick message',
  '/notice nick message',
  '/me action text',
  '/topic #channel new topic',
  '/mode #channel +m',
  '/invite nick #channel',
  '/kick #channel nick :reason',
  '/who #channel',
  '/whois nick',
  '/names #channel',
  '/list',
  '/away I am away',
  '/quit :bye',
  '/raw COMMAND params',
] as const

type IrcPollResult = { connected: boolean; lines: string[] }

const LS_IRC_NICK = 'holobro-irc-nick'
const LS_IRC_USER = 'holobro-irc-user'
const LS_IRC_REAL = 'holobro-irc-real'
const LS_IRC_NETWORK = 'holobro-irc-network'
const LS_IRC_CHANNEL = 'holobro-irc-channel'
const LS_IRC_TLS = 'holobro-irc-tls'

function loadString(key: string, fallback: string): string {
  try {
    return localStorage.getItem(key) || fallback
  } catch {
    return fallback
  }
}

export function IrcDockPanel() {
  const [networkId, setNetworkId] = useState(() => loadString(LS_IRC_NETWORK, NETWORKS[0].id))
  const [server, setServer] = useState('irc.efnet.org')
  const [port, setPort] = useState(6667)
  const [useTls, setUseTls] = useState(() => loadString(LS_IRC_TLS, '0') === '1')
  const [nick, setNick] = useState(() => loadString(LS_IRC_NICK, `holobro${Math.floor(Math.random() * 900 + 100)}`))
  const [username, setUsername] = useState(() => loadString(LS_IRC_USER, 'holobro'))
  const [realname, setRealname] = useState(() => loadString(LS_IRC_REAL, 'HoloBro IRC'))
  const [channel, setChannel] = useState(() => loadString(LS_IRC_CHANNEL, '#general'))
  const [line, setLine] = useState('')
  const [busy, setBusy] = useState(false)
  const [connected, setConnected] = useState(false)
  const [status, setStatus] = useState('Not connected')
  const [log, setLog] = useState<string[]>([])

  const preset = useMemo(
    () => NETWORKS.find((n) => n.id === networkId) || NETWORKS[0],
    [networkId],
  )
  const sessionId = `browser-irc-${networkId}`

  useEffect(() => {
    setServer(preset.server)
    setPort(preset.port)
    setUseTls(preset.tls)
    if (!channel.trim()) setChannel(preset.channelHint)
  }, [preset, channel])

  useEffect(() => {
    localStorage.setItem(LS_IRC_NICK, nick)
    localStorage.setItem(LS_IRC_USER, username)
    localStorage.setItem(LS_IRC_REAL, realname)
    localStorage.setItem(LS_IRC_NETWORK, networkId)
    localStorage.setItem(LS_IRC_CHANNEL, channel)
    localStorage.setItem(LS_IRC_TLS, useTls ? '1' : '0')
  }, [nick, username, realname, networkId, channel, useTls])

  useEffect(() => {
    if (!connected) return
    const timer = window.setInterval(() => {
      void (async () => {
        try {
          const r = await invoke<IrcPollResult>('irc_poll', {
            req: { sessionId, limit: 200 },
          })
          setConnected(r.connected)
          if (r.lines.length) setLog((prev) => [...prev, ...r.lines].slice(-1500))
          if (!r.connected) setStatus('Disconnected')
        } catch {
          setConnected(false)
          setStatus('Disconnected')
        }
      })()
    }, 1200)
    return () => window.clearInterval(timer)
  }, [connected, sessionId])

  const connect = async () => {
    setBusy(true)
    try {
      const r = await invoke<{ connected: boolean; message: string }>('irc_connect', {
        req: {
          sessionId,
          server: server.trim(),
          port,
          nick: nick.trim(),
          username: username.trim(),
          realname: realname.trim(),
          useTls,
        },
      })
      setConnected(r.connected)
      setStatus(r.message)
    } catch (e) {
      setConnected(false)
      setStatus(String(e))
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    try {
      await invoke('irc_disconnect', { sessionId })
    } catch {
      // no-op
    }
    setConnected(false)
    setStatus('Disconnected')
  }

  const join = async () => {
    if (!channel.trim()) return
    try {
      await invoke('irc_join', { req: { sessionId, channel: channel.trim() } })
      setStatus(`JOIN ${channel.trim()} sent`)
    } catch (e) {
      setStatus(String(e))
    }
  }

  const sendLine = async (out: string) => {
    const s = out.trim()
    if (!s) return
    let raw = s
    if (s.startsWith('/raw ')) raw = s.slice(5)
    else if (s.startsWith('/me ')) raw = `PRIVMSG ${channel.trim()} :\u0001ACTION ${s.slice(4)}\u0001`
    else if (s.startsWith('/msg ')) {
      const rest = s.slice(5).trim()
      const first = rest.indexOf(' ')
      if (first > 0) {
        raw = `PRIVMSG ${rest.slice(0, first)} :${rest.slice(first + 1)}`
      }
    } else if (s.startsWith('/notice ')) {
      const rest = s.slice(8).trim()
      const first = rest.indexOf(' ')
      if (first > 0) {
        raw = `NOTICE ${rest.slice(0, first)} :${rest.slice(first + 1)}`
      }
    } else if (s.startsWith('/join ')) {
      raw = `JOIN ${s.slice(6).trim()}`
    } else if (s.startsWith('/part ')) {
      raw = `PART ${s.slice(6).trim()}`
    } else if (s.startsWith('/whois ')) {
      raw = `WHOIS ${s.slice(7).trim()}`
    } else if (s.startsWith('/who ')) {
      raw = `WHO ${s.slice(5).trim()}`
    } else if (s.startsWith('/list')) {
      raw = 'LIST'
    } else if (s.startsWith('/names ')) {
      raw = `NAMES ${s.slice(7).trim()}`
    } else if (s.startsWith('/topic ')) {
      raw = `TOPIC ${s.slice(7).trim()}`
    } else if (s.startsWith('/invite ')) {
      raw = `INVITE ${s.slice(8).trim()}`
    } else if (s.startsWith('/kick ')) {
      raw = `KICK ${s.slice(6).trim()}`
    } else if (s.startsWith('/mode ')) {
      raw = `MODE ${s.slice(6).trim()}`
    } else if (s.startsWith('/away')) {
      raw = `AWAY ${s.slice(5).trim()}`
    } else if (s.startsWith('/quit')) {
      raw = `QUIT ${s.slice(5).trim() || ':bye'}`
    } else if (s.startsWith('/nick ')) {
      raw = `NICK ${s.slice(6).trim()}`
    } else if (s.startsWith('/user ')) {
      raw = `USER ${s.slice(6).trim()}`
    } else {
      raw = `PRIVMSG ${channel.trim()} :${s}`
    }
    await invoke('irc_send', { req: { sessionId, line: raw } })
  }

  const onSubmit = async () => {
    if (!connected) return
    const text = line.trim()
    if (!text) return
    try {
      await sendLine(text)
      setLine('')
    } catch (e) {
      setStatus(String(e))
    }
  }

  return (
    <section className="panel irc-dock">
      <div className="irc-dock-head">
        <h2>IRC dock</h2>
        <span className={connected ? 'irc-state live' : 'irc-state'}>{connected ? 'LIVE' : 'OFFLINE'}</span>
      </div>
      <p className="hint">
        Connect to EFnet, Darknet, LiberaChat, OFTC, or QuakeNet. Type plain text to send to current channel, or slash commands.
      </p>

      <div className="irc-grid">
        <label>
          Network
          <select value={networkId} onChange={(e) => setNetworkId(e.target.value)}>
            {NETWORKS.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Server
          <input value={server} onChange={(e) => setServer(e.target.value)} />
        </label>
        <label>
          Port
          <input type="number" value={port} onChange={(e) => setPort(Number(e.target.value) || 6667)} />
        </label>
        <label className="check">
          <input type="checkbox" checked={useTls} onChange={(e) => setUseTls(e.target.checked)} />
          TLS (recommended for 6697)
        </label>
        <label>
          Nick
          <input value={nick} onChange={(e) => setNick(e.target.value)} />
        </label>
        <label>
          Username
          <input value={username} onChange={(e) => setUsername(e.target.value)} />
        </label>
        <label>
          Real name
          <input value={realname} onChange={(e) => setRealname(e.target.value)} />
        </label>
        <label>
          Channel
          <input value={channel} onChange={(e) => setChannel(e.target.value)} placeholder={preset.channelHint} />
        </label>
      </div>

      <div className="irc-actions">
        <button type="button" disabled={busy} onClick={() => void connect()}>{busy ? 'Connecting…' : 'Connect'}</button>
        <button type="button" disabled={busy || connected} onClick={() => { setPort(6667); setUseTls(false) }}>Use 6667</button>
        <button type="button" disabled={busy || connected} onClick={() => { setPort(6697); setUseTls(true) }}>Use 6697 TLS</button>
        <button type="button" disabled={!connected} onClick={() => void join()}>Join</button>
        <button type="button" disabled={!connected} onClick={() => void disconnect()}>Disconnect</button>
        <span className="muted">{status}</span>
      </div>

      <div className="irc-command-wall">
        {TOP_20_COMMANDS.map((cmd) => (
          <button key={cmd} type="button" className="irc-cmd-chip" onClick={() => setLine(cmd)}>
            {cmd}
          </button>
        ))}
      </div>

      <pre className="irc-log">{log.length ? log.join('\n') : 'No IRC traffic yet.'}</pre>

      <div className="row">
        <input
          className="wide"
          value={line}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void onSubmit()}
          placeholder="Say something, or use /msg /join /whois /raw …"
        />
        <button type="button" disabled={!connected} onClick={() => void onSubmit()}>
          Send
        </button>
      </div>
    </section>
  )
}
