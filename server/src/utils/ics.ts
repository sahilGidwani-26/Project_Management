interface IcsPerson {
  name: string;
  email: string;
}

const fmt = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

const esc = (s: string) =>
  s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");

// iCalendar lines must be folded at 75 characters
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [line.slice(0, 75)];
  for (let i = 75; i < line.length; i += 74) parts.push(" " + line.slice(i, i + 74));
  return parts.join("\r\n");
}

export function buildIcs(p: {
  uid: string;
  sequence: number;
  method: "REQUEST" | "CANCEL";
  title: string;
  description?: string;
  location?: string;
  url?: string;
  start: Date;
  end: Date;
  organizer: IcsPerson;
  attendees: IcsPerson[];
}): string {
  const descriptionParts = [p.description, p.url ? `Join: ${p.url}` : ""].filter(Boolean).join("\n\n");
  const cn = (name: string) => `"${name.replace(/"/g, "")}"`;

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Flowbase//Calendar//EN",
    "CALSCALE:GREGORIAN",
    `METHOD:${p.method}`,
    "BEGIN:VEVENT",
    `UID:${p.uid}@flowbase`,
    `DTSTAMP:${fmt(new Date())}`,
    `DTSTART:${fmt(p.start)}`,
    `DTEND:${fmt(p.end)}`,
    `SEQUENCE:${p.sequence}`,
    `SUMMARY:${esc(p.title)}`,
    `STATUS:${p.method === "CANCEL" ? "CANCELLED" : "CONFIRMED"}`,
    `ORGANIZER;CN=${cn(p.organizer.name)}:mailto:${p.organizer.email}`,
    ...p.attendees.map((a) => `ATTENDEE;CN=${cn(a.name)};ROLE=REQ-PARTICIPANT;RSVP=TRUE:mailto:${a.email}`),
  ];
  if (descriptionParts) lines.push(`DESCRIPTION:${esc(descriptionParts)}`);
  if (p.location) lines.push(`LOCATION:${esc(p.location)}`);
  if (p.url) lines.push(`URL:${p.url}`);
  lines.push("END:VEVENT", "END:VCALENDAR");

  return lines.map(fold).join("\r\n") + "\r\n";
}