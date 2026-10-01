export function createEventTimestamp(date = new Date()): string {
  return date.toISOString();
}

export function formatDisplayTime(
  value: string | number | Date | null | undefined,
  timeZone = "Asia/Kolkata"
): string {
  if (!value) return "—";

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
