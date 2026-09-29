const DAY_MS = 86_400_000;

// Square's ListBookings rejects a start_at range longer than 31 days, so the
// reconciliation window is read in consecutive 30-day slices. Upcoming
// appointments come first, then the past: a run stopped by the function time
// limit has still refreshed what matters most, and the next hourly run
// continues. Adjacent slices share their boundary instant; a booking returned
// twice is simply reported unchanged the second time.
export function squareBookingRanges(now: Date, daysBack = 30, daysAhead = 180, sliceDays = 30) {
  const ranges: Array<{ startAtMin: string; startAtMax: string }> = [];
  const slice = (from: number, to: number) => {
    for (let start = from; start < to; start += sliceDays * DAY_MS) {
      ranges.push({
        startAtMin: new Date(start).toISOString(),
        startAtMax: new Date(Math.min(start + sliceDays * DAY_MS, to)).toISOString(),
      });
    }
  };
  slice(now.getTime(), now.getTime() + daysAhead * DAY_MS);
  slice(now.getTime() - daysBack * DAY_MS, now.getTime());
  return ranges;
}
