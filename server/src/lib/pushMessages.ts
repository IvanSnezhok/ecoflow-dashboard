// Texts of the phone app's push notifications, in the language the phone registered with.
export type PushLanguage = "uk" | "en";

export type PushEvent =
  | { kind: "gridOff"; name: string; soc: number; reserveHours: number | null }
  | { kind: "gridOn"; name: string; outageMinutes: number | null }
  | { kind: "lowBattery"; name: string; soc: number }
  | { kind: "offline"; name: string }
  | { kind: "online"; name: string }
  | { kind: "test" };

function span(minutes: number, language: PushLanguage): string {
  const total = Math.max(0, Math.round(minutes));
  const hours = Math.floor(total / 60);
  const rest = total % 60;
  const [h, m] = language === "uk" ? ["год", "хв"] : ["h", "min"];
  if (hours === 0) return `${rest} ${m}`;
  return rest === 0 ? `${hours} ${h}` : `${hours} ${h} ${rest} ${m}`;
}

export function pushText(event: PushEvent, language: PushLanguage): { title: string; body: string } {
  const uk = language === "uk";
  switch (event.kind) {
    case "gridOff": {
      const reserve = event.reserveHours === null ? "" : uk
        ? ` Вистачить приблизно на ${span(event.reserveHours * 60, language)}.`
        : ` It lasts about ${span(event.reserveHours * 60, language)}.`;
      return uk
        ? { title: "Світла немає", body: `${event.name} працює від батареї, заряд ${event.soc}%.${reserve}` }
        : { title: "Power is out", body: `${event.name} runs on battery, ${event.soc}% left.${reserve}` };
    }
    case "gridOn": {
      const lasted = event.outageMinutes === null ? "" : uk
        ? `Відключення тривало ${span(event.outageMinutes, language)}.`
        : `The outage lasted ${span(event.outageMinutes, language)}.`;
      return uk
        ? { title: "Світло з’явилось", body: lasted || event.name }
        : { title: "Power is back", body: lasted || event.name };
    }
    case "lowBattery":
      return uk
        ? { title: `Низький заряд: ${event.soc}%`, body: event.name }
        : { title: `Battery low: ${event.soc}%`, body: event.name };
    case "offline":
      return uk
        ? { title: "Станція офлайн", body: `${event.name} не на зв’язку понад 5 хвилин.` }
        : { title: "Station offline", body: `${event.name} has been unreachable for over 5 minutes.` };
    case "online":
      return uk
        ? { title: "Станція знову на зв’язку", body: event.name }
        : { title: "Station back online", body: event.name };
    case "test":
      return uk
        ? { title: "Сповіщення працюють", body: "Так виглядатимуть повідомлення від панелі." }
        : { title: "Notifications work", body: "This is how messages from the panel will look." };
  }
}

export interface PushPrefs {
  grid: boolean;
  lowBattery: boolean;
  offline: boolean;
  /** Battery level, in percent, at or below which "battery low" is sent */
  threshold: number;
}

export const DEFAULT_PUSH_PREFS: PushPrefs = { grid: true, lowBattery: true, offline: true, threshold: 20 };

/** Level a battery must climb back to before "battery low" can be sent again */
export const LOW_BATTERY_REARM = 5;

/**
 * Whether a reading sends "battery low": once when the level reaches the threshold,
 * and again only after it has recovered by LOW_BATTERY_REARM. `armed` undefined is the
 * first reading since the server started: a battery already low then stays silent.
 */
export function lowBatteryStep(soc: number, threshold: number, armed: boolean | undefined): { notify: boolean; armed: boolean } {
  if (armed === undefined) return { notify: false, armed: soc > threshold };
  if (armed && soc <= threshold) return { notify: true, armed: false };
  if (!armed && soc >= threshold + LOW_BATTERY_REARM) return { notify: false, armed: true };
  return { notify: false, armed };
}

export const isExpoPushToken = (token: unknown): token is string =>
  typeof token === "string" && /^Expo(nent)?PushToken\[[A-Za-z0-9_-]{10,200}\]$/.test(token);
