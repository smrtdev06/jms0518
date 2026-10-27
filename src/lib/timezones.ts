export const TIMEZONES = [
  "America/New_York",
  "America/Chicago",
  "America/Denver",
  "America/Phoenix",
  "America/Los_Angeles",
  "America/Anchorage",
  "Pacific/Honolulu",
  "America/Toronto",
  "America/Vancouver",
  "America/Sao_Paulo",
  "UTC",
  "Europe/London",
  "Europe/Berlin",
  "Europe/Bucharest",
  "Asia/Dubai",
  "Asia/Kolkata",
  "Asia/Singapore",
  "Asia/Tokyo",
  "Australia/Sydney",
] as const;

/** Offset of `timeZone` from UTC, in minutes, at `instant`. */
function offsetMinutes(timeZone: string, instant: Date): number {
  const name =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" })
      .formatToParts(instant)
      .find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const match = name.match(/GMT([+-])(\d{2}):?(\d{2})?/);
  if (!match) return 0;
  const minutes = Number(match[2]) * 60 + Number(match[3] ?? 0);
  return match[1] === "-" ? -minutes : minutes;
}

/** Converts a wall-clock date + time in `timeZone` to a real instant. */
export function zonedToUtc(date: string, time: string, timeZone: string): Date | null {
  if (!date) return null;
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm, ss] = (time || "00:00:00").split(":").map(Number);
  if (!y || !m || !d) return null;
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0, ss || 0);
  // Two passes handle the hour around DST transitions.
  let instant = guess - offsetMinutes(timeZone, new Date(guess)) * 60_000;
  instant = guess - offsetMinutes(timeZone, new Date(instant)) * 60_000;
  return new Date(instant);
}

/** "EDT, UTC−04:00" for the given zone on the given date. */
export function timezoneLabel(timeZone: string, at: Date = new Date()): string {
  const abbr =
    new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "short" })
      .formatToParts(at)
      .find((p) => p.type === "timeZoneName")?.value ?? timeZone;
  const offset = offsetMinutes(timeZone, at);
  const sign = offset < 0 ? "−" : "+";
  const abs = Math.abs(offset);
  const utc = `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return abbr.startsWith("GMT") || abbr === "UTC" ? utc : `${abbr}, ${utc}`;
}

function formatTime(time: string) {
  const [hh, mm] = time.split(":").map(Number);
  const suffix = hh >= 12 ? "PM" : "AM";
  const hour = hh % 12 === 0 ? 12 : hh % 12;
  return `${hour}:${String(mm).padStart(2, "0")} ${suffix}`;
}

/** "Wednesday, October 28, 2026, 10:00 AM – 11:00 AM (EDT, UTC−04:00)" */
export function formatInterviewRange(date: string | null, start: string | null, end: string | null, timeZone: string) {
  if (!date) return "";
  const [y, m, d] = date.split("-").map(Number);
  const day = new Date(Date.UTC(y, m - 1, d, 12));
  const datePart = day.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
  const instant = zonedToUtc(date, start || "12:00:00", timeZone) ?? day;
  const times = start ? `, ${formatTime(start)}${end ? ` – ${formatTime(end)}` : ""}` : "";
  return `${datePart}${times} (${timezoneLabel(timeZone, instant)})`;
}
