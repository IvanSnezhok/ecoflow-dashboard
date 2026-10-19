import { useState, type ReactNode } from 'react'
import { Loader2, Stethoscope } from 'lucide-react'
import { api } from '@/services/api'
import { cn } from '@/lib/utils'
import { Row } from '@/components/devices/DeviceInfoCard'
import type { DataAccessReport, DeviceProbe, ProbeGet, ProbeRead, ProbeTopic, ProbeVerdict } from '@/types/device'

const Good = ({ children }: { children: ReactNode }) => <span className="text-energy-green">{children}</span>
const Warn = ({ children }: { children: ReactNode }) => <span className="text-energy-yellow">{children}</span>
const Bad = ({ children }: { children: ReactNode }) => <span className="text-energy-red">{children}</span>

function readValue(read: ProbeRead): ReactNode {
  if (!read.ok) return <Bad>{read.code ? `code ${read.code}: ` : ''}{read.message ?? 'failed'}</Bad>
  const soc = read.sample?.['pd.soc'] ?? read.sample?.['bmsMaster.soc']
  return (
    <Good>
      OK · {read.fieldCount} fields{typeof soc === 'number' ? ` · SOC ${soc}%` : ''}
    </Good>
  )
}

function topicValue(topic: ProbeTopic | undefined): ReactNode {
  if (!topic) return <Bad>not connected</Bad>
  if (!topic.subscribed) return <span className="text-energy-red" title={topic.error}>refused</span>
  if (topic.messages === 0) return <Warn>subscribed · no messages</Warn>
  return (
    <Good>
      {topic.messages} {topic.messages === 1 ? 'message' : 'messages'}
      {topic.maxFields > 0 && ` · up to ${topic.maxFields} fields`}
    </Good>
  )
}

/** A full-quota request (answered on get_reply): replies, a refusal, or silence */
function getValue(get: ProbeGet): ReactNode {
  if (get.fieldCount > 0) return <Good>{get.replies} {get.replies === 1 ? 'reply' : 'replies'} · {get.fieldCount} fields</Good>
  if (get.replies > 0) return <Bad>{get.code ? `code ${get.code}: ` : ''}{get.message ?? 'reply without data'}</Bad>
  return <Warn>no reply ({get.sent} sent)</Warn>
}

function ProbeColumn({ probe, role, listenSeconds }: { probe: DeviceProbe; role: string; listenSeconds: number }) {
  return (
    <section>
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1 truncate">
        {probe.name ?? probe.serialNumber} <span className="font-normal normal-case">· {role}</span>
      </h3>
      <div className="divide-y divide-border/50">
        <Row
          label="Device list"
          mono={false}
          value={
            !probe.inList ? <Bad>not listed</Bad>
              : probe.cloudOnline ? <Good>listed · online</Good>
                : <Warn>listed · offline</Warn>
          }
        />
        <Row label="Full quota" mono={false} value={readValue(probe.quotaAll)} />
        <Row label="Named fields" mono={false} value={readValue(probe.quotaFields)} />
        <Row label={`MQTT quota · ${listenSeconds} s`} mono={false} value={topicValue(probe.mqtt?.quota)} />
        {probe.mqtt && probe.mqtt.quota.keys.length > 0 && (
          <p className="py-1.5 text-[10px] font-mono leading-snug text-muted-foreground/70 break-words">
            {probe.mqtt.quota.keys.join(', ')}
          </p>
        )}
        <Row label="MQTT status" mono={false} value={topicValue(probe.mqtt?.status)} />
        <Row label="MQTT get_reply" mono={false} value={topicValue(probe.mqtt?.getReply)} />
        {probe.mqtt?.gets.map((get) => (
          <Row key={get.variant} label={`get: ${get.variant}`} mono={false} value={getValue(get)} />
        ))}
        {probe.mqtt && Object.keys(probe.mqtt.otherTopics).length > 0 && (
          <Row
            label="Other topics"
            value={Object.entries(probe.mqtt.otherTopics).map(([suffix, count]) => `${suffix}: ${count}`).join(', ')}
          />
        )}
      </div>
    </section>
  )
}

const VERDICTS: Record<ProbeVerdict, { tone: 'good' | 'warn' | 'bad'; text: (report: DataAccessReport) => string }> = {
  'data-available': {
    tone: 'good',
    text: () => "EcoFlow serves this device's data over REST, so the panel can read it.",
  },
  'mqtt-only': {
    tone: 'warn',
    text: ({ target }) => {
      const answered = target.mqtt?.gets.find((get) => get.fieldCount > 0)
      return (
        "EcoFlow refuses the REST reads but pushes this device's data over MQTT, so the panel reads it from there. " +
        (answered
          ? `The full-quota request "${answered.variant}" answers too, so AC power and extra batteries come through.`
          : 'No full-quota request got an answer, so only the pushed part is available (SOC, battery power, USB ports, limits).')
      )
    },
  },
  refused: {
    tone: 'bad',
    text: ({ target, comparison }) =>
      `EcoFlow lists this device but refuses its data on every channel` +
      `${target.quotaAll.code ? ` (code ${target.quotaAll.code})` : ''}` +
      `${comparison ? `, while your keys work for ${comparison.name ?? comparison.serialNumber}` : ''}. ` +
      "This is how a device shared from another account behaves: try its owner's developer keys, " +
      'or bind the device to this account.',
  },
  'keys-failing': {
    tone: 'bad',
    text: () => 'The comparison device got no data either, so the keys or the EcoFlow cloud are failing, not this device.',
  },
  offline: {
    tone: 'warn',
    text: () => 'The EcoFlow cloud has this device offline, so there is nothing to read. Run the check while it is online.',
  },
  'not-listed': {
    tone: 'bad',
    text: () => 'This device is not in the EcoFlow device list for these keys.',
  },
}

export function DataAccessCheck({ serialNumber }: { serialNumber: string }) {
  const [running, setRunning] = useState(false)
  const [report, setReport] = useState<DataAccessReport | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      setReport((await api.probeDataAccess(serialNumber)).data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Check failed')
    } finally {
      setRunning(false)
    }
  }

  const verdict = report ? VERDICTS[report.verdict] : null

  return (
    <div className="rounded-sm border bg-card overflow-hidden">
      <div className="px-4 py-3 border-b bg-muted/30 flex items-center gap-2">
        <Stethoscope className="w-4 h-4 text-primary" />
        <span className="text-xs font-semibold uppercase tracking-wider">Data access check</span>
        {report && !running && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            as of {new Date(report.checkedAt).toLocaleString()}
          </span>
        )}
      </div>

      <div className="p-4 space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={running}
            onClick={() => void run()}
            className="inline-flex items-center gap-1.5 px-2 py-1 rounded-sm border text-[11px] font-medium hover:bg-muted disabled:opacity-50"
          >
            {running && <Loader2 className="w-3 h-3 animate-spin" />}
            {running ? 'Checking… about a minute' : report ? 'Run again' : 'Run check'}
          </button>
          {/* The quota as the panel reads it plus recent raw MQTT messages, for troubleshooting */}
          <a
            href={`/api/devices/${serialNumber}/raw`}
            download
            className="px-2 py-1 rounded-sm border text-[11px] font-medium hover:bg-muted"
          >
            Download raw data
          </a>
          <p className="flex-1 min-w-[16rem] text-[10px] leading-snug text-muted-foreground/70">
            Asks the EcoFlow Open API for this device's data on every channel it offers (full quota, named fields,
            MQTT), next to a working device for comparison. Read-only: it sends no commands.
          </p>
        </div>

        {error && <p className="text-xs text-energy-red">{error}</p>}

        {report && verdict && (
          <>
            <p
              className={cn(
                'rounded-sm border px-3 py-2 text-xs leading-snug',
                verdict.tone === 'good' && 'border-energy-green/40 bg-energy-green/5',
                verdict.tone === 'warn' && 'border-energy-yellow/40 bg-energy-yellow/5',
                verdict.tone === 'bad' && 'border-energy-red/40 bg-energy-red/5',
              )}
            >
              {verdict.text(report)}
            </p>
            {report.mqttError && <p className="text-xs text-energy-red">MQTT: {report.mqttError}</p>}
            <div className="grid gap-x-8 gap-y-4 md:grid-cols-2">
              <ProbeColumn probe={report.target} role="this device" listenSeconds={report.listenSeconds} />
              {report.comparison ? (
                <ProbeColumn probe={report.comparison} role="comparison" listenSeconds={report.listenSeconds} />
              ) : (
                <p className="text-[10px] text-muted-foreground/70">
                  No other online, supported device to compare against.
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
