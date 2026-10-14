// Outage schedules, the load profile and the power timeline are all defined in
// Kyiv wall-clock time, independent of the server's TZ setting.
const TIME_ZONE = 'Europe/Kyiv'

const partsFormatter = new Intl.DateTimeFormat('en-CA', {
  timeZone: TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
})

function kyivParts(date: Date): Record<string, number> {
  return Object.fromEntries(partsFormatter.formatToParts(date)
    .filter(part => part.type !== 'literal')
    .map(part => [part.type, Number(part.value)]))
}

/** Minute of the Kyiv day (0..1439) for an instant. */
export function kyivMinuteOfDay(date: Date): number {
  const parts = kyivParts(date)
  return parts.hour * 60 + parts.minute
}

/** Kyiv calendar date of an instant as YYYY-MM-DD. */
export function kyivDateKey(date: Date): string {
  const parts = kyivParts(date)
  return `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`
}

/** Monday-based weekday (0 = Monday) of the Kyiv calendar date of an instant. */
export function kyivWeekday(date: Date): number {
  const [year, month, day] = kyivDateKey(date).split('-').map(Number)
  return (new Date(Date.UTC(year, month - 1, day)).getUTCDay() + 6) % 7
}

/** Adds whole calendar days to a YYYY-MM-DD key. */
export function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10)
}

/**
 * The instant a Kyiv wall-clock time occurs. `minuteOfDay` may be 1440 for the
 * end of the day, so a DST day spans 23 or 25 hours as it should.
 */
export function kyivDateAtMinutes(dateValue: string, minuteOfDay: number): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateValue)
  if (!match) return null
  const [, year, month, day] = match.map(Number)
  const utcGuess = Date.UTC(year, month - 1, day, 0, minuteOfDay)
  const values = kyivParts(new Date(utcGuess))
  const representedAsUtc = Date.UTC(values.year, values.month - 1, values.day, values.hour, values.minute, values.second)
  return new Date(utcGuess - (representedAsUtc - utcGuess))
}
