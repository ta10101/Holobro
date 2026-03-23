import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { openUrl } from '@tauri-apps/plugin-opener'

export type LlmProvider = 'ollama' | 'openai'

export type AssistantSettings = {
  baseUrl: string
  provider: LlmProvider
  model: string
  /** Stored only if persistApiKey is true */
  apiKey: string
  persistApiKey: boolean
  chatTimeoutSecs: number
  pullTimeoutSecs: number
  prompt: string
}

export type LlmHealthResult = {
  ok: boolean
  backend: string
  version?: string | null
  message: string
}

export type LlmModelInfo = {
  name: string
  /** From Rust `sizeBytes` */
  sizeBytes?: number | null
}

const LS_KEY = 'holobro-assistant-settings'
const LS_KEY_LEGACY = 'hab-assistant-settings'
const LS_KEY_EPHEMERAL = 'holobro-assistant-key-session'
const LS_KEY_EPHEMERAL_LEGACY = 'hab-assistant-key-session'

const DEFAULTS: AssistantSettings = {
  baseUrl: 'http://127.0.0.1:11434',
  provider: 'ollama',
  model: 'llama3.2',
  apiKey: '',
  persistApiKey: false,
  chatTimeoutSecs: 120,
  pullTimeoutSecs: 900,
  prompt: 'Summarize why peer-to-peer apps use WebRTC for media.',
}

export function loadAssistantSettings(): AssistantSettings {
  try {
    const raw =
      localStorage.getItem(LS_KEY) ?? localStorage.getItem(LS_KEY_LEGACY)
    const base = raw ? ({ ...DEFAULTS, ...JSON.parse(raw) } as AssistantSettings) : { ...DEFAULTS }
    if (typeof base.baseUrl !== 'string') base.baseUrl = DEFAULTS.baseUrl
    if (base.provider !== 'ollama' && base.provider !== 'openai') base.provider = 'ollama'
    if (typeof base.model !== 'string') base.model = DEFAULTS.model
    if (typeof base.persistApiKey !== 'boolean') base.persistApiKey = false
    if (typeof base.chatTimeoutSecs !== 'number') base.chatTimeoutSecs = DEFAULTS.chatTimeoutSecs
    if (typeof base.pullTimeoutSecs !== 'number') base.pullTimeoutSecs = DEFAULTS.pullTimeoutSecs
    if (typeof base.prompt !== 'string') base.prompt = DEFAULTS.prompt
    if (base.persistApiKey) {
      if (typeof base.apiKey !== 'string') base.apiKey = ''
    } else {
      base.apiKey =
        sessionStorage.getItem(LS_KEY_EPHEMERAL) ??
        sessionStorage.getItem(LS_KEY_EPHEMERAL_LEGACY) ??
        ''
    }
    return base
  } catch {
    return { ...DEFAULTS }
  }
}

function persistSettings(s: AssistantSettings) {
  const { apiKey, persistApiKey, ...rest } = s
  const stored = persistApiKey
    ? { ...rest, persistApiKey, apiKey }
    : { ...rest, persistApiKey }
  localStorage.setItem(LS_KEY, JSON.stringify(stored))
  if (!persistApiKey) {
    sessionStorage.setItem(LS_KEY_EPHEMERAL, apiKey)
  }
}

export function AssistantPanel() {
  const [settings, setSettings] = useState<AssistantSettings>(() => loadAssistantSettings())
  const [health, setHealth] = useState<LlmHealthResult | null>(null)
  const [healthBusy, setHealthBusy] = useState(false)
  const [models, setModels] = useState<LlmModelInfo[]>([])
  const [modelsBusy, setModelsBusy] = useState(false)
  const [modelsErr, setModelsErr] = useState<string | null>(null)
  const [pullName, setPullName] = useState('')
  const [pullBusy, setPullBusy] = useState(false)
  const [pullLog, setPullLog] = useState<string | null>(null)
  const [out, setOut] = useState('')
  const [busy, setBusy] = useState(false)
  const [showApiKey, setShowApiKey] = useState(false)

  const update = useCallback((patch: Partial<AssistantSettings>) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      persistSettings(next)
      return next
    })
  }, [])

  const runHealth = useCallback(async () => {
    setHealthBusy(true)
    setHealth(null)
    try {
      const r = await invoke<LlmHealthResult>('llm_health', {
        req: {
          baseUrl: settings.baseUrl.trim(),
          apiKey: settings.apiKey.trim() || null,
          timeoutSecs: 12,
          provider: settings.provider,
        },
      })
      setHealth(r)
    } catch (e) {
      setHealth({
        ok: false,
        backend: settings.provider,
        message: e instanceof Error ? e.message : String(e),
      })
    } finally {
      setHealthBusy(false)
    }
  }, [settings.baseUrl, settings.apiKey, settings.provider])

  const runListModels = useCallback(async () => {
    setModelsBusy(true)
    setModelsErr(null)
    setModels([])
    try {
      const r = await invoke<{ models: LlmModelInfo[] }>('llm_list_models', {
        req: {
          baseUrl: settings.baseUrl.trim(),
          apiKey: settings.apiKey.trim() || null,
          timeoutSecs: 45,
          provider: settings.provider,
        },
      })
      setModels(r.models ?? [])
      if (!r.models?.length) {
        setModelsErr('No models returned — install one or check the server.')
      }
    } catch (e) {
      setModelsErr(e instanceof Error ? e.message : String(e))
    } finally {
      setModelsBusy(false)
    }
  }, [settings.baseUrl, settings.apiKey, settings.provider])

  useEffect(() => {
    void (async () => {
      setHealthBusy(true)
      setHealth(null)
      const s = loadAssistantSettings()
      try {
        const r = await invoke<LlmHealthResult>('llm_health', {
          baseUrl: s.baseUrl.trim(),
          apiKey: s.apiKey.trim() || null,
          timeoutSecs: 12,
          provider: s.provider,
        })
        setHealth(r)
      } catch (e) {
        setHealth({
          ok: false,
          backend: s.provider,
          message: e instanceof Error ? e.message : String(e),
        })
      } finally {
        setHealthBusy(false)
      }
    })()
  }, [])

  const runChat = async () => {
    setBusy(true)
    setOut('')
    try {
      const text = await invoke<string>('llm_chat', {
        req: {
          baseUrl: settings.baseUrl.trim(),
          model: settings.model.trim(),
          message: settings.prompt,
          apiKey: settings.apiKey.trim() || null,
          timeoutSecs: settings.chatTimeoutSecs,
          provider: settings.provider,
        },
      })
      setOut(text)
    } catch (e) {
      setOut(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  const runPull = async () => {
    const name = pullName.trim()
    if (!name) {
      setPullLog('Enter a model name (e.g. llama3.2:latest).')
      return
    }
    setPullBusy(true)
    setPullLog(null)
    try {
      const msg = await invoke<string>('llm_pull_ollama', {
        req: {
          baseUrl: settings.baseUrl.trim(),
          model: name,
          apiKey: settings.apiKey.trim() || null,
          timeoutSecs: settings.pullTimeoutSecs,
        },
      })
      setPullLog(msg)
      await runListModels()
    } catch (e) {
      setPullLog(e instanceof Error ? e.message : String(e))
    } finally {
      setPullBusy(false)
    }
  }

  const presetUrls = [
    { label: 'Ollama default', value: 'http://127.0.0.1:11434' },
    { label: 'LM Studio (typical)', value: 'http://127.0.0.1:1234' },
  ]

  return (
    <section className="panel assistant-panel">
      <h2>Assistant (LLM)</h2>
      <p className="hint">
        Requests go through the Tauri host (not the embedded browser). Choose <strong>Ollama</strong> for local
        pulls and <code>/api/chat</code>, or <strong>OpenAI-compatible</strong> for APIs that expose{' '}
        <code>/v1/models</code> and <code>/v1/chat/completions</code> (LM Studio, vLLM, cloud APIs).
      </p>

      <div className="assistant-status-row">
        <div
          className={
            healthBusy
              ? 'llm-badge checking'
              : health?.ok
                ? 'llm-badge ok'
                : health
                  ? 'llm-badge err'
                  : 'llm-badge idle'
          }
        >
          {healthBusy
            ? 'Checking server…'
            : health?.ok
              ? `Online · ${health.version ? `v${health.version}` : health.backend}`
              : health
                ? 'Not reachable'
                : 'Unknown'}
        </div>
        <button type="button" disabled={healthBusy} onClick={() => void runHealth()}>
          Check connection
        </button>
        <button type="button" disabled={modelsBusy} onClick={() => void runListModels()}>
          {modelsBusy ? 'Loading models…' : 'Refresh model list'}
        </button>
      </div>
      {health && !healthBusy && (
        <p className={`hint llm-health-msg ${health.ok ? 'ok' : 'bad'}`}>{health.message}</p>
      )}

      <div className="assistant-grid">
        <label>
          Backend
          <select
            value={settings.provider}
            onChange={(e) => update({ provider: e.target.value as LlmProvider })}
          >
            <option value="ollama">Ollama (local)</option>
            <option value="openai">OpenAI-compatible API</option>
          </select>
        </label>

        <label>
          Base URL
          <input
            value={settings.baseUrl}
            onChange={(e) => update({ baseUrl: e.target.value })}
            placeholder="http://127.0.0.1:11434"
          />
        </label>

        <div className="assistant-presets">
          <span className="muted">Quick:</span>
          {presetUrls.map((p) => (
            <button key={p.value} type="button" className="linkish" onClick={() => update({ baseUrl: p.value })}>
              {p.label}
            </button>
          ))}
        </div>

        <label>
          API key / token (optional)
          <div className="assistant-api-key">
            <input
              type={showApiKey ? 'text' : 'password'}
              autoComplete="off"
              value={settings.apiKey}
              onChange={(e) => update({ apiKey: e.target.value })}
              placeholder={settings.provider === 'openai' ? 'sk-… or server token' : 'Usually empty for local Ollama'}
            />
            <button type="button" className="small" onClick={() => setShowApiKey((v) => !v)}>
              {showApiKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </label>

        <label className="check">
          <input
            type="checkbox"
            checked={settings.persistApiKey}
            onChange={(e) => update({ persistApiKey: e.target.checked })}
          />
          Remember API key in this browser profile (localStorage)
        </label>

        <label>
          Model
          <div className="assistant-model-row">
            <select
              value={models.some((m) => m.name === settings.model) ? settings.model : '__custom__'}
              onChange={(e) => {
                const v = e.target.value
                if (v !== '__custom__') update({ model: v })
              }}
            >
              <option value="__custom__">— type or pick after refresh —</option>
              {models.map((m) => (
                <option key={m.name} value={m.name}>
                  {m.name}
                  {m.sizeBytes != null ? ` (${formatSize(m.sizeBytes)})` : ''}
                </option>
              ))}
            </select>
            <input
              className="model-manual"
              value={settings.model}
              onChange={(e) => update({ model: e.target.value })}
              placeholder="model id"
              list="assistant-model-datalist"
            />
            <datalist id="assistant-model-datalist">
              {models.map((m) => (
                <option key={m.name} value={m.name} />
              ))}
            </datalist>
          </div>
        </label>

        {settings.provider === 'ollama' && (
          <div className="assistant-pull">
            <h3>Install model (Ollama pull)</h3>
            <p className="hint">
              Downloads a model from Ollama&apos;s library — can take several minutes and large disk space. Ensure
              Ollama is running and healthy above.
            </p>
            <div className="row assistant-pull-row">
              <input
                value={pullName}
                onChange={(e) => setPullName(e.target.value)}
                placeholder="e.g. llama3.2:latest or qwen2.5:7b"
              />
              <button type="button" disabled={pullBusy} onClick={() => void runPull()}>
                {pullBusy ? 'Pulling…' : 'Pull / install'}
              </button>
              <button type="button" onClick={() => void openUrl('https://ollama.com/library')}>
                Browse library
              </button>
            </div>
            {pullLog && <pre className="llm-pull-log">{pullLog}</pre>}
          </div>
        )}

        <div className="assistant-advanced">
          <label>
            Chat timeout (seconds)
            <input
              type="number"
              min={5}
              max={600}
              value={settings.chatTimeoutSecs}
              onChange={(e) => update({ chatTimeoutSecs: Math.min(600, Math.max(5, Number(e.target.value) || 120)) })}
            />
          </label>
          {settings.provider === 'ollama' && (
            <label>
              Pull timeout (seconds)
              <input
                type="number"
                min={60}
                max={7200}
                step={60}
                value={settings.pullTimeoutSecs}
                onChange={(e) =>
                  update({ pullTimeoutSecs: Math.min(7200, Math.max(60, Number(e.target.value) || 900)) })
                }
              />
            </label>
          )}
        </div>

        {modelsErr && <p className="error">{modelsErr}</p>}

        <label>
          Prompt
          <textarea
            value={settings.prompt}
            onChange={(e) => update({ prompt: e.target.value })}
            rows={5}
          />
        </label>

        <div className="assistant-run">
          <button type="button" className="primary" disabled={busy} onClick={() => void runChat()}>
            {busy ? 'Running…' : 'Run prompt'}
          </button>
        </div>
      </div>

      {out && <pre className="llm-out assistant-out">{out}</pre>}
    </section>
  )
}

function formatSize(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KiB`
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MiB`
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GiB`
}
