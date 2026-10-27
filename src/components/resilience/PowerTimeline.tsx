import { useEffect, useMemo, useState } from 'react'
import { BatteryCharging, CalendarClock, Loader2, Plug, PlugZap, Sun } from 'lucide-react'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import type { GridState, PowerDay } from '@/types/resilience'

const RANGES = [7, 14, 30] as const
const HOUR_TICKS = [0, 3, 6, 9, 12, 15, 18, 21, 24]

const stateCopy: Record<GridState, { label: string; bar: string }> = {
  on: { label: 'світло є', bar: 'bg-energy-green' },
  off: { label: 'світла немає', bar: 'bg-energy-red' },
  unknown: { label: 'немає даних', bar: 'bg-muted-foreground/25' },
}

// Diagonal stripes keep "scheduled off" readable without relying on red alone.
const scheduledStripes = 'repeating-linear-gradient(135deg, rgba(239,68,68,0.85) 0 3px, rgba(239,68,68,0.35) 3px 6px)'

const timeFormat = new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const dayFormat = new Intl.DateTimeFormat('uk-UA', { timeZone: 'UTC', weekday: 'short', day: '2-digit', month: '2-digit' })

function kyivTime(iso: string, dayEnd?: string): string {
  // The end of the day reads better as 24:00 than as the next day's 00:00.
  return iso === dayEnd ? '24:00' : timeFormat.format(new Date(iso))
}

export function formatMinutes(total: number): string {
  const hours = Math.floor(total / 60)
  const minutes = Math.round(total % 60)
  return `${hours}:${String(minutes).padStart(2, '0')}`
}

function kwh(wh: number): string {
  return (wh / 1000).toFixed(wh >= 10_000 ? 1 : 2)
}

interface Hover { day: string; text: string }

function Span({ day, start, end, className, style, label, onHover }: {
  day: PowerDay; start: string; end: string; className?: string; style?: React.CSSProperties; label: string
  onHover: (hover: Hover | null) => void
}) {
  const dayStart = +new Date(day.start)
  const length = +new Date(day.end) - dayStart
  const left = ((+new Date(start) - dayStart) / length) * 100
  const width = ((+new Date(end) - +new Date(start)) / length) * 100
  const text = `${kyivTime(start)}–${kyivTime(end, day.end)} · ${label}`
  return <div
    className={cn('absolute inset-y-0', className)}
    style={{ left: `${left}%`, width: `${width}%`, ...style }}
    title={text}
    onMouseEnter={() => onHover({ day: day.day, text })}
    onMouseLeave={() => onHover(null)}
  />
}

function DayRow({ day, withSchedule, onHover }: { day: PowerDay; withSchedule: boolean; onHover: (hover: Hover | null) => void }) {
  const { stats } = day
  const scheduleLabel = day.scheduleSource === 'planned' ? 'графік' : day.scheduleSource === 'probable' ? 'імовірний' : 'без графіка'
  return <div className="grid grid-cols-[64px_1fr] sm:grid-cols-[72px_1fr_minmax(0,260px)] gap-x-3 gap-y-1 items-center py-2 border-b last:border-b-0">
    <div>
      <div className="text-xs font-mono font-semibold">{dayFormat.format(new Date(`${day.day}T12:00:00Z`))}</div>
      {withSchedule && <div className="text-[9px] font-mono uppercase text-muted-foreground">{day.future ? 'завтра' : scheduleLabel}</div>}
    </div>
    <div className="space-y-1 min-w-0">
      {withSchedule && <div className="relative h-1.5 rounded-sm bg-muted/60 overflow-hidden" aria-label="За графіком">
        {day.scheduledOff.map(window => <Span key={window.start} day={day} start={window.start} end={window.end}
          style={{ background: scheduledStripes }} label={`за графіком без світла (${scheduleLabel})`} onHover={onHover} />)}
      </div>}
      <div className="relative h-4 rounded-sm bg-muted/30 overflow-hidden" aria-label="Фактично">
        {day.segments.map(segment => <Span key={segment.start} day={day} start={segment.start} end={segment.end}
          className={cn(stateCopy[segment.state].bar, 'border-r-2 border-card last:border-r-0')} label={stateCopy[segment.state].label} onHover={onHover} />)}
      </div>
    </div>
    <div className="col-start-2 sm:col-start-3 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] font-mono text-muted-foreground">
      {day.future
        ? <span>За графіком без світла: <b className="text-foreground">{formatMinutes(stats.scheduledOffMinutes)}</b></span>
        : <>
          {withSchedule && <span title="Світло було, хоча за графіком мало не бути">+<b className="text-foreground">{formatMinutes(stats.extraOnMinutes)}</b> зі світлом</span>}
          <span title="Без світла (фактично)">без світла <b className="text-foreground">{formatMinutes(stats.offMinutes)}</b>{withSchedule && stats.unplannedOffMinutes > 0 && <> (поза графіком {formatMinutes(stats.unplannedOffMinutes)})</>}</span>
          {stats.offMinutes > 0 && <span title="Скільки EcoFlow живив розетки без мережі і скільки віддав">EcoFlow <b className="text-foreground">{formatMinutes(stats.ecoflowMinutes)}</b> · <b className="text-foreground">{kwh(stats.ecoflowWh)}</b> кВт·год</span>}
        </>}
    </div>
  </div>
}

function Tile({ icon: Icon, label, value, note, className }: { icon: typeof Sun; label: string; value: string; note?: string; className?: string }) {
  return <div className="rounded-sm border bg-muted/20 p-3">
    <div className="flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider text-muted-foreground"><Icon className={cn('w-3.5 h-3.5', className)} />{label}</div>
    <div className="mt-1 text-lg font-mono font-bold tabular-nums">{value}</div>
    {note && <div className="text-[10px] text-muted-foreground">{note}</div>}
  </div>
}

/**
 * Light / no-light timeline per day, compared with the outage schedule (svitlobot style).
 * Without a schedule (grid-only mode) only the actual grid strip and its totals are shown.
 */
export function PowerTimeline({ refreshKey, withSchedule = true }: { refreshKey?: unknown; withSchedule?: boolean }) {
  const [range, setRange] = useState<(typeof RANGES)[number]>(7)
  const [days, setDays] = useState<PowerDay[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [hover, setHover] = useState<Hover | null>(null)

  useEffect(() => {
    let cancelled = false
    const load = () => api.getResilienceTimeline(range)
      .then(res => { if (!cancelled) { setDays(res.data.data); setError(null) } })
      .catch(err => { if (!cancelled) setError(err instanceof Error ? err.message : 'Не вдалося завантажити таймлайн') })
      .finally(() => { if (!cancelled) setLoading(false) })
    load()
    const timer = window.setInterval(load, 60_000)
    return () => { cancelled = true; window.clearInterval(timer) }
  }, [range, refreshKey])

  const totals = useMemo(() => days.filter(day => !day.future).reduce((sum, day) => ({
    on: sum.on + day.stats.onMinutes,
    extraOn: sum.extraOn + day.stats.extraOnMinutes,
    off: sum.off + day.stats.offMinutes,
    unplanned: sum.unplanned + day.stats.unplannedOffMinutes,
    scheduled: sum.scheduled + day.stats.scheduledOffMinutes,
    ecoflowMinutes: sum.ecoflowMinutes + day.stats.ecoflowMinutes,
    ecoflowWh: sum.ecoflowWh + day.stats.ecoflowWh,
  }), { on: 0, extraOn: 0, off: 0, unplanned: 0, scheduled: 0, ecoflowMinutes: 0, ecoflowWh: 0 }), [days])
  const pastDays = days.filter(day => !day.future).length || 1

  return <section className="rounded-sm border bg-card p-4 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-2"><CalendarClock className="w-4 h-4 text-energy-blue" /><h2 className="text-xs font-semibold uppercase tracking-wider">{withSchedule ? 'Світло: факт і графік' : 'Світло: факт'}</h2></div>
      <div className="flex rounded-sm border overflow-hidden" role="group" aria-label="Період">
        {RANGES.map(value => <button key={value} onClick={() => setRange(value)}
          className={cn('h-7 px-2.5 text-[10px] font-mono', range === value ? 'bg-primary text-primary-foreground' : 'hover:bg-muted')}>{value} дн</button>)}
      </div>
    </div>

    <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
      {withSchedule
        ? <Tile icon={Sun} className="text-energy-green" label="Додатково зі світлом" value={`${formatMinutes(totals.extraOn)} год`}
          note={`≈ ${formatMinutes(totals.extraOn / pastDays)} год/день понад графік`} />
        : <Tile icon={Sun} className="text-energy-green" label="Зі світлом" value={`${formatMinutes(totals.on)} год`}
          note={`≈ ${formatMinutes(totals.on / pastDays)} год/день`} />}
      <Tile icon={Plug} className="text-energy-red" label="Без світла" value={`${formatMinutes(totals.off)} год`}
        note={!withSchedule ? `≈ ${formatMinutes(totals.off / pastDays)} год/день`
          : totals.unplanned > 0 ? `з них поза графіком ${formatMinutes(totals.unplanned)}` : 'усе в межах графіка'} />
      <Tile icon={PlugZap} className="text-energy-yellow" label="EcoFlow працював" value={`${formatMinutes(totals.ecoflowMinutes)} год`}
        note="живив розетки без мережі" />
      <Tile icon={BatteryCharging} className="text-energy-blue" label="Віддано з батареї" value={`${kwh(totals.ecoflowWh)} кВт·год`}
        note={totals.off > 0 ? `≈ ${Math.round(totals.ecoflowWh / (totals.off / 60))} Вт у середньому` : undefined} />
    </div>

    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-muted-foreground">
      <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm bg-energy-green" />світло є</span>
      <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm bg-energy-red" />світла немає</span>
      <span className="flex items-center gap-1.5"><span className="w-3 h-2.5 rounded-sm bg-muted-foreground/25" />немає даних</span>
      {withSchedule && <span className="flex items-center gap-1.5"><span className="w-3 h-1.5 rounded-sm" style={{ background: scheduledStripes }} />за графіком без світла</span>}
    </div>

    <div className="min-h-[16px] text-[10px] font-mono" aria-live="polite">{hover ? <><span className="text-muted-foreground">{hover.day} · </span>{hover.text}</> : <span className="text-muted-foreground">Наведіть на смугу, щоб побачити час</span>}</div>

    {loading ? <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
      : error ? <div className="text-xs text-energy-red">{error}</div>
        : days.length === 0 ? <div className="py-6 text-center text-xs text-muted-foreground">Оберіть пристрій EcoFlow — стан мережі почне записуватися з наступного опитування.</div>
          : <div>
            <div className="grid grid-cols-[64px_1fr] sm:grid-cols-[72px_1fr_minmax(0,260px)] gap-x-3">
              <div />
              <div className="relative h-3 text-[9px] font-mono text-muted-foreground">
                {HOUR_TICKS.map(hour => <span key={hour} className={cn('absolute', hour === 0 ? '' : hour === 24 ? '-translate-x-full' : '-translate-x-1/2')} style={{ left: `${(hour / 24) * 100}%` }}>{String(hour).padStart(2, '0')}</span>)}
              </div>
            </div>
            {days.map(day => <DayRow key={day.day} day={day} withSchedule={withSchedule} onHover={setHover} />)}
          </div>}
    <p className="text-[10px] text-muted-foreground">Факт визначається за напругою на вході EcoFlow (оновлення кожні 10 с).{withSchedule && ' Верхня смуга — графік YASNO на той день (плановий, або імовірний, якщо планового не було). «Зі світлом понад графік» — хвилини, коли за графіком світла мало не бути, а воно було.'}</p>
  </section>
}
