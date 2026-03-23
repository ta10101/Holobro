import { useCallback, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'

type ShellExecResult = {
  command: string
  stdout: string
  stderr: string
  exitCode: number | null
}

export function TerminalMiniDock() {
  const [termCommand, setTermCommand] = useState('ipconfig')
  const [termCwd, setTermCwd] = useState('')
  const [termBusy, setTermBusy] = useState(false)
  const [termOut, setTermOut] = useState<ShellExecResult | null>(null)
  const [termErr, setTermErr] = useState<string | null>(null)
  const [termHistory, setTermHistory] = useState<string[]>([])
  const [open, setOpen] = useState(true)

  const runTerminal = useCallback(async () => {
    const cmd = termCommand.trim()
    if (!cmd) return
    setTermBusy(true)
    setTermErr(null)
    setTermOut(null)
    try {
      const r = await invoke<ShellExecResult>('shell_exec', {
        req: {
          command: cmd,
          cwd: termCwd.trim() || undefined,
          timeoutSecs: 90,
        },
      })
      setTermOut(r)
      setTermHistory((prev) => {
        const cleaned = prev.filter((x) => x !== cmd)
        return [cmd, ...cleaned].slice(0, 12)
      })
    } catch (e) {
      setTermErr(String(e))
    } finally {
      setTermBusy(false)
    }
  }, [termCommand, termCwd])

  return (
    <aside className={open ? 'terminal-mini-dock open' : 'terminal-mini-dock'} aria-label="Mini terminal">
      <div className="terminal-mini-head">
        <strong>Terminal</strong>
        <button type="button" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Show'}
        </button>
      </div>
      {open ? (
        <>
          <div className="terminal-mini-row">
            {termHistory.length ? (
              <select value="" onChange={(e) => e.target.value && setTermCommand(e.target.value)}>
                <option value="">History…</option>
                {termHistory.map((cmd) => (
                  <option key={cmd} value={cmd}>
                    {cmd}
                  </option>
                ))}
              </select>
            ) : null}
            <input
              value={termCommand}
              onChange={(e) => setTermCommand(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && void runTerminal()}
              placeholder="Command"
            />
            <button type="button" disabled={termBusy} onClick={() => void runTerminal()}>
              {termBusy ? 'Run…' : 'Run'}
            </button>
          </div>
          <input
            value={termCwd}
            onChange={(e) => setTermCwd(e.target.value)}
            placeholder="Working directory (optional)"
          />
          {termErr ? <p className="error">{termErr}</p> : null}
          {termOut ? (
            <div className="terminal-mini-out">
              <p className="muted mono">{termOut.command}</p>
              {termOut.exitCode !== null && termOut.exitCode !== 0 ? <p className="error">Exit code {termOut.exitCode}</p> : null}
              <pre className="network-pre network-pre-large">{termOut.stdout || '(no stdout)'}</pre>
              {termOut.stderr ? <pre className="network-pre network-pre-err">{termOut.stderr}</pre> : null}
            </div>
          ) : null}
        </>
      ) : null}
    </aside>
  )
}
