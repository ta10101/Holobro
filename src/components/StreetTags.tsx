/** Decorative sticker tags — no semantic content */
export function StreetTags() {
  const tags = ['P2P', 'HOLO', 'TOR?', 'NO-TRACE', 'LOCAL-FIRST', 'WALL']
  return (
    <div className="street-tags" aria-hidden>
      {tags.map((t) => (
        <span key={t} className="street-tag">
          {t}
        </span>
      ))}
    </div>
  )
}
