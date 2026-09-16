/**
 * Square returns `start_at` without milliseconds ("2026-09-17T14:00:00Z") while
 * `Date#toISOString()` always emits them ("2026-09-17T14:00:00.000Z"), so a raw
 * string comparison between the two never matches. Compare parsed instants instead.
 */
export function sameSquareInstant(left: string | undefined, right: string | undefined) {
  if (!left || !right) return false;
  const leftTime = new Date(left).getTime();
  const rightTime = new Date(right).getTime();
  return Number.isFinite(leftTime) && Number.isFinite(rightTime) && leftTime === rightTime;
}
