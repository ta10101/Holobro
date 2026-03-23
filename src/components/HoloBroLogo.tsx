type Props = {
  className?: string
  variant?: 'header' | 'hero'
}

/**
 * HoloBro mark: spray gradient + hex + stencil letters (uses Permanent Marker from index.html).
 */
export function HoloBroLogo({ className = '', variant = 'header' }: Props) {
  const fs = variant === 'hero' ? 32 : 22
  const box = 64
  return (
    <svg
      className={`holobro-logo-svg ${className}`.trim()}
      width={variant === 'hero' ? 96 : 56}
      height={variant === 'hero' ? 96 : 56}
      viewBox={`0 0 ${box} ${box}`}
      aria-hidden
      xmlns="http://www.w3.org/2000/svg"
    >
      <defs>
        <linearGradient id="hb-spray1" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ff2d95" />
          <stop offset="50%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#06b6d4" />
        </linearGradient>
        <linearGradient id="hb-spray2" x1="0%" y1="100%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#facc15" />
          <stop offset="100%" stopColor="#f97316" />
        </linearGradient>
        <filter id="hb-glow" x="-30%" y="-30%" width="160%" height="160%">
          <feGaussianBlur stdDeviation="0.8" result="b" />
          <feMerge>
            <feMergeNode in="b" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <ellipse cx="34" cy="34" rx="26" ry="24" fill="url(#hb-spray1)" opacity="0.4" transform="rotate(-6 34 34)" />
      <ellipse cx="32" cy="32" rx="20" ry="18" fill="#140822" opacity="0.95" />
      <path
        fill="none"
        stroke="url(#hb-spray2)"
        strokeWidth="1"
        opacity="0.75"
        d="M20 22l5.2-3 5.2 3v6l-5.2 3-5.2-3z M31 22l5.2-3 5.2 3v6l-5.2 3-5.2-3z M25.5 32l5.2-3 5.2 3v6l-5.2 3-5.2-3z"
      />
      <text
        x="32"
        y="40"
        textAnchor="middle"
        fontSize={fs}
        fontFamily="'Permanent Marker', 'Segoe UI', fantasy"
        fill="#f8fafc"
        filter="url(#hb-glow)"
        style={{ paintOrder: 'stroke fill', stroke: '#a21caf', strokeWidth: 0.5 }}
      >
        HB
      </text>
      <path fill="#ff2d95" d="M24 48v5q0 1.8-1.2 2.3T20 54l-0.8-1.5q1.2-.4 1.6-1.2V48h2.4z" opacity="0.9" />
      <circle cx="46" cy="46" r="2" fill="#06b6d4" opacity="0.65" />
      <circle cx="14" cy="38" r="1.2" fill="#facc15" opacity="0.55" />
    </svg>
  )
}
