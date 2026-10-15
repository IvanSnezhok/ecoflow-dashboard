// Pure decision logic for the outage automation: when to switch AC and which
// Slack alerts to raise. Kept free of DB/API imports so it can be tested alone.
import type { GridState, OutageEvent, ResilienceStatus, RuntimeForecast } from '../types/resilience.js'

export type Risk = ResilienceStatus['risk']
export type AcAction = NonNullable<ResilienceStatus['acAction']>

const AC_COMMAND_COOLDOWN_MS = 60_000
/** The output load must stay under the off threshold this long before AC is switched off. */
export const LOW_LOAD_CONFIRM_MS = 2 * 60_000
const RISK_REQUIRES_AC: Risk[] = ['imminent', 'active', 'emergency']
const OUTAGE_RISKS: Risk[] = ['active', 'emergency']

export interface AcDecisionInput {
  autoAc: boolean
  risk: Risk
  /** The device itself reports no mains on its AC input. */
  gridOff: boolean
  soc: number
  minSoc: number
  acEnabled: boolean
  acOutputWatts: number
  acOffMaxWatts: number
  automationOwnsAc: boolean
  recoveryDelayMinutes: number
  lastRiskAt: number
  lowLoadSince: number | null
  lastAcCommandAt: number
  nowMs: number
}

export interface AcDecision {
  action: Exclude<AcAction, 'failed'>
  lastRiskAt: number
  lowLoadSince: number | null
}

export function decideAcAction(input: AcDecisionInput): AcDecision {
  const lowLoad = input.acOutputWatts < input.acOffMaxWatts
  const lowLoadSince = lowLoad ? input.lowLoadSince ?? input.nowMs : null
  // A blackout the device actually sees overrides a stale or quiet schedule.
  if (!input.autoAc || (input.risk === 'stale' && !input.gridOff)) {
    return { action: 'none', lastRiskAt: input.lastRiskAt, lowLoadSince }
  }

  const riskRequiresAc = input.gridOff || RISK_REQUIRES_AC.includes(input.risk)
  const lastRiskAt = riskRequiresAc ? input.nowMs : input.lastRiskAt
  const inRecoveryDelay = input.automationOwnsAc && input.nowMs - lastRiskAt < input.recoveryDelayMinutes * 60_000
  const shouldBeOn = riskRequiresAc || inRecoveryDelay
  const result = (action: AcDecision['action']): AcDecision => ({ action, lastRiskAt, lowLoadSince })

  if (input.nowMs - input.lastAcCommandAt < AC_COMMAND_COOLDOWN_MS) return result('none')
  if (shouldBeOn && input.soc < input.minSoc) return result('blocked-low-soc')
  if (shouldBeOn && !input.acEnabled) return result('on')
  if (!shouldBeOn && input.acEnabled && input.automationOwnsAc) {
    // Never cut sockets that are still feeding something.
    const lowLongEnough = lowLoadSince !== null && input.nowMs - lowLoadSince >= LOW_LOAD_CONFIRM_MS
    return result(lowLongEnough ? 'off' : 'waiting-load')
  }
  return result('none')
}

export type AlertKind =
  | 'outage-warning' | 'outage-started' | 'emergency' | 'outage-ended'
  | 'schedule-stale' | 'schedule-restored'
  | 'ac-on' | 'ac-off' | 'ac-off-deferred' | 'ac-failed' | 'ac-blocked-low-soc' | 'low-reserve'
  | 'grid-lost' | 'grid-restored'

export interface ResilienceAlert {
  kind: AlertKind
  title: string
  message: string
  color: 'good' | 'warning' | 'danger'
}

export interface AlertState {
  risk?: Risk
  grid?: GridState
  warnedEventStart?: string
  lowReserveEventStart?: string
  blockedNotified: boolean
  deferredNotified: boolean
}

export const initialAlertState: AlertState = { blockedNotified: false, deferredNotified: false }

/** Summary of an outage the device has just come out of. */
export interface FinishedOutage {
  minutes: number
  ecoflowMinutes: number
  wh: number
}

export interface AlertInput {
  risk: Risk
  currentEvent?: OutageEvent
  nextEvent?: OutageEvent
  forecast?: RuntimeForecast
  acAction: AcAction
  soc: number
  minSoc: number
  grid?: { state: GridState; unplanned: boolean }
  finishedOutage?: FinishedOutage
  acOutputWatts?: number
  acOffMaxWatts?: number
}

export function formatKyivTime(iso: string): string {
  return new Intl.DateTimeFormat('uk-UA', {
    timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).format(new Date(iso))
}

function windowText(event: OutageEvent): string {
  const kind = event.type === 'definite' ? 'планове' : 'імовірне'
  return `${formatKyivTime(event.start)}–${formatKyivTime(event.end)} (${kind})`
}

export function formatDuration(minutes: number): string {
  const hours = Math.floor(minutes / 60)
  const rest = Math.round(minutes % 60)
  return hours > 0 ? `${hours} год ${rest} хв` : `${rest} хв`
}

function runtimeText(forecast?: RuntimeForecast): string {
  if (!forecast) return ''
  // The pack count shows at a glance whether every extra battery was counted
  const packs = `батарей: ${forecast.batteryCount}`
  if (forecast.hoursRemaining === null) return ` Запасу (${packs}) вистачить більш ніж на 14 діб.`
  return ` Запасу до резервного SOC (${packs}): ~${forecast.hoursRemaining} год.`
}

/**
 * Compares the previous alert state with the current automation result and
 * returns the alerts to send plus the next state. The first observation after
 * a restart only records the risk, so a restart mid-outage does not re-announce
 * a transition that already happened.
 */
export function detectAlerts(prev: AlertState, input: AlertInput): { alerts: ResilienceAlert[]; state: AlertState } {
  const alerts: ResilienceAlert[] = []
  const state: AlertState = { ...prev, risk: input.risk }
  const firstObservation = prev.risk === undefined
  const changed = !firstObservation && prev.risk !== input.risk
  const soc = `SOC ${Math.round(input.soc)}%.`

  if (changed && input.risk === 'stale') {
    alerts.push({ kind: 'schedule-stale', color: 'warning', title: 'Графік YASNO недоступний',
      message: 'Дані про відключення застаріли, автокерування AC призупинено до оновлення.' })
  } else if (changed && prev.risk === 'stale') {
    alerts.push({ kind: 'schedule-restored', color: 'good', title: 'Графік YASNO оновлено',
      message: 'Дані про відключення знову актуальні, автокерування відновлено.' })
  }

  if (input.risk === 'imminent' && input.nextEvent && input.nextEvent.start !== prev.warnedEventStart) {
    state.warnedEventStart = input.nextEvent.start
    alerts.push({ kind: 'outage-warning', color: 'warning', title: 'Наближається відключення',
      message: `Вікно ${windowText(input.nextEvent)}. ${soc}${runtimeText(input.forecast)}` })
  }

  if (changed && input.risk === 'emergency') {
    alerts.push({ kind: 'emergency', color: 'danger', title: 'Аварійні відключення',
      message: `YASNO повідомляє про аварійні відключення. ${soc}${runtimeText(input.forecast)}` })
  } else if (changed && input.risk === 'active' && prev.risk !== 'emergency') {
    alerts.push({ kind: 'outage-started', color: 'danger', title: 'Відключення почалося',
      message: `${input.currentEvent ? `Вікно ${windowText(input.currentEvent)}. ` : ''}${soc}${runtimeText(input.forecast)}` })
  } else if (changed && OUTAGE_RISKS.includes(prev.risk as Risk) && (input.risk === 'none' || input.risk === 'watch')) {
    alerts.push({ kind: 'outage-ended', color: 'good', title: 'Вікно відключення завершилося',
      message: `За графіком світло мало повернутися. ${soc}` })
  }

  // Grid transitions come from the device itself, not from the schedule.
  const grid = input.grid?.state
  if (grid && grid !== 'unknown') {
    state.grid = grid
    if (prev.grid === 'on' && grid === 'off') {
      alerts.push(input.grid?.unplanned
        ? { kind: 'grid-lost', color: 'danger', title: 'Позапланове відключення світла',
          message: `Мережа зникла, хоча за графіком світло мало бути. AC EcoFlow має бути увімкнено. ${soc}${runtimeText(input.forecast)}` }
        : { kind: 'grid-lost', color: 'warning', title: 'Світло зникло',
          message: `Відключення за графіком. ${soc}${runtimeText(input.forecast)}` })
    } else if (prev.grid === 'off' && grid === 'on') {
      const outage = input.finishedOutage
      alerts.push({ kind: 'grid-restored', color: 'good', title: 'Світло повернулося',
        message: outage
          ? `Без світла ${formatDuration(outage.minutes)}. EcoFlow живив ${formatDuration(outage.ecoflowMinutes)}, віддав ${(outage.wh / 1000).toFixed(2)} кВт·год. ${soc}`
          : `Мережа знову є. ${soc}` })
    }
  }

  if (input.acAction === 'on') {
    alerts.push({ kind: 'ac-on', color: 'good', title: 'AC увімкнено автоматично', message: `Підготовка до відключення. ${soc}` })
  } else if (input.acAction === 'off') {
    alerts.push({ kind: 'ac-off', color: 'good', title: 'AC вимкнено автоматично', message: `Ризик відключення минув, навантаження зникло. ${soc}` })
  } else if (input.acAction === 'failed') {
    alerts.push({ kind: 'ac-failed', color: 'danger', title: 'Не вдалося перемкнути AC',
      message: 'Команда EcoFlow не пройшла, автоматизація повторить спробу. Перевірте пристрій.' })
  }

  // Only announce a deferral caused by real load, not the short low-load confirmation wait.
  const loadWatts = input.acOutputWatts ?? 0
  const threshold = input.acOffMaxWatts ?? 0
  if (input.acAction === 'waiting-load') {
    if (!prev.deferredNotified && loadWatts >= threshold) {
      state.deferredNotified = true
      alerts.push({ kind: 'ac-off-deferred', color: 'warning', title: 'AC залишено увімкненим',
        message: `Ризик відключення минув, але з розеток EcoFlow ще йде ${Math.round(loadWatts)} Вт. AC вимкнеться, коли навантаження впаде нижче ${threshold} Вт.` })
    }
  } else {
    state.deferredNotified = false
  }

  if (input.acAction === 'blocked-low-soc') {
    if (!prev.blockedNotified) {
      state.blockedNotified = true
      alerts.push({ kind: 'ac-blocked-low-soc', color: 'danger', title: 'AC не увімкнено: низький заряд',
        message: `${soc} Це нижче мінімуму автоматизації ${input.minSoc}%.` })
    }
  } else if (!RISK_REQUIRES_AC.includes(input.risk)) {
    state.blockedNotified = false
  }

  const outage = input.currentEvent ?? (input.risk === 'imminent' ? input.nextEvent : undefined)
  const depletion = input.forecast?.depletionAt
  if (outage && depletion && new Date(depletion) < new Date(outage.end) && outage.start !== prev.lowReserveEventStart) {
    state.lowReserveEventStart = outage.start
    alerts.push({ kind: 'low-reserve', color: 'danger', title: 'Заряду може не вистачити',
      message: `За профілем споживання резерв закінчиться о ${formatKyivTime(depletion)}, а вікно триває до ${formatKyivTime(outage.end)}. ${soc}` })
  }

  return { alerts, state }
}
