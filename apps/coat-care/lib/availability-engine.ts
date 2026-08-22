import { weekdayForDateKey, zonedDateTimeToUtc } from "./time-zone.ts";

export const SLOT_MINUTES = 15;
export type ResourceKind = "pet_capacity" | "bath" | "table" | "dryer" | "kennel";
export type ServiceProfile = { id: string; durationMinutes: number; bufferMinutes: number; bathMinutes: number; dryerMinutes: number; groomingTableMinutes: number; kennelMinutes: number };
export type ExistingAppointment = { id: string; staffId: string | null; startsAt: string; endsAt: string; status: string; bathMinutes: number; dryerMinutes: number; groomingTableMinutes: number; kennelMinutes: number };
export type StaffCandidate = { id: string; name: string; weekday: number; startTime: string; endTime: string };
export type DayHours = { weekday: number; open: boolean; opensAt: string; closesAt: string };
export type Capacity = { pet_capacity: number; bath: number; table: number; dryer: number; kennel: number };
export type AvailableSlot = { startsAt: string; endsAt: string; date: string; timeLabel: string; staff: Array<{ id: string; name: string }>; remainingCapacity: number };

function minutes(value: string) { const [hour, minute] = value.split(":").map(Number); return hour * 60 + minute; }
function time(minutesFromMidnight: number) { return `${String(Math.floor(minutesFromMidnight / 60)).padStart(2, "0")}:${String(minutesFromMidnight % 60).padStart(2, "0")}`; }
function overlaps(startA: number, endA: number, startB: number, endB: number) { return startA < endB && endA > startB; }

export function segmentStarts(start: Date, end: Date) {
  const result: string[] = [];
  for (let cursor = start.getTime(); cursor < end.getTime(); cursor += SLOT_MINUTES * 60_000) result.push(new Date(cursor).toISOString());
  return result;
}

export function resourceWindows(startsAt: string, profile: Pick<ServiceProfile, "bathMinutes" | "dryerMinutes" | "groomingTableMinutes" | "kennelMinutes">) {
  let cursor = new Date(startsAt).getTime();
  const result: Partial<Record<ResourceKind, { start: Date; end: Date }>> = {};
  for (const [kind, length] of [["bath", profile.bathMinutes], ["dryer", profile.dryerMinutes], ["table", profile.groomingTableMinutes], ["kennel", profile.kennelMinutes]] as const) {
    if (length > 0) result[kind] = { start: new Date(cursor), end: new Date(cursor + length * 60_000) };
    cursor += length * 60_000;
  }
  return result;
}

export function segmentsForAppointment(startsAt: string, endsAt: string, profile: Pick<ServiceProfile, "bathMinutes" | "dryerMinutes" | "groomingTableMinutes" | "kennelMinutes">) {
  const result: Record<ResourceKind, string[]> = { pet_capacity: segmentStarts(new Date(startsAt), new Date(endsAt)), bath: [], table: [], dryer: [], kennel: [] };
  const windows = resourceWindows(startsAt, profile);
  for (const kind of ["bath", "table", "dryer", "kennel"] as const) if (windows[kind]) result[kind] = segmentStarts(windows[kind]!.start, windows[kind]!.end);
  return result;
}

export function appointmentUsesSegment(appointment: ExistingAppointment, kind: ResourceKind, segment: string) {
  const segmentStart = new Date(segment).getTime(), segmentEnd = segmentStart + SLOT_MINUTES * 60_000;
  if (kind === "pet_capacity") return overlaps(new Date(appointment.startsAt).getTime(), new Date(appointment.endsAt).getTime(), segmentStart, segmentEnd);
  const window = resourceWindows(appointment.startsAt, appointment)[kind];
  return Boolean(window && overlaps(window.start.getTime(), window.end.getTime(), segmentStart, segmentEnd));
}

export function generateAvailability(input: { dates: string[]; timezone: string; now: Date; minimumLeadMinutes: number; bookingWindowDays: number; service: ServiceProfile; hours: DayHours[]; staff: StaffCandidate[]; appointments: ExistingAppointment[]; capacity: Capacity }) {
  const active = input.appointments.filter((item) => !["cancelled", "no_show"].includes(item.status));
  const minStart = input.now.getTime() + input.minimumLeadMinutes * 60_000;
  const maxStart = input.now.getTime() + input.bookingWindowDays * 86400000;
  const slots = new Map<string, AvailableSlot>();
  for (const date of input.dates) {
    const weekday = weekdayForDateKey(date); const day = input.hours.find((item) => item.weekday === weekday);
    if (!day?.open) continue;
    for (const person of input.staff.filter((item) => item.weekday === weekday)) {
      const localStart = Math.max(minutes(day.opensAt), minutes(person.startTime));
      const localEnd = Math.min(minutes(day.closesAt), minutes(person.endTime));
      for (let localMinute = Math.ceil(localStart / SLOT_MINUTES) * SLOT_MINUTES; localMinute < localEnd; localMinute += SLOT_MINUTES) {
        const start = zonedDateTimeToUtc(date, time(localMinute), input.timezone); const end = new Date(start.getTime() + (input.service.durationMinutes + input.service.bufferMinutes) * 60_000);
        if (start.getTime() < minStart || start.getTime() > maxStart || end > zonedDateTimeToUtc(date, time(localEnd), input.timezone)) continue;
        if (active.some((item) => item.staffId === person.id && overlaps(new Date(item.startsAt).getTime(), new Date(item.endsAt).getTime(), start.getTime(), end.getTime()))) continue;
        const candidateSegments = segmentsForAppointment(start.toISOString(), end.toISOString(), input.service);
        let valid = true; let remainingCapacity = input.capacity.pet_capacity;
        for (const kind of ["pet_capacity", "bath", "table", "dryer", "kennel"] as const) {
          if (candidateSegments[kind].length && input.capacity[kind] <= 0) { valid = false; break; }
          for (const segment of candidateSegments[kind]) {
            const used = active.filter((item) => appointmentUsesSegment(item, kind, segment)).length;
            if (used >= input.capacity[kind]) { valid = false; break; }
            if (kind === "pet_capacity") remainingCapacity = Math.min(remainingCapacity, input.capacity[kind] - used);
          }
          if (!valid) break;
        }
        if (!valid) continue;
        const key = start.toISOString(); const existing = slots.get(key);
        if (existing) existing.staff.push({ id: person.id, name: person.name });
        else slots.set(key, { startsAt: key, endsAt: end.toISOString(), date, timeLabel: new Intl.DateTimeFormat("en-CA", { timeZone: input.timezone, hour: "numeric", minute: "2-digit" }).format(start), staff: [{ id: person.id, name: person.name }], remainingCapacity });
      }
    }
  }
  return [...slots.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}
