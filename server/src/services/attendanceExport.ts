import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { DayInfo, hmIn } from "./attendanceCalc";

export interface ReportRow { name: string; email: string; designation: string; summary: any; rating: { stars: number | null; label: string }; days: DayInfo[] }
export interface ReportData { workspaceName: string; from: string; to: string; tz: string; single: boolean; rows: ReportRow[]; settings: any }

const hours = (m: number) => `${Math.floor(m / 60)}h ${String(Math.round(m % 60)).padStart(2, "0")}m`;
const dec = (m: number) => Math.round((m / 60) * 100) / 100;
const dayName = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const STATUS: Record<string, string> = {
  present: "Present", half_day: "Half day", absent: "Absent", leave: "On leave", holiday: "Holiday", weekoff: "Week off", incomplete: "No check-out",
  working: "Working", pending: "Not checked in", future: "", na: "",
};
const stars = (r: ReportRow["rating"]) => (r.stars == null ? "n/a" : `${r.stars}/5 ${r.label}`);

const code = (d: DayInfo) =>
  ({ present: d.late ? "PL" : "P", working: d.late ? "PL" : "P", half_day: "HD", absent: "A", leave: "L", holiday: "H", weekoff: "W", incomplete: "I", pending: "-", future: "", na: "" } as Record<string, string>)[d.status] ?? "";
const FILL: Record<string, string> = { P: "FFBBF7D0", PL: "FFFDE68A", HD: "FFFEF3C7", A: "FFFECACA", L: "FFBFDBFE", H: "FFE9D5FF", W: "FFE5E7EB", I: "FFFED7AA" };

/* --------------------------------- Excel --------------------------------- */

async function xlsx(d: ReportData): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flowbase";
  wb.created = new Date();
  const head = (ws: ExcelJS.Worksheet) => {
    const r = ws.getRow(1);
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    r.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    r.height = 28;
    ws.views = [{ state: "frozen", ySplit: 1 }];
  };

  // ---- Summary
  const s1 = wb.addWorksheet("Summary");
  s1.columns = [
    { header: "Employee", key: "name", width: 26 }, { header: "Email", key: "email", width: 30 }, { header: "Designation", key: "designation", width: 22 },
    { header: "Working days", key: "wd", width: 13 }, { header: "Present", key: "p", width: 10 }, { header: "Half days", key: "hd", width: 10 },
    { header: "Absent", key: "a", width: 10 }, { header: "No check-out", key: "inc", width: 12 }, { header: "Paid leave", key: "pl", width: 11 }, { header: "Unpaid leave", key: "ul", width: 12 },
    { header: "Late", key: "late", width: 8 }, { header: "Early leave", key: "early", width: 11 }, { header: "Total hours", key: "th", width: 12 },
    { header: "Avg hours / day", key: "avg", width: 14 }, { header: "Overtime (h)", key: "ot", width: 12 },
    { header: "Attendance %", key: "rate", width: 13 }, { header: "Punctuality %", key: "pun", width: 13 }, { header: "Score", key: "score", width: 8 }, { header: "Rating", key: "rating", width: 24 },
  ];
  for (const r of d.rows) {
    const s = r.summary;
    s1.addRow({
      name: r.name, email: r.email, designation: r.designation, wd: s.workingDays, p: s.present, hd: s.halfDays, a: s.absent, inc: s.incomplete, pl: s.paidLeave, ul: s.unpaidLeave,
      late: s.late, early: s.earlyLeave, th: dec(s.workedMinutes), avg: dec(s.avgMinutes), ot: dec(s.overtimeMinutes), rate: s.attendanceRate ?? "", pun: s.punctuality, score: s.score ?? "", rating: stars(r.rating),
    });
  }
  head(s1);
  s1.autoFilter = { from: "A1", to: "S1" };
  s1.addRow([]);
  s1.addRow([`${d.workspaceName} · ${d.from} to ${d.to} · timezone ${d.tz}`]).font = { italic: true, color: { argb: "FF6B7280" } };
  s1.addRow([`Score = 60% attendance rate + 25% punctuality + 15% hours completed. Rating: 95+ = 5, 85+ = 4, 70+ = 3, 50+ = 2, below 50 = 1.`]).font = { italic: true, color: { argb: "FF6B7280" } };

  // ---- Daily log
  const s2 = wb.addWorksheet("Daily log");
  s2.columns = [
    { header: "Employee", key: "name", width: 26 }, { header: "Date", key: "date", width: 12 }, { header: "Day", key: "day", width: 7 }, { header: "Status", key: "st", width: 16 },
    { header: "First check-in", key: "in", width: 14 }, { header: "Last check-out", key: "out", width: 14 }, { header: "Hours worked", key: "h", width: 13 },
    { header: "Late", key: "late", width: 7 }, { header: "Early leave", key: "early", width: 11 }, { header: "Mode", key: "mode", width: 11 }, { header: "Leave type", key: "lv", width: 16 }, { header: "Note", key: "note", width: 28 },
  ];
  for (const r of d.rows) {
    for (const x of r.days) {
      if (x.status === "na" || x.status === "future") continue;
      s2.addRow({
        name: r.name, date: x.date, day: dayName(x.date), st: STATUS[x.status] + (x.short ? " (short hours)" : "") + (x.workedOff ? " (worked)" : ""),
        in: x.firstIn ? hmIn(x.firstIn, d.tz) : "", out: x.lastOut ? hmIn(x.lastOut, d.tz) : "", h: x.worked ? dec(x.worked) : "",
        late: x.late ? "Yes" : "", early: x.earlyLeave ? "Yes" : "", mode: x.mode || "", lv: x.leave?.map((l) => l.name + (l.half !== "none" ? " (half)" : "")).join(", ") || "",
        note: x.holiday || x.manualNote || "",
      });
    }
  }
  head(s2);
  s2.autoFilter = { from: "A1", to: "L1" };

  // ---- Month sheet (codes)
  const dates = [...new Set(d.rows.flatMap((r) => r.days.map((x) => x.date)))].sort();
  if (dates.length && dates.length <= 62) {
    const s3 = wb.addWorksheet("Month sheet");
    s3.columns = [{ header: "Employee", key: "name", width: 26 }, ...dates.map((x) => ({ header: x.slice(5), key: x, width: 6 })), { header: "P", key: "tp", width: 6 }, { header: "A", key: "ta", width: 6 }, { header: "L", key: "tl", width: 6 }];
    for (const r of d.rows) {
      const byDate = new Map(r.days.map((x) => [x.date, x]));
      const row = s3.addRow({ name: r.name, ...Object.fromEntries(dates.map((x) => [x, byDate.get(x) ? code(byDate.get(x)!) : ""])), tp: r.summary.present, ta: r.summary.absent, tl: r.summary.paidLeave + r.summary.unpaidLeave });
      dates.forEach((x, i) => {
        const c = row.getCell(i + 2);
        c.alignment = { horizontal: "center" };
        if (FILL[String(c.value)]) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: FILL[String(c.value)] } };
      });
    }
    head(s3);
    s3.addRow([]);
    s3.addRow(["P present · PL present but late · HD half day · A absent · L leave · H holiday · W week off · I no check-out · - not checked in yet"]).font = { italic: true, color: { argb: "FF6B7280" } };
  }

  return Buffer.from(await wb.xlsx.writeBuffer());
}

/* ---------------------------------- PDF ---------------------------------- */

type Col = { label: string; w: number; align?: "left" | "right" | "center" };

function table(doc: PDFKit.PDFDocument, cols: Col[], rows: string[][]) {
  const x0 = doc.page.margins.left;
  const total = cols.reduce((a, c) => a + c.w, 0);
  const rowH = 17;
  let y = doc.y;

  const header = () => {
    doc.save().rect(x0, y, total, rowH).fill("#1F2937").restore();
    doc.font("Helvetica-Bold").fontSize(7.5).fillColor("#FFFFFF");
    let x = x0;
    for (const c of cols) { doc.text(c.label, x + 3, y + 5, { width: c.w - 6, align: c.align || "left", lineBreak: false, ellipsis: true }); x += c.w; }
    y += rowH;
    doc.fillColor("#000000");
  };

  header();
  rows.forEach((r, i) => {
    if (y + rowH > doc.page.height - doc.page.margins.bottom - 8) { doc.addPage(); y = doc.page.margins.top; header(); }
    if (i % 2) doc.save().rect(x0, y, total, rowH).fill("#F3F4F6").restore();
    doc.font("Helvetica").fontSize(7.5).fillColor("#111827");
    let x = x0;
    r.forEach((cell, j) => { doc.text(cell, x + 3, y + 5, { width: cols[j].w - 6, align: cols[j].align || "left", lineBreak: false, ellipsis: true }); x += cols[j].w; });
    y += rowH;
  });
  doc.y = y + 8;
  doc.x = x0;
}

function pdf(d: ReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 30, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.font("Helvetica-Bold").fontSize(16).fillColor("#111827").text(d.single ? `Attendance report: ${d.rows[0].name}` : "Attendance report");
    doc.font("Helvetica").fontSize(9).fillColor("#6B7280")
      .text(`${d.workspaceName}   |   ${d.from} to ${d.to}   |   timezone ${d.tz}   |   shift ${d.settings.workStart}-${d.settings.workEnd}`);
    doc.moveDown(0.8);
    doc.fillColor("#000000");

    table(
      doc,
      [
        { label: "Employee", w: 150 }, { label: "Working days", w: 54, align: "right" }, { label: "Present", w: 44, align: "right" }, { label: "Half", w: 34, align: "right" },
        { label: "Absent", w: 42, align: "right" }, { label: "Leave", w: 38, align: "right" }, { label: "Late", w: 34, align: "right" }, { label: "Early", w: 36, align: "right" },
        { label: "Avg hours", w: 48, align: "right" }, { label: "Overtime", w: 48, align: "right" }, { label: "Attend. %", w: 48, align: "right" }, { label: "Punct. %", w: 44, align: "right" },
        { label: "Score", w: 36, align: "right" }, { label: "Rating", w: 100 },
      ],
      d.rows.map((r) => {
        const s = r.summary;
        return [r.name, String(s.workingDays), String(s.present), String(s.halfDays), String(s.absent), String(s.paidLeave + s.unpaidLeave), String(s.late), String(s.earlyLeave),
          hours(s.avgMinutes), hours(s.overtimeMinutes), s.attendanceRate == null ? "-" : `${s.attendanceRate}%`, `${s.punctuality}%`, s.score == null ? "-" : String(s.score), stars(r.rating)];
      })
    );
    doc.font("Helvetica").fontSize(7).fillColor("#6B7280").text("Score = 60% attendance rate + 25% punctuality + 15% hours completed. Rating: 95+ = 5, 85+ = 4, 70+ = 3, 50+ = 2, below 50 = 1.");

    if (d.single) {
      doc.addPage();
      doc.font("Helvetica-Bold").fontSize(12).fillColor("#111827").text("Day by day");
      doc.moveDown(0.5);
      table(
        doc,
        [{ label: "Date", w: 70 }, { label: "Day", w: 40 }, { label: "Status", w: 100 }, { label: "Check-in", w: 60 }, { label: "Check-out", w: 60 }, { label: "Hours", w: 60, align: "right" }, { label: "Late", w: 40 }, { label: "Mode", w: 60 }, { label: "Note", w: 250 }],
        d.rows[0].days
          .filter((x) => x.status !== "na" && x.status !== "future")
          .map((x) => [x.date, dayName(x.date), STATUS[x.status] + (x.short ? " (short)" : ""), x.firstIn ? hmIn(x.firstIn, d.tz) : "", x.lastOut ? hmIn(x.lastOut, d.tz) : "", x.worked ? hours(x.worked) : "", x.late ? "Yes" : "", x.mode || "", x.holiday || x.leave?.map((l) => l.name).join(", ") || x.manualNote || ""])
      );
    }

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const keep = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // writing in the bottom margin must not create new pages
      doc.font("Helvetica").fontSize(7).fillColor("#9CA3AF").text(`Page ${i + 1} of ${range.count}`, 30, doc.page.height - 22, { width: doc.page.width - 60, align: "right", lineBreak: false });
      doc.page.margins.bottom = keep;
    }
    doc.end();
  });
}

export async function buildReportFile(format: "xlsx" | "pdf", d: ReportData): Promise<Buffer> {
  return format === "pdf" ? pdf(d) : xlsx(d);
}