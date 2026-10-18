export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatFlightDateTime(value: string): string {
  const match = value.match(
    /^(?:(\w{3})\s+)?(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/,
  );
  if (!match) return value;

  const [, airportCode, year, monthNumber, day, hourNumber, minute] = match;
  const monthNames = [
    "Jan", "Feb", "Mar", "Apr", "May", "Jun",
    "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
  ];
  const month = monthNames[Number(monthNumber) - 1] ?? monthNumber;
  const hour = Number(hourNumber);
  const meridiem = hour >= 12 ? "PM" : "AM";
  const displayHour = hour % 12 || 12;

  return `${airportCode ? `${airportCode} ` : ""}${day} ${month} ${year} at ${displayHour}:${minute} ${meridiem}`;
}

export function nightsBetween(checkin: string, checkout: string): number {
  return Math.round(
    (Date.parse(`${checkout}T00:00:00Z`) - Date.parse(`${checkin}T00:00:00Z`)) / 86400000,
  );
}
