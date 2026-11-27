export const fmtDur = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;

/** One table cell, formatted the same way as in the PDF. */
export function fmtCell(v: unknown, fmt?: string): string {
  if (v === null || v === undefined || v === "" || (typeof v === "number" && Number.isNaN(v))) return "—";
  switch (fmt) {
    case "int": return String(Math.round(Number(v)));
    case "dec1": return String(Math.round(Number(v) * 10) / 10);
    case "pct": return `${Math.round(Number(v))}%`;
    case "dur": return fmtDur(Number(v));
    case "date": return new Date(v as string).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    default: return String(v);
  }
}