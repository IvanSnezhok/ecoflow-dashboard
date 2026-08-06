import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, BatteryCharging, CheckCircle2, Clock3, Gauge, Loader2, MapPin, Plus, RefreshCw, Save, ShieldCheck, Trash2, Zap } from 'lucide-react'
import { api } from '@/services/api'
import { useDeviceStore } from '@/stores/deviceStore'
import { cn } from '@/lib/utils'
import type { LoadPeriod, ResilienceSettings, ResilienceStatus, YasnoAddressOption, YasnoRegion } from '@/types/resilience'

const defaults: ResilienceSettings = {
  enabled: false, autoAc: false, warningLeadMinutes: 60, recoveryDelayMinutes: 15,
  minSoc: 25, reserveSoc: 15, batteryCapacityWh: 3600, inverterEfficiency: 0.85,
  loadProfile: [
    { start: '00:00', end: '07:00', watts: 180, label: 'Ніч' },
    { start: '07:00', end: '09:00', watts: 650, label: 'Ранок' },
    { start: '09:00', end: '18:00', watts: 280, label: 'Робочий час' },
    { start: '18:00', end: '23:00', watts: 850, label: 'Вечір' },
    { start: '23:00', end: '00:00', watts: 220, label: 'Пізній вечір' },
  ],
}

const riskCopy: Record<ResilienceStatus['risk'], { label: string; color: string; note: string }> = {
  none: { label: 'СТАБІЛЬНО', color: 'text-energy-green border-energy-green/40 bg-energy-green/5', note: 'Ризиків у найближчому вікні не виявлено' },
  watch: { label: 'СПОСТЕРЕЖЕННЯ', color: 'text-energy-blue border-energy-blue/40 bg-energy-blue/5', note: 'Є імовірне вікно відключення' },
  imminent: { label: 'ПІДГОТОВКА', color: 'text-energy-yellow border-energy-yellow/40 bg-energy-yellow/5', note: 'Відключення наближається' },
  active: { label: 'ВІДКЛЮЧЕННЯ', color: 'text-energy-red border-energy-red/40 bg-energy-red/5', note: 'Планове вікно активне' },
  emergency: { label: 'АВАРІЙНИЙ СТАН', color: 'text-energy-red border-energy-red/50 bg-energy-red/10', note: 'YASNO повідомляє про аварійні відключення' },
  stale: { label: 'ДАНІ ЗАСТАРІЛИ', color: 'text-muted-foreground border-border bg-muted/30', note: 'Автокерування призупинено до оновлення даних' },
}

function fmt(value?: string) {
  if (!value) return '—'
  return new Intl.DateTimeFormat('uk-UA', { timeZone: 'Europe/Kyiv', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(value))
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <label className="space-y-1.5"><span className="text-[10px] font-mono uppercase tracking-wider text-muted-foreground">{label}</span>{children}</label>
}
const inputClass = 'w-full h-9 rounded-sm border bg-background px-2.5 text-xs font-mono outline-none focus:border-primary'
const optionLabel = (option: YasnoAddressOption) => option.name ?? option.value ?? option.label ?? `#${option.id}`

export default function Resilience() {
  const { devices } = useDeviceStore()
  const [settings, setSettings] = useState<ResilienceSettings>(defaults)
  const [status, setStatus] = useState<ResilienceStatus>({ risk: 'none', events: [] })
  const [regions, setRegions] = useState<YasnoRegion[]>([])
  const [groups, setGroups] = useState<string[]>([])
  const [streetQuery, setStreetQuery] = useState('')
  const [houseQuery, setHouseQuery] = useState('')
  const [streets, setStreets] = useState<YasnoAddressOption[]>([])
  const [houses, setHouses] = useState<YasnoAddressOption[]>([])
  const [streetId, setStreetId] = useState<number | null>(null)
  const [houseId, setHouseId] = useState<number | null>(null)
  const [addressBusy, setAddressBusy] = useState(false)
  const [addressHint, setAddressHint] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => {
    Promise.all([api.getResilienceSettings(), api.getResilienceStatus(), api.getResilienceCatalog()])
      .then(([settingsRes, statusRes, catalogRes]) => {
        const loaded = settingsRes.data.data
        setSettings(loaded.loadProfile.length ? loaded : { ...loaded, loadProfile: defaults.loadProfile })
        setStatus(statusRes.data.data); setRegions(catalogRes.data.data)
      })
      .catch(error => setMessage(error instanceof Error ? error.message : 'Не вдалося завантажити конфігурацію'))
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    if (!settings.regionId || !settings.dsoId) { setGroups([]); return }
    api.getResilienceGroups(settings.regionId, settings.dsoId).then(res => setGroups(res.data.data)).catch(() => setGroups([]))
  }, [settings.regionId, settings.dsoId])

  useEffect(() => {
    if (!settings.regionId || !settings.dsoId || streetQuery.trim().length < 2 || streetId) {
      setStreets([]); return
    }
    const timer = window.setTimeout(() => {
      setAddressBusy(true)
      api.searchResilienceStreets(settings.regionId!, settings.dsoId!, streetQuery.trim())
        .then(res => setStreets(res.data.data))
        .catch(() => setStreets([]))
        .finally(() => setAddressBusy(false))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [settings.regionId, settings.dsoId, streetQuery, streetId])

  useEffect(() => {
    if (!settings.regionId || !settings.dsoId || !streetId || houseQuery.trim().length < 1 || houseId) {
      setHouses([]); return
    }
    const timer = window.setTimeout(() => {
      setAddressBusy(true)
      api.searchResilienceHouses(settings.regionId!, settings.dsoId!, streetId, houseQuery.trim())
        .then(res => setHouses(res.data.data))
        .catch(() => setHouses([]))
        .finally(() => setAddressBusy(false))
    }, 300)
    return () => window.clearTimeout(timer)
  }, [settings.regionId, settings.dsoId, streetId, houseQuery, houseId])

  useEffect(() => {
    const timer = window.setInterval(() => api.getResilienceStatus().then(res => setStatus(res.data.data)).catch(() => undefined), 30_000)
    return () => window.clearInterval(timer)
  }, [])

  const selectedRegion = useMemo(() => regions.find(region => region.id === settings.regionId), [regions, settings.regionId])
  const risk = riskCopy[status.risk]
  const nextEvents = status.events.filter(event => new Date(event.end) > new Date()).slice(0, 6)

  const patch = <K extends keyof ResilienceSettings>(key: K, value: ResilienceSettings[K]) => setSettings(current => ({ ...current, [key]: value }))
  const updateLoad = (index: number, value: Partial<LoadPeriod>) => patch('loadProfile', settings.loadProfile.map((period, i) => i === index ? { ...period, ...value } : period))
  const resetAddress = () => {
    setStreetQuery(''); setHouseQuery(''); setStreets([]); setHouses([])
    setStreetId(null); setHouseId(null); setAddressHint(null)
  }
  const selectStreet = (street: YasnoAddressOption) => {
    setStreetId(street.id); setStreetQuery(optionLabel(street)); setStreets([])
    setHouseId(null); setHouseQuery(''); setHouses([]); setAddressHint('Введіть номер будинку')
  }
  const selectHouse = async (house: YasnoAddressOption) => {
    if (!settings.regionId || !settings.dsoId || !streetId) return
    setHouseId(house.id); setHouseQuery(optionLabel(house)); setHouses([]); setAddressBusy(true)
    try {
      const res = await api.resolveResilienceGroup(settings.regionId, settings.dsoId, streetId, house.id)
      patch('outageGroup', res.data.data.group)
      setAddressHint(`Адресу знайдено · група ${res.data.data.group}`)
    } catch (error) {
      setAddressHint(error instanceof Error ? error.message : 'Не вдалося визначити групу')
    } finally { setAddressBusy(false) }
  }

  const save = async () => {
    setSaving(true); setMessage(null)
    try { const res = await api.updateResilienceSettings(settings); setSettings(res.data.data); setMessage('Налаштування збережено') }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Помилка збереження') }
    finally { setSaving(false) }
  }
  const refresh = async () => {
    setRefreshing(true); setMessage(null)
    try { const res = await api.refreshResilience(); setStatus(res.data.data) }
    catch (error) { setMessage(error instanceof Error ? error.message : 'Помилка оновлення') }
    finally { setRefreshing(false) }
  }

  if (loading) return <div className="py-16 flex justify-center"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>

  return <div className="space-y-5">
    <div className="flex items-start justify-between gap-4">
      <div><h1 className="text-lg font-semibold tracking-tight">Резерв живлення</h1><p className="text-[10px] font-mono text-muted-foreground uppercase tracking-wider">Київ · YASNO · DELTA Pro</p></div>
      <div className="flex gap-2">
        <button onClick={refresh} disabled={refreshing} className="h-9 px-3 rounded-sm border text-xs font-mono flex items-center gap-2 hover:bg-muted"><RefreshCw className={cn('w-3.5 h-3.5', refreshing && 'animate-spin')} />Оновити</button>
        <button onClick={save} disabled={saving} className="h-9 px-3 rounded-sm bg-primary text-primary-foreground text-xs font-mono flex items-center gap-2"><Save className="w-3.5 h-3.5" />{saving ? 'Збереження…' : 'Зберегти'}</button>
      </div>
    </div>

    {message && <div className="rounded-sm border px-3 py-2 text-xs font-mono">{message}</div>}

    <section className={cn('rounded-sm border p-5 relative overflow-hidden', risk.color)}>
      <div className="absolute right-0 top-0 text-[96px] leading-none font-black opacity-[0.04] select-none">50Hz</div>
      <div className="flex items-start justify-between gap-6 relative">
        <div><div className="flex items-center gap-2"><Zap className="w-5 h-5" /><span className="text-sm font-black tracking-[0.16em]">{risk.label}</span></div><p className="mt-2 text-xs text-foreground">{risk.note}</p><p className="mt-1 text-[10px] font-mono text-muted-foreground">Перевірено: {fmt(status.checkedAt)} {status.error ? `· ${status.error}` : ''}</p></div>
        {status.nextEvent && <div className="text-right"><div className="text-[10px] font-mono uppercase text-muted-foreground">Наступне вікно</div><div className="mt-1 text-sm font-mono font-semibold">{fmt(status.nextEvent.start)}</div><div className="text-[10px] font-mono">до {fmt(status.nextEvent.end)}</div></div>}
      </div>
    </section>

    <div className="grid lg:grid-cols-3 gap-4">
      <section className="lg:col-span-2 rounded-sm border bg-card p-4 space-y-4">
        <div className="flex items-center justify-between"><div className="flex items-center gap-2"><ShieldCheck className="w-4 h-4 text-primary" /><h2 className="text-xs font-semibold uppercase tracking-wider">Автокерування AC</h2></div>
          <button onClick={() => patch('enabled', !settings.enabled)} className={cn('w-11 h-6 rounded-full p-0.5 transition-colors', settings.enabled ? 'bg-energy-green' : 'bg-muted')}><span className={cn('block w-5 h-5 rounded-full bg-white transition-transform', settings.enabled && 'translate-x-5')} /></button></div>
        <div className="grid sm:grid-cols-2 gap-3">
          <Field label="EcoFlow"><select className={inputClass} value={settings.deviceId ?? ''} onChange={e => patch('deviceId', Number(e.target.value) || undefined)}><option value="">Оберіть пристрій</option>{devices.filter(d => d.capabilities?.acOutput).map(device => <option key={device.serialNumber} value={device.id}>{device.name}</option>)}</select></Field>
          <Field label="Регіон"><select className={inputClass} value={settings.regionId ?? ''} onChange={e => { const id = Number(e.target.value) || undefined; patch('regionId', id); patch('dsoId', undefined); patch('outageGroup', undefined); resetAddress() }}><option value="">Оберіть регіон</option>{regions.map(region => <option key={region.id} value={region.id}>{region.name ?? region.value}</option>)}</select></Field>
          <Field label="Оператор мережі"><select className={inputClass} value={settings.dsoId ?? ''} onChange={e => { patch('dsoId', Number(e.target.value) || undefined); patch('outageGroup', undefined); resetAddress() }} disabled={!selectedRegion}><option value="">Оберіть оператора</option>{selectedRegion?.dsos?.map(dso => <option key={dso.id} value={dso.id}>{dso.name}</option>)}</select></Field>
          <Field label="Група відключень"><select className={inputClass} value={settings.outageGroup ?? ''} onChange={e => patch('outageGroup', e.target.value || undefined)}><option value="">Оберіть групу</option>{groups.map(group => <option key={group}>{group}</option>)}</select></Field>
        </div>
        <div className="rounded-sm border bg-muted/20 p-3">
          <div className="flex items-center justify-between gap-3 mb-3">
            <div className="flex items-center gap-2"><MapPin className="w-4 h-4 text-energy-blue" /><div><div className="text-xs font-semibold">Визначити групу за адресою</div><div className="text-[10px] text-muted-foreground">Введіть вулицю та будинок — група підставиться автоматично</div></div></div>
            {addressBusy && <Loader2 className="w-4 h-4 animate-spin text-primary" />}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div className="relative">
              <Field label="Вулиця"><input className={inputClass} value={streetQuery} disabled={!settings.regionId || !settings.dsoId} onChange={e => { setStreetQuery(e.target.value); setStreetId(null); setHouseId(null); setHouseQuery(''); setAddressHint(null) }} placeholder="Наприклад, Хрещатик" autoComplete="off" /></Field>
              {streets.length > 0 && <div className="absolute z-20 top-full mt-1 w-full max-h-44 overflow-y-auto rounded-sm border bg-card shadow-xl">{streets.map(street => <button type="button" key={street.id} onClick={() => selectStreet(street)} className="block w-full px-3 py-2 text-left text-xs hover:bg-muted border-b last:border-b-0">{optionLabel(street)}</button>)}</div>}
            </div>
            <div className="relative">
              <Field label="Будинок"><input className={inputClass} value={houseQuery} disabled={!streetId} onChange={e => { setHouseQuery(e.target.value); setHouseId(null); setAddressHint(null) }} placeholder="Наприклад, 12А" autoComplete="off" /></Field>
              {houses.length > 0 && <div className="absolute z-20 top-full mt-1 w-full max-h-44 overflow-y-auto rounded-sm border bg-card shadow-xl">{houses.map(house => <button type="button" key={house.id} onClick={() => selectHouse(house)} className="block w-full px-3 py-2 text-left text-xs hover:bg-muted border-b last:border-b-0">{optionLabel(house)}</button>)}</div>}
            </div>
          </div>
          {addressHint && <div className={cn('mt-2 flex items-center gap-1.5 text-[10px] font-mono', houseId && settings.outageGroup ? 'text-energy-green' : 'text-muted-foreground')}>{houseId && settings.outageGroup && <CheckCircle2 className="w-3.5 h-3.5" />}{addressHint}</div>}
        </div>
        <div className="grid sm:grid-cols-4 gap-3">
          <Field label="Попередження, хв"><input className={inputClass} type="number" value={settings.warningLeadMinutes} onChange={e => patch('warningLeadMinutes', Number(e.target.value))} /></Field>
          <Field label="Затримка вимк., хв"><input className={inputClass} type="number" value={settings.recoveryDelayMinutes} onChange={e => patch('recoveryDelayMinutes', Number(e.target.value))} /></Field>
          <Field label="Мін. SOC, %"><input className={inputClass} type="number" value={settings.minSoc} onChange={e => patch('minSoc', Number(e.target.value))} /></Field>
          <Field label="Резерв SOC, %"><input className={inputClass} type="number" value={settings.reserveSoc} onChange={e => patch('reserveSoc', Number(e.target.value))} /></Field>
        </div>
        <label className="flex items-start gap-3 rounded-sm border bg-muted/20 p-3 cursor-pointer"><input type="checkbox" className="mt-0.5" checked={settings.autoAc} onChange={e => patch('autoAc', e.target.checked)} /><span><span className="block text-xs font-medium">Дозволити автоматичне перемикання AC</span><span className="block mt-1 text-[10px] text-muted-foreground">AC вмикається перед плановим/імовірним вікном і при аварійному статусі. Вимикається лише якщо його ввімкнула ця автоматизація.</span></span></label>
      </section>

      <section className="rounded-sm border bg-card p-4 space-y-4"><div className="flex items-center gap-2"><Gauge className="w-4 h-4 text-energy-blue" /><h2 className="text-xs font-semibold uppercase tracking-wider">Прогноз автономності</h2></div>
        {status.forecast ? <><div><div className="text-3xl font-mono font-bold tabular-nums">{status.forecast.hoursRemaining === null ? '>336' : status.forecast.hoursRemaining}<span className="text-sm text-muted-foreground ml-1">год</span></div><div className="text-[10px] text-muted-foreground mt-1">до резервного SOC за профілем</div></div>
          <div className="space-y-2 text-xs font-mono"><div className="flex justify-between"><span className="text-muted-foreground">Батареї</span><span>{status.forecast.batteryCount} × {settings.batteryCapacityWh / 1000} кВт·год</span></div><div className="flex justify-between"><span className="text-muted-foreground">Доступно AC</span><span>{(status.forecast.usableWh / 1000).toFixed(2)} кВт·год</span></div><div className="flex justify-between"><span className="text-muted-foreground">Середнє</span><span>{status.forecast.averageLoadWatts} Вт</span></div><div className="flex justify-between"><span className="text-muted-foreground">До</span><span>{fmt(status.forecast.depletionAt ?? undefined)}</span></div></div></> : <div className="text-xs text-muted-foreground">Прогноз з’явиться після наступного циклу опитування EcoFlow.</div>}
        <div className="grid grid-cols-2 gap-2"><Field label="Ємність однієї, Wh"><input className={inputClass} type="number" value={settings.batteryCapacityWh} onChange={e => patch('batteryCapacityWh', Number(e.target.value))} /></Field><Field label="ККД інвертора"><input className={inputClass} type="number" step="0.01" value={settings.inverterEfficiency} onChange={e => patch('inverterEfficiency', Number(e.target.value))} /></Field></div>
      </section>
    </div>

    <div className="grid lg:grid-cols-5 gap-4">
      <section className="lg:col-span-3 rounded-sm border bg-card p-4"><div className="flex items-center justify-between mb-3"><div className="flex items-center gap-2"><BatteryCharging className="w-4 h-4 text-energy-green" /><h2 className="text-xs font-semibold uppercase tracking-wider">Графік споживання</h2></div><button onClick={() => patch('loadProfile', [...settings.loadProfile, { start: '12:00', end: '13:00', watts: 300, label: 'Нове вікно' }])} className="text-[10px] font-mono flex items-center gap-1"><Plus className="w-3 h-3" />Додати</button></div>
        <div className="space-y-2">{settings.loadProfile.map((period, index) => <div key={index} className="grid grid-cols-[1fr_92px_92px_90px_28px] gap-2 items-center"><input className={inputClass} value={period.label ?? ''} onChange={e => updateLoad(index, { label: e.target.value })} placeholder="Назва" /><input className={inputClass} type="time" value={period.start} onChange={e => updateLoad(index, { start: e.target.value })} /><input className={inputClass} type="time" value={period.end} onChange={e => updateLoad(index, { end: e.target.value })} /><div className="relative"><input className={cn(inputClass, 'pr-7')} type="number" value={period.watts} onChange={e => updateLoad(index, { watts: Number(e.target.value) })} /><span className="absolute right-2 top-2.5 text-[10px] text-muted-foreground">W</span></div><button onClick={() => patch('loadProfile', settings.loadProfile.filter((_, i) => i !== index))}><Trash2 className="w-3.5 h-3.5 text-muted-foreground hover:text-energy-red" /></button></div>)}</div>
      </section>
      <section className="lg:col-span-2 rounded-sm border bg-card p-4"><div className="flex items-center gap-2 mb-3"><Clock3 className="w-4 h-4 text-energy-yellow" /><h2 className="text-xs font-semibold uppercase tracking-wider">Найближчі вікна</h2></div><div className="space-y-2">{nextEvents.length ? nextEvents.map((event, index) => <div key={`${event.start}-${index}`} className="flex items-center gap-3 rounded-sm border p-2.5"><div className={cn('w-1 h-8 rounded-full', event.type === 'definite' ? 'bg-energy-red' : 'bg-energy-yellow')} /><div className="flex-1"><div className="text-xs font-mono">{fmt(event.start)} — {fmt(event.end).split(' ')[1]}</div><div className="text-[10px] text-muted-foreground uppercase">{event.type === 'definite' ? 'планове' : 'імовірне'} · {event.source}</div></div></div>) : <div className="py-8 text-center text-xs text-muted-foreground">Запланованих вікон немає</div>}</div></section>
    </div>

    <div className="flex gap-2 text-[10px] text-muted-foreground"><AlertTriangle className="w-3.5 h-3.5 flex-shrink-0" /><p>Графіки YASNO є орієнтовними та можуть змінюватися. При застарілих даних автоматичні команди блокуються; локальний мінімальний SOC має пріоритет над зовнішнім сигналом.</p></div>
  </div>
}
