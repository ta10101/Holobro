import { useEffect, useMemo, useRef, useState } from 'react'

type Props = {
  enabled: boolean
  spawnChance?: number
  soundPack?: 'calm' | 'chaos' | 'street'
  alwaysShow?: boolean
}

type Point = {
  x: number
  y: number
}
type Edge = 'top' | 'right' | 'bottom' | 'left'
type MoveMode = 'walk' | 'crawl' | 'swim'

const SIZE = 56
const PAD = 6

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v))
}

function randomEdgePoint(): { point: Point; edge: Edge } {
  const w = window.innerWidth
  const h = window.innerHeight
  const right = Math.max(PAD, w - SIZE - PAD)
  const bottom = Math.max(PAD, h - SIZE - PAD)
  const edge = Math.floor(Math.random() * 4)
  if (edge === 0) return { point: { x: Math.random() * right, y: PAD }, edge: 'top' }
  if (edge === 1) return { point: { x: right, y: Math.random() * bottom }, edge: 'right' }
  if (edge === 2) return { point: { x: Math.random() * right, y: bottom }, edge: 'bottom' }
  return { point: { x: PAD, y: Math.random() * bottom }, edge: 'left' }
}

const QUIRK_LINES_BY_PACK: Record<'calm' | 'chaos' | 'street', string[]> = {
  calm: [
    '...soft wake-up mode.',
    'quiet sip before the ride.',
    'sleepy but steady.',
    'gentle roll-in incoming.',
    'daydreaming and cruising.',
  ],
  street: [
    '...yo, just woke up.',
    '*sip* coffee first.',
    'kinda sleepy, still rolling.',
    'bro is a little tipsy tonight.',
    'head over heels, still cruising.',
  ],
  chaos: [
    'ALERT: chaos goblin awake.',
    'too much juice, zero brakes.',
    'sleep schedule fully destroyed.',
    'sirens in my heartbeat.',
    'in love, loud, and unhinged.',
  ],
}

const QUIRK_SOUNDS = ['bark', 'siren', 'creak', 'lightning'] as const
type QuirkSound = (typeof QUIRK_SOUNDS)[number]

function playQuirkSound(kind: QuirkSound, pack: 'calm' | 'chaos' | 'street') {
  const Ctx = (window as typeof window & { webkitAudioContext?: typeof AudioContext }).AudioContext
    || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctx) return false
  const ctx = new Ctx()
  if (ctx.state !== 'running') {
    void ctx.close().catch(() => {})
    return false
  }
  const now = ctx.currentTime
  const out = ctx.createGain()
  out.gain.value = pack === 'chaos' ? 0.05 : pack === 'street' ? 0.04 : 0.026
  out.connect(ctx.destination)

  const tone = (f: number, t0: number, dur: number, type: OscillatorType = 'triangle') => {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = type
    o.frequency.value = f
    g.gain.value = 0.0001
    g.gain.linearRampToValueAtTime(0.08, t0 + 0.02)
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
    o.connect(g)
    g.connect(out)
    o.start(t0)
    o.stop(t0 + dur + 0.02)
  }

  if (kind === 'bark') {
    tone(260, now, 0.08, 'square')
    tone(210, now + 0.09, 0.1, 'square')
    if (pack === 'chaos') tone(180, now + 0.18, 0.12, 'square')
  } else if (kind === 'siren') {
    const o = ctx.createOscillator()
    const g = ctx.createGain()
    o.type = 'sawtooth'
    o.frequency.setValueAtTime(480, now)
    o.frequency.linearRampToValueAtTime(760, now + 0.2)
    o.frequency.linearRampToValueAtTime(420, now + 0.4)
    g.gain.value = 0.0001
    g.gain.linearRampToValueAtTime(0.06, now + 0.03)
    g.gain.exponentialRampToValueAtTime(0.0001, now + 0.45)
    o.connect(g)
    g.connect(out)
    o.start(now)
    o.stop(now + (pack === 'chaos' ? 0.62 : 0.46))
  } else if (kind === 'creak') {
    tone(170, now, 0.22, 'sawtooth')
    tone(145, now + 0.12, 0.22, 'sawtooth')
    if (pack !== 'calm') tone(130, now + 0.2, 0.2, 'sawtooth')
  } else {
    tone(980, now, 0.05, 'triangle')
    tone(620, now + 0.04, 0.08, 'triangle')
    if (pack !== 'calm') tone(780, now + 0.09, 0.07, 'triangle')
  }

  window.setTimeout(() => {
    void ctx.close().catch(() => {})
  }, 700)
  return true
}

export function HoloBroWanderer({
  enabled,
  spawnChance = 0.33,
  soundPack = 'street',
  alwaysShow = false,
}: Props) {
  const [active, setActive] = useState(false)
  const [pos, setPos] = useState<Point>({ x: PAD, y: PAD })
  const [flip, setFlip] = useState(false)
  const [quirkLine, setQuirkLine] = useState<string | null>(null)
  const [mode, setMode] = useState<MoveMode>('walk')
  const edgeRef = useRef<Edge>('top')
  const posRef = useRef<Point>({ x: PAD, y: PAD })

  useEffect(() => {
    const unlock = () => {
      const Ctx = (window as typeof window & { webkitAudioContext?: typeof AudioContext }).AudioContext
        || (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
      if (!Ctx) return
      const ctx = new Ctx()
      void ctx.resume().catch(() => {})
      window.setTimeout(() => {
        void ctx.close().catch(() => {})
      }, 150)
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [])

  useEffect(() => {
    if (!enabled) {
      setActive(false)
      setQuirkLine(null)
      return
    }
    const appears = alwaysShow || Math.random() < clamp(spawnChance, 0, 1)
    if (!appears) {
      setActive(false)
      setQuirkLine(null)
      return
    }
    const packLines = QUIRK_LINES_BY_PACK[soundPack]
    const line = packLines[Math.floor(Math.random() * packLines.length)]
    const sound = QUIRK_SOUNDS[Math.floor(Math.random() * QUIRK_SOUNDS.length)]
    const modePick: MoveMode[] = ['walk', 'crawl', 'swim']
    setMode(modePick[Math.floor(Math.random() * modePick.length)])
    const soundOk = playQuirkSound(sound, soundPack)
    setQuirkLine(soundOk ? line : `${line} (quiet mode)`)
    let bubbleTimer: number | null = null
    const appearTimer = window.setTimeout(() => {
      const start = randomEdgePoint()
      edgeRef.current = start.edge
      posRef.current = start.point
      setPos(start.point)
      setActive(true)
      bubbleTimer = window.setTimeout(() => setQuirkLine(null), 4000)
    }, 560)
    return () => {
      window.clearTimeout(appearTimer)
      if (bubbleTimer !== null) window.clearTimeout(bubbleTimer)
    }
  }, [enabled, spawnChance, soundPack, alwaysShow])

  useEffect(() => {
    if (!active) return
    const t = window.setInterval(() => {
      const w = window.innerWidth
      const h = window.innerHeight
      const right = Math.max(PAD, w - SIZE - PAD)
      const bottom = Math.max(PAD, h - SIZE - PAD)
      const speed = mode === 'crawl' ? 0.35 : mode === 'swim' ? 0.5 : 0.7
      const next = { ...posRef.current }
      let edge = edgeRef.current

      if (edge === 'top') {
        next.x += speed
        setFlip(false)
        if (next.x >= right) {
          next.x = right
          edge = 'right'
        }
      } else if (edge === 'right') {
        next.y += speed
        if (next.y >= bottom) {
          next.y = bottom
          edge = 'bottom'
        }
      } else if (edge === 'bottom') {
        next.x -= speed
        setFlip(true)
        if (next.x <= PAD) {
          next.x = PAD
          edge = 'left'
        }
      } else {
        next.y -= speed
        if (next.y <= PAD) {
          next.y = PAD
          edge = 'top'
        }
      }
      edgeRef.current = edge
      posRef.current = next
      setPos(next)
    }, 32)
    return () => window.clearInterval(t)
  }, [active, mode])

  const transform = useMemo(
    () => `translate(${Math.round(pos.x)}px, ${Math.round(pos.y)}px) scaleX(${flip ? -1 : 1})`,
    [pos.x, pos.y, flip],
  )

  if (!active && !quirkLine) return null
  return (
    <>
      {quirkLine ? (
        <div className="holobro-quirk-bubble" aria-live="polite">
          {quirkLine}
        </div>
      ) : null}
      {active ? (
        <div className={`holobro-wanderer holobro-${mode}`} style={{ transform }} aria-hidden="true">
          <svg viewBox="0 0 64 64" width="56" height="56" xmlns="http://www.w3.org/2000/svg">
            <defs>
              <linearGradient id="hbw-head" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#ff2d95" />
                <stop offset="55%" stopColor="#7c3aed" />
                <stop offset="100%" stopColor="#06b6d4" />
              </linearGradient>
          <linearGradient id="hbw-glass" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#67e8f9" />
          </linearGradient>
              <linearGradient id="hbw-pants" x1="0%" y1="0%" x2="100%" y2="100%">
                <stop offset="0%" stopColor="#0ea5e9" />
                <stop offset="100%" stopColor="#1d4ed8" />
              </linearGradient>
            </defs>
            <ellipse cx="32" cy="18" rx="13" ry="11.5" fill="url(#hbw-head)" />
        <rect x="20.5" y="14.5" width="9" height="5.6" rx="1.6" fill="rgba(3, 18, 32, 0.88)" />
        <rect x="34.5" y="14.5" width="9" height="5.6" rx="1.6" fill="rgba(3, 18, 32, 0.88)" />
        <rect x="29.5" y="16.8" width="5" height="1.3" rx="0.65" fill="#0b1020" opacity="0.95" />
        <rect x="20.2" y="14.2" width="9.6" height="6.2" rx="1.8" fill="none" stroke="url(#hbw-glass)" strokeWidth="1.1" />
        <rect x="34.2" y="14.2" width="9.6" height="6.2" rx="1.8" fill="none" stroke="url(#hbw-glass)" strokeWidth="1.1" />
        <path d="M20.8 15.2l8.3 0" stroke="#e0f2fe" strokeWidth="0.55" opacity="0.62" />
        <path d="M34.8 15.2l8.3 0" stroke="#e0f2fe" strokeWidth="0.55" opacity="0.62" />
            <text
              x="32"
          y="23.3"
              textAnchor="middle"
          fontSize="8.9"
              fontFamily="'Permanent Marker', 'Segoe UI', fantasy"
              fill="#f8fafc"
              style={{ paintOrder: 'stroke fill', stroke: '#1f2937', strokeWidth: 0.8 }}
            >
              HB
            </text>
            <rect x="20" y="26" width="24" height="14" rx="6" fill="#0f172a" />
            <rect x="16" y="29" width="8" height="5" rx="2.5" fill="#111827" opacity="0.95" />
            <rect x="40" y="29" width="8" height="5" rx="2.5" fill="#111827" opacity="0.95" />
            <path d="M22 39h20l-1.6 13h-6l-1.2-8h-2.4l-1.2 8h-6L22 39z" fill="url(#hbw-pants)" />
            <rect x="21" y="51" width="9" height="3" rx="1.5" fill="#0b1020" />
            <rect x="34" y="51" width="9" height="3" rx="1.5" fill="#0b1020" />
            <path d="M20 45l24-1.5 2.5 3.4-27 1.7z" fill="#111827" opacity="0.9" />
          </svg>
        </div>
      ) : null}
    </>
  )
}

