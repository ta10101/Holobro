import { useCallback, useEffect, useMemo, useState } from 'react'

type GeoResult = {
  id: number
  name: string
  latitude: number
  longitude: number
  country?: string
  admin1?: string
  timezone?: string
}

type CurrentWeather = {
  time: string
  temperature_2m: number
  relative_humidity_2m: number
  precipitation: number
  wind_speed_10m: number
  weather_code: number
  is_day: number
}

type WeatherResponse = {
  current?: CurrentWeather
  daily?: {
    time: string[]
    weather_code: number[]
    temperature_2m_max: number[]
    temperature_2m_min: number[]
    precipitation_sum: number[]
  }
  timezone?: string
}

type ForecastDay = {
  date: string
  code: number
  tempMax: number
  tempMin: number
  precipitation: number
}

type HumorPack = 'dry' | 'chaos' | 'savage' | 'apocalypse'

const LS_WEATHER_QUERY = 'holobro-weather-query'
const LS_WEATHER_LOC = 'holobro-weather-location'
const LS_WEATHER_REFRESH = 'holobro-weather-refresh'
const LS_WEATHER_HUMOR = 'holobro-weather-humor'

function codeLabel(code: number): string {
  if (code === 0) return 'Clear'
  if ([1, 2, 3].includes(code)) return 'Cloudy'
  if ([45, 48].includes(code)) return 'Fog'
  if ([51, 53, 55, 56, 57].includes(code)) return 'Drizzle'
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return 'Rain'
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'Snow'
  if ([95, 96, 99].includes(code)) return 'Thunderstorm'
  return 'Mixed weather chaos'
}

function weatherMood(w: CurrentWeather): 'clear' | 'rain' | 'wind' | 'storm' | 'snow' | 'hot' | 'cold' | 'mixed' {
  if ([95, 96, 99].includes(w.weather_code)) return 'storm'
  if ([71, 73, 75, 77, 85, 86].includes(w.weather_code)) return 'snow'
  if (w.precipitation > 1.5 || [51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(w.weather_code)) return 'rain'
  if (w.wind_speed_10m > 35) return 'wind'
  if (w.temperature_2m > 30) return 'hot'
  if (w.temperature_2m < -2) return 'cold'
  if (w.weather_code === 0) return 'clear'
  return 'mixed'
}

function stableIndex(seed: string, n: number): number {
  let h = 0
  for (let i = 0; i < seed.length; i += 1) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return n > 0 ? h % n : 0
}

function linePack(pack: HumorPack, mood: ReturnType<typeof weatherMood>, place: string): string[] {
  const common = {
    clear: [
      `${place} is suspiciously nice right now.`,
      `Clear skies over ${place}. Nature is being cooperative for once.`,
    ],
    rain: [
      `${place} is wet enough to qualify as soup.`,
      `Rain at ${place}. The sky is aggressively moisturized.`,
    ],
    wind: [
      `${place} has wind set to blender mode.`,
      `Wind in ${place}: hats are now optional and temporary.`,
    ],
    storm: [
      `${place} has thunder. Maybe do not duel the atmosphere today.`,
      `Storm mode in ${place}. Electricity is being dramatic again.`,
    ],
    snow: [
      `${place} looks pretty and slippery at the same time.`,
      `Snow in ${place}. Romantic until you have to walk anywhere.`,
    ],
    hot: [
      `${place} is hot enough to question your life choices.`,
      `${place} is in oven mode. Hydrate like a responsible mammal.`,
    ],
    cold: [
      `${place} is cold enough to freeze optimism.`,
      `${place} is fridge-tier. Wear layers and emotional armor.`,
    ],
    mixed: [
      `${place} has mixed weather. The sky cannot commit.`,
      `${place} weather update: yes.`,
    ],
  }

  const savage = {
    clear: [`${place} is sunny. Touch grass before your inbox multiplies.`, `Nice weather in ${place}. Go outside; your chair misses you already.`],
    rain: [`${place} is raining sideways. Congratulations on your new swamp aesthetic.`, `${place} rain is relentless. Your shoes are now submarines.`],
    wind: [`${place} wind just redesigned your face for free.`, `If you stand in ${place} right now, you are basically a kite.`],
    storm: [`${place} thunder says you are not the main character today.`, `Storm in ${place}. Nature hit send with all caps.`],
    snow: [`${place} snow is cute until gravity enters the chat.`, `Snow at ${place}. One wrong step and you become modern art.`],
    hot: [`${place} is lava-adjacent. Shade is now premium content.`, `${place} heat is rude and personal.`],
    cold: [`${place} is painfully cold. Air now bites back.`, `${place} temperature: petty and below zero.`],
    mixed: [`${place} weather has commitment issues and zero shame.`, `${place} forecast says "figure it out yourself."`],
  }

  const apocalypse = {
    clear: [`${place} is calm. This is how disaster movies start.`, `${place} sunshine feels like suspicious peace before chaos.`],
    rain: [`${place} rain intensity: biblical beta test.`, `${place} is one ark away from a side quest.`],
    wind: [`${place} wind can probably file taxes for you at this speed.`, `${place} gusts are trying to relocate everyone manually.`],
    storm: [`${place} thunder is running system-wide panic notifications.`, `${place} sky currently selected "wrath" preset.`],
    snow: [`${place} snow edition: pretty apocalypse with soft edges.`, `${place} is cold, white, and plotting your ankle's downfall.`],
    hot: [`${place} heatwave is auditioning for end-of-days content.`, `${place} is one degree away from grilled pavement.`],
    cold: [`${place} cold level: post-credit survival mode.`, `${place} feels like the villain origin story of winter.`],
    mixed: [`${place} forecast is chaos in multiple formats.`, `${place} weather has become an unpatched expansion pack.`],
  }

  if (pack === 'dry') return common[mood]
  if (pack === 'savage') return savage[mood]
  if (pack === 'apocalypse') return apocalypse[mood]
  return [...common[mood], ...savage[mood]]
}

function wtfLine(w: CurrentWeather | null, place: string, pack: HumorPack): string {
  if (!w) return 'Weather is currently hiding in the bushes.'
  const mood = weatherMood(w)
  const lines = linePack(pack, mood, place)
  return lines[stableIndex(`${place}|${w.time}|${mood}|${pack}`, lines.length)]
}

function loadSavedLocation(): GeoResult | null {
  try {
    const raw = localStorage.getItem(LS_WEATHER_LOC)
    if (!raw) return null
    const parsed = JSON.parse(raw) as GeoResult
    if (!parsed?.name || typeof parsed.latitude !== 'number' || typeof parsed.longitude !== 'number') {
      return null
    }
    return parsed
  } catch {
    return null
  }
}

export function WeatherPanel() {
  const [query, setQuery] = useState(() => localStorage.getItem(LS_WEATHER_QUERY) || 'Copenhagen')
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const [choices, setChoices] = useState<GeoResult[]>([])
  const [selected, setSelected] = useState<GeoResult | null>(() => loadSavedLocation())
  const [weatherBusy, setWeatherBusy] = useState(false)
  const [weatherErr, setWeatherErr] = useState<string | null>(null)
  const [weather, setWeather] = useState<CurrentWeather | null>(null)
  const [timezone, setTimezone] = useState<string>('')
  const [forecast, setForecast] = useState<ForecastDay[]>([])
  const [refreshMins, setRefreshMins] = useState<number>(() => {
    const raw = Number(localStorage.getItem(LS_WEATHER_REFRESH) || 10)
    return [0, 5, 10, 15, 30].includes(raw) ? raw : 10
  })
  const [humorPack, setHumorPack] = useState<HumorPack>(() => {
    const v = (localStorage.getItem(LS_WEATHER_HUMOR) || 'chaos') as HumorPack
    return ['dry', 'chaos', 'savage', 'apocalypse'].includes(v) ? v : 'chaos'
  })

  useEffect(() => {
    localStorage.setItem(LS_WEATHER_QUERY, query)
  }, [query])

  useEffect(() => {
    if (selected) localStorage.setItem(LS_WEATHER_LOC, JSON.stringify(selected))
  }, [selected])

  useEffect(() => {
    localStorage.setItem(LS_WEATHER_REFRESH, String(refreshMins))
  }, [refreshMins])

  useEffect(() => {
    localStorage.setItem(LS_WEATHER_HUMOR, humorPack)
  }, [humorPack])

  const locationLabel = useMemo(() => {
    if (!selected) return 'No location selected'
    return [selected.name, selected.admin1, selected.country].filter(Boolean).join(', ')
  }, [selected])

  const search = useCallback(async () => {
    const q = query.trim()
    if (!q) return
    setSearchBusy(true)
    setSearchErr(null)
    try {
      const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Geo HTTP ${res.status}`)
      const data = (await res.json()) as { results?: GeoResult[] }
      const list = data.results || []
      setChoices(list)
      if (!list.length) {
        setSearchErr('No locations found.')
      }
    } catch (e) {
      setSearchErr(e instanceof Error ? e.message : String(e))
      setChoices([])
    } finally {
      setSearchBusy(false)
    }
  }, [query])

  const refreshWeather = useCallback(async () => {
    if (!selected) return
    setWeatherBusy(true)
    setWeatherErr(null)
    try {
      const url =
        `https://api.open-meteo.com/v1/forecast?latitude=${selected.latitude}&longitude=${selected.longitude}` +
        `&current=temperature_2m,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day` +
        `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_sum&forecast_days=6`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`Weather HTTP ${res.status}`)
      const data = (await res.json()) as WeatherResponse
      if (!data.current) throw new Error('No current weather in response')
      setWeather(data.current)
      setTimezone(data.timezone || selected.timezone || '')
      const daily = data.daily
      if (daily?.time?.length) {
        const days: ForecastDay[] = daily.time.map((date, i) => ({
          date,
          code: daily.weather_code?.[i] ?? 0,
          tempMax: daily.temperature_2m_max?.[i] ?? 0,
          tempMin: daily.temperature_2m_min?.[i] ?? 0,
          precipitation: daily.precipitation_sum?.[i] ?? 0,
        }))
        setForecast(days)
      } else {
        setForecast([])
      }
    } catch (e) {
      setWeatherErr(e instanceof Error ? e.message : String(e))
      setWeather(null)
      setForecast([])
    } finally {
      setWeatherBusy(false)
    }
  }, [selected])

  useEffect(() => {
    if (!selected) return
    void refreshWeather()
  }, [selected, refreshWeather])

  useEffect(() => {
    if (!selected || refreshMins <= 0) return
    const t = window.setInterval(() => void refreshWeather(), refreshMins * 60_000)
    return () => window.clearInterval(t)
  }, [selected, refreshMins, refreshWeather])

  return (
    <section className="panel weather-panel">
      <h2>Weather (WTF mode)</h2>
      <p className="hint">
        Pick any area and get live weather with mildly chaotic commentary.
      </p>

      <div className="row">
        <input
          className="wide"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && void search()}
          placeholder="Search area/city, e.g. Copenhagen, Tokyo, New York"
        />
        <button type="button" disabled={searchBusy} onClick={() => void search()}>
          {searchBusy ? 'Searching…' : 'Find area'}
        </button>
        <label>
          Auto refresh
          <select value={refreshMins} onChange={(e) => setRefreshMins(Number(e.target.value))}>
            <option value={0}>Off</option>
            <option value={5}>5 min</option>
            <option value={10}>10 min</option>
            <option value={15}>15 min</option>
            <option value={30}>30 min</option>
          </select>
        </label>
        <label>
          Humor pack
          <select value={humorPack} onChange={(e) => setHumorPack(e.target.value as HumorPack)}>
            <option value="dry">Dry</option>
            <option value="chaos">Chaos</option>
            <option value="savage">Savage</option>
            <option value="apocalypse">Apocalypse</option>
          </select>
        </label>
      </div>

      {searchErr ? <p className="error">{searchErr}</p> : null}
      {choices.length ? (
        <div className="weather-choices">
          {choices.map((c) => {
            const label = [c.name, c.admin1, c.country].filter(Boolean).join(', ')
            const active =
              selected?.id === c.id ||
              (selected?.name === c.name &&
                selected?.latitude === c.latitude &&
                selected?.longitude === c.longitude)
            return (
              <button
                key={`${c.id}-${c.latitude}-${c.longitude}`}
                type="button"
                className={active ? 'weather-choice active' : 'weather-choice'}
                onClick={() => setSelected(c)}
              >
                {label}
              </button>
            )
          })}
        </div>
      ) : null}

      <div className="weather-status-card">
        <div className="weather-status-head">
          <strong>{locationLabel}</strong>
          <button type="button" disabled={!selected || weatherBusy} onClick={() => void refreshWeather()}>
            {weatherBusy ? 'Updating…' : 'Update now'}
          </button>
        </div>
        {weatherErr ? <p className="error">{weatherErr}</p> : null}
        {weather ? (
          <>
            <p className="weather-wtf-line">{wtfLine(weather, selected?.name || 'this place', humorPack)}</p>
            <div className="weather-grid">
              <p>
                <span className="muted">Condition</span>
                <strong>{codeLabel(weather.weather_code)}</strong>
              </p>
              <p>
                <span className="muted">Temp</span>
                <strong>{weather.temperature_2m.toFixed(1)} C</strong>
              </p>
              <p>
                <span className="muted">Humidity</span>
                <strong>{weather.relative_humidity_2m}%</strong>
              </p>
              <p>
                <span className="muted">Rain</span>
                <strong>{weather.precipitation.toFixed(1)} mm</strong>
              </p>
              <p>
                <span className="muted">Wind</span>
                <strong>{weather.wind_speed_10m.toFixed(1)} km/h</strong>
              </p>
              <p>
                <span className="muted">Day/Night</span>
                <strong>{weather.is_day ? 'Day' : 'Night'}</strong>
              </p>
            </div>
            <p className="muted mono">
              Updated: {weather.time} {timezone ? `(${timezone})` : ''}
            </p>
            {forecast.length ? (
              <div className="weather-forecast">
                {forecast.map((d, i) => (
                  <article className="weather-forecast-day" key={`${d.date}-${i}`}>
                    <p className="muted mono">{d.date}</p>
                    <strong>{codeLabel(d.code)}</strong>
                    <p className="muted">High {d.tempMax.toFixed(1)} C</p>
                    <p className="muted">Low {d.tempMin.toFixed(1)} C</p>
                    <p className="muted">Rain {d.precipitation.toFixed(1)} mm</p>
                  </article>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <p className="muted">Search and choose an area to start weather updates.</p>
        )}
      </div>
    </section>
  )
}
