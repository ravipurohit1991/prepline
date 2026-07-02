/** Parse an ISO string from the API (always UTC with a Z suffix). */
export function parseIso(value: string): Date {
  return new Date(value);
}

export function minutesBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

/** Local wall-clock time, e.g. "18:45". */
export function fmtClock(date: Date): string {
  return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
}

/** Compact duration, e.g. "1 h 25 min" or "40 min". */
export function fmtDuration(totalMinutes: number): string {
  const minutes = Math.max(0, Math.round(totalMinutes));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours === 0) return `${rest} min`;
  if (rest === 0) return `${hours} h`;
  return `${hours} h ${rest} min`;
}

/** Countdown text, e.g. "12:05" (mm:ss) for short spans, "1 h 25 min" beyond. */
export function fmtCountdown(seconds: number): string {
  const clamped = Math.max(0, Math.round(seconds));
  if (clamped >= 2 * 3600) return fmtDuration(clamped / 60);
  const minutes = Math.floor(clamped / 60);
  const rest = clamped % 60;
  return `${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
}

/** Value for <input type="datetime-local"> in the user's local time. */
export function toLocalInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}` +
    `T${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}

/** Read a datetime-local input back into an ISO string (UTC). */
export function fromLocalInputValue(value: string): string {
  return new Date(value).toISOString();
}
