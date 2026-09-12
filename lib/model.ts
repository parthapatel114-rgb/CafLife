export const HOUR = 3600000;
export type Profile = {
  units: "metric" | "imperial";
  age: number | null;
  height: number | null;
  weight: number | null;
  timezone: string;
  bedtime: string;
  peakTime: string;
  dailyMax: number | null;
  activeMin: number | null;
  activeMax: number | null;
  bedtimeMax: number | null;
  halfLife: number;
  modelVersion: number;
  onboarded: boolean;
  theme: "system" | "light" | "dark";
};
export type DrinkCategory = "Coffee" | "Tea" | "Energy drink" | "Soda" | "Other";
export type Caffeine = {
  name: string;
  perServing: number;
  quantity: number;
  serving: string;
  at: string;
  preset?: string;
  category?: DrinkCategory;
};
export type Energy = { rating: number; note: string; at: string };
export type Favorite = {
  name: string;
  perServing: number;
  serving: string;
  category?: DrinkCategory;
};
export type Kind = "profile" | "caffeine" | "energy" | "favorite";
export type RecordRow = {
  id: string;
  kind: Kind;
  data: Profile | Caffeine | Energy | Favorite;
  revision: number;
  deleted: boolean;
};
export type Mutation = { id: string; record: RecordRow; expected: number };
export type State = {
  records: RecordRow[];
  pending: Mutation[];
  cursor: number;
};
export const defaults = (): Profile => ({
  units: "metric",
  age: null,
  height: null,
  weight: null,
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  bedtime: "23:00",
  peakTime: "10:00",
  dailyMax: null,
  activeMin: null,
  activeMax: null,
  bedtimeMax: null,
  halfLife: 5,
  modelVersion: 1,
  onboarded: false,
  theme: "light",
});
export function doseAt(dose: number, elapsedHours: number, halfLife = 5) {
  if (elapsedHours <= 0) return 0;
  const ke = Math.LN2 / halfLife,
    ka = 4;
  /* Normalize the delayed absorption curve so a dose's modeled peak represents its full labeled amount. */ return (
    ((dose * 1.12 * ka) / (ka - ke)) * (Math.exp(-ke * elapsedHours) - Math.exp(-ka * elapsedHours))
  );
}
export function amountAt(entries: Caffeine[], time: number, halfLife = 5) {
  return entries.reduce(
    (n, e) => n + doseAt(e.perServing * e.quantity, (time - Date.parse(e.at)) / HOUR, halfLife),
    0,
  );
}
// Reuse formatters: constructing one for every timeline minute is expensive.
const formatters = new Map<string, Intl.DateTimeFormat>();
function formatter(zone: string, kind: "day" | "clock" | "display") {
  const key = `${kind}:${zone}`;
  let value = formatters.get(key);
  if (!value) {
    const options: Intl.DateTimeFormatOptions =
      kind === "day"
        ? { year: "numeric", month: "2-digit", day: "2-digit" }
        : kind === "clock"
          ? { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }
          : { hour: "numeric", minute: "2-digit" };
    value = new Intl.DateTimeFormat(kind === "display" ? "en-US" : "en-GB", {
      ...options,
      timeZone: zone,
    });
    // Bound the cache even when many imported profiles use different zones.
    if (formatters.size >= 64) formatters.delete(formatters.keys().next().value!);
    formatters.set(key, value);
  }
  return value;
}
export function dayKey(time: number, zone: string) {
  const parts = formatter(zone, "day").formatToParts(time);
  return ["year", "month", "day"]
    .map((kind) => parts.find((part) => part.type === kind)?.value)
    .join("-");
}
export function clockAt(time: number, zone: string) {
  return formatter(zone, "clock").format(time);
}
export function dailyTotals(entries: Caffeine[], zone: string) {
  const totals = new Map<string, number>();
  for (const entry of entries) {
    const day = dayKey(Date.parse(entry.at), zone);
    totals.set(day, (totals.get(day) ?? 0) + entry.perServing * entry.quantity);
  }
  return totals;
}
export function nextClock(now: number, clock: string, zone: string) {
  const start = Math.floor(now / 60000) * 60000;
  for (let i = 1; i <= 60 * 49; i++) {
    const t = start + i * 60000;
    if (clockAt(t, zone) === clock) return t;
  }
  return now + 24 * HOUR;
}
export function consumed(entries: Caffeine[], time: number, zone: string) {
  const day = dayKey(time, zone);
  return entries.reduce(
    (total, entry) =>
      dayKey(Date.parse(entry.at), zone) === day
        ? total + entry.perServing * entry.quantity
        : total,
    0,
  );
}
export function belowTime(
  entries: Caffeine[],
  now: number,
  target: number | null,
  halfLife: number,
): number | null {
  if (target === null || target === 0) return null;
  let lastAbove = -1;
  const step = 300000;
  for (let i = 0; i <= 864; i++)
    if (amountAt(entries, now + i * step, halfLife) > target) lastAbove = i;
  if (lastAbove === 864) return null;
  return now + (lastAbove + 1) * step;
}
export function formatTime(t: number, zone: string) {
  return formatter(zone, "display").format(Math.round(t / 300000) * 300000);
}
export function localInput(t: number) {
  const d = new Date(t);
  return new Date(t - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function validate(kind: Kind, data: any) {
  const finite = (v: any) => typeof v === "number" && Number.isFinite(v);
  const optional = (v: any) => v === null || (finite(v) && v >= 0 && v <= 100000);
  if (!data || typeof data !== "object") return false;
  if (kind === "profile") {
    try {
      new Intl.DateTimeFormat("en", { timeZone: data.timezone });
    } catch {
      return false;
    }
    return (
      data.modelVersion === 1 &&
      typeof data.onboarded === "boolean" &&
      ["metric", "imperial"].includes(data.units) &&
      ["system", "light", "dark"].includes(data.theme) &&
      ["age", "height", "weight", "dailyMax", "activeMin", "activeMax", "bedtimeMax"].every((k) =>
        optional(data[k]),
      ) &&
      finite(data.halfLife) &&
      data.halfLife >= 1 &&
      data.halfLife <= 24 &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(data.bedtime) &&
      /^([01]\d|2[0-3]):[0-5]\d$/.test(data.peakTime) &&
      (data.activeMin === null || data.activeMax === null || data.activeMin <= data.activeMax)
    );
  }
  if (kind === "energy")
    return (
      Number.isInteger(data.rating) &&
      data.rating >= 1 &&
      data.rating <= 5 &&
      typeof data.note === "string" &&
      data.note.length <= 1000 &&
      Number.isFinite(Date.parse(data.at))
    );
  if (kind === "caffeine" || kind === "favorite")
    return (
      typeof data.name === "string" &&
      data.name.trim().length > 0 &&
      data.name.length <= 120 &&
      finite(data.perServing) &&
      data.perServing >= 0 &&
      data.perServing <= 10000 &&
      typeof data.serving === "string" &&
      data.serving.length <= 120 &&
      (kind === "favorite" ||
        (finite(data.quantity) &&
          data.quantity > 0 &&
          data.quantity <= 100 &&
          Number.isFinite(Date.parse(data.at))))
    );
  return false;
}
export const presets: (Favorite & {
  id: string;
  category: DrinkCategory;
  source: string;
})[] = [
  {
    id: "coffee",
    name: "Brewed coffee",
    perServing: 96,
    serving: "8 fl oz / 237 mL",
    category: "Coffee",
    source:
      "https://www.mayoclinic.org/healthy-lifestyle/nutrition-and-healthy-eating/in-depth/caffeine/art-20049372",
  },
  {
    id: "espresso",
    name: "Espresso",
    perServing: 63,
    serving: "1 shot / 30 mL",
    category: "Coffee",
    source:
      "https://www.mayoclinic.org/healthy-lifestyle/nutrition-and-healthy-eating/in-depth/caffeine/art-20049372",
  },
  {
    id: "tea",
    name: "Black tea",
    perServing: 48,
    serving: "8 fl oz / 237 mL",
    category: "Tea",
    source:
      "https://www.mayoclinic.org/healthy-lifestyle/nutrition-and-healthy-eating/in-depth/caffeine/art-20049372",
  },
  {
    id: "green",
    name: "Green tea",
    perServing: 29,
    serving: "8 fl oz / 237 mL",
    category: "Tea",
    source:
      "https://www.mayoclinic.org/healthy-lifestyle/nutrition-and-healthy-eating/in-depth/caffeine/art-20049372",
  },
  {
    id: "redbull",
    name: "Red Bull",
    perServing: 80,
    serving: "8.4 fl oz / 250 mL",
    category: "Energy drink",
    source:
      "https://www.redbull.com/us-en/energydrink/questions/how-much-caffeine-is-in-a-can-of-red-bull-energy-drink",
  },
  {
    id: "cola",
    name: "Coca-Cola",
    perServing: 34,
    serving: "12 fl oz / 355 mL",
    category: "Soda",
    source: "https://www.coca-cola.com/us/en/about-us/faq/what-is-caffeine",
  },
  {
    id: "custom",
    name: "Custom drink / supplement",
    perServing: 0,
    serving: "Enter label serving",
    category: "Other",
    source: "",
  },
];
