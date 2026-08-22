export type WaitlistTimePreference = "anytime" | "morning" | "afternoon";

export function addCalendarDays(day: string, amount: number) {
  const [year, month, date] = day.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, date + amount)).toISOString().slice(0, 10);
}

export function waitlistDates(from: string, to: string, maximum = 15) {
  const dates: string[] = [];
  for (let day = from; day <= to && dates.length < maximum; day = addCalendarDays(day, 1)) dates.push(day);
  return dates;
}

export function matchesWaitlistTime(value: string, preference: string, timezone: string) {
  const hourPart = new Intl.DateTimeFormat("en-CA", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).formatToParts(new Date(value)).find((part) => part.type === "hour")?.value;
  const hour = Number(hourPart || 0);
  return preference === "anytime" || (preference === "morning" ? hour < 12 : preference === "afternoon" && hour >= 12);
}

export function validWaitlistWindow(from: string, to: string, today: string, lastBookable: string) {
  return from >= today && from <= lastBookable && to >= from && to <= lastBookable && to <= addCalendarDays(from, 14);
}
