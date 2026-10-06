// Pure decision logic for the outage automation: when to switch AC and which
// Slack alerts to raise. Kept free of DB/API imports so it can be tested alone.
import type { OutageEvent, ResilienceStatus, RuntimeForecast } from '../types/resilience.js'

export type Risk = ResilienceStatus['risk']
export type AcAction = NonNullable<ResilienceStatus['acAction']>

const AC_COMMAND_COOLDOWN_MS = 60_000
const RISK_REQUIRES_AC: Risk[] = ['imminent', 'active', 'emergency']
const OUTAGE_RISKS: Risk[] = ['active', 'emergency']

export interface AcDecisionInput {
  autoAc: boolean
  risk: Risk
  soc: number
  minSoc: number
  acEnabled: boolean
  automationOwnsAc: boolean
  recoveryDelayMinutes: number
  lastRiskAt: number
  lastAcCommandAt: number
  nowMs: number
}

export interface AcDecision {
  action: Exclude<AcAction, 'failed'>
  lastRiskAt: number
}

export function decideAcAction(input: AcDecisionInput): AcDecision {
  if (!input.autoAc || input.risk === 'stale') return { action: 'none', lastRiskAt: input.lastRiskAt }

  const riskRequiresAc = RISK_REQUIRES_AC.includes(input.risk)
  const lastRiskAt = riskRequiresAc ? input.nowMs : input.lastRiskAt
  const inRecoveryDelay = input.automationOwnsAc && input.nowMs - lastRiskAt < input.recoveryDelayMinutes * 60_000
  const shouldBeOn = riskRequiresAc || inRecoveryDelay

  if (input.nowMs - input.lastAcCommandAt < AC_COMMAND_COOLDOWN_MS) return { action: 'none', lastRiskAt }
  if (shouldBeOn && input.soc < input.minSoc) return { action: 'blocked-low-soc', lastRiskAt }
  if (shouldBeOn && !input.acEnabled) return { action: 'on', lastRiskAt }
  if (!shouldBeOn && input.acEnabled && input.automationOwnsAc) return { action: 'off', lastRiskAt }
  return { action: 'none', lastRiskAt }
}

export type AlertKind =
  | 'outage-warning' | 'outage-started' | 'emergency' | 'outage-ended'
  | 'schedule-stale' | 'schedule-restored'
  | 'ac-on' | 'ac-off' | 'ac-failed' | 'ac-blocked-low-soc' | 'low-reserve'

export interface ResilienceAlert {
  kind: AlertKind
  title: string
  message: string
  color: 'good' | 'warning' | 'danger'
}

export interface AlertState {
  risk?: Risk
  warnedEventStart?: string
  lowReserveEventStart?: string
  blockedNotified: boolean
}

export const initialAlertState: AlertState = { blockedNotified: false }

export interface AlertInput {
  risk: Risk
  currentEvent?: OutageEvent
  nextEvent?: OutageEvent
  forecast?: RuntimeForecast
  acAction: AcAction
  soc: number
  minSoc: number
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

function runtimeText(forecast?: RuntimeForecast): string {
  if (!forecast) return ''
  if (forecast.hoursRemaining === null) return ' Запасу вистачить більш ніж на 14 діб.'
  return ` Запасу до резервного SOC: ~${forecast.hoursRemaining} год.`
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

  if (input.acAction === 'on') {
    alerts.push({ kind: 'ac-on', color: 'good', title: 'AC увімкнено автоматично', message: `Підготовка до відключення. ${soc}` })
  } else if (input.acAction === 'off') {
    alerts.push({ kind: 'ac-off', color: 'good', title: 'AC вимкнено автоматично', message: `Ризик відключення минув. ${soc}` })
  } else if (input.acAction === 'failed') {
    alerts.push({ kind: 'ac-failed', color: 'danger', title: 'Не вдалося перемкнути AC',
      message: 'Команда EcoFlow не пройшла, автоматизація повторить спробу. Перевірте пристрій.' })
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
