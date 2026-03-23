type Props = {
  className?: string
}

export function HoloBroMascot({ className = '' }: Props) {
  return (
    <svg
      className={`holobro-mascot ${className}`.trim()}
      viewBox="0 0 180 180"
      width="92"
      height="92"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <defs>
        <linearGradient id="hb-face" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#ffd37a" />
          <stop offset="100%" stopColor="#fb923c" />
        </linearGradient>
        <linearGradient id="hb-hood" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#06b6d4" />
          <stop offset="55%" stopColor="#7c3aed" />
          <stop offset="100%" stopColor="#ff2d95" />
        </linearGradient>
        <linearGradient id="hb-board" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#22d3ee" />
          <stop offset="100%" stopColor="#f43f5e" />
        </linearGradient>
        <path id="hb-arc" d="M30 52 Q90 10 150 52" />
      </defs>
      <text
        fill="#f8fafc"
        fontSize="22"
        fontWeight="700"
        fontFamily="'Permanent Marker', 'Segoe UI', fantasy"
        style={{ paintOrder: 'stroke fill', stroke: '#0b1020', strokeWidth: 1.3 }}
      >
        <textPath href="#hb-arc" startOffset="50%" textAnchor="middle">HoloBro</textPath>
      </text>
      <ellipse cx="90" cy="102" rx="62" ry="55" fill="url(#hb-hood)" opacity="0.95" />
      <circle cx="90" cy="96" r="35" fill="url(#hb-face)" />
      <path d="M58 87c6-13 18-22 32-22 14 0 28 9 34 22" fill="none" stroke="#131827" strokeWidth="8" strokeLinecap="round" />
      <rect x="62" y="91" width="26" height="17" rx="6" fill="#0b1020" />
      <rect x="92" y="91" width="26" height="17" rx="6" fill="#0b1020" />
      <rect x="87" y="97" width="6" height="4" rx="2" fill="#0b1020" />
      <circle cx="75" cy="99" r="4" fill="#67e8f9" />
      <circle cx="105" cy="99" r="4" fill="#67e8f9" />
      <path d="M76 121c7 6 21 6 28 0" fill="none" stroke="#7c2d12" strokeWidth="3.5" strokeLinecap="round" />
      <g transform="rotate(-8 90 146)">
        <rect x="44" y="138" width="92" height="14" rx="7" fill="url(#hb-board)" />
        <circle cx="62" cy="154" r="5" fill="#111827" />
        <circle cx="118" cy="154" r="5" fill="#111827" />
      </g>
      <circle cx="36" cy="118" r="3" fill="#facc15" opacity="0.6" />
      <circle cx="144" cy="114" r="2.5" fill="#22d3ee" opacity="0.65" />
    </svg>
  )
}
