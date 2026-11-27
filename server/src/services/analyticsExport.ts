import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import { ChartDef, Kpi, ReportMeta, SectionDef, TableDef, fmtDur } from "./analyticsReport";

type Doc = PDFKit.PDFDocument;
const L = 34, W = 842 - 68, TOP = 40, BOTTOM = 595 - 44, CH = 172;
const TEAL = "#0F766E";
const TONE: Record<string, string> = { good: "#059669", bad: "#DC2626", warn: "#D97706", info: "#2563EB" };
const PAL = ["#14B8A6", "#3B82F6", "#F59E0B", "#8B5CF6", "#EC4899", "#10B981", "#EF4444", "#06B6D4"];

export function fmtCell(v: any, fmt?: string): string {
  if (v === null || v === undefined || v === "" || Number.isNaN(v)) return "—";
  switch (fmt) {
    case "int": return String(Math.round(Number(v)));
    case "dec1": return String(Math.round(Number(v) * 10) / 10);
    case "pct": return `${Math.round(Number(v))}%`;
    case "dur": return fmtDur(Number(v));
    case "date": return new Date(v).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
    default: return String(v);
  }
}
const num = (v: number, unit?: string) => (unit === "h" ? `${Math.round(v * 10) / 10}h` : unit === "%" ? `${Math.round(v)}%` : Number.isInteger(v) ? String(v) : String(Math.round(v * 10) / 10));

/* --------------------------------- text helpers --------------------------------- */

function fit(doc: Doc, s: unknown, w: number) {
  let t = String(s ?? "");
  if (doc.widthOfString(t) <= w) return t;
  while (t.length > 1 && doc.widthOfString(`${t}…`) > w) t = t.slice(0, -1);
  return `${t}…`;
}
function put(doc: Doc, s: unknown, x: number, y: number, w: number, align: "left" | "right" | "center" = "left") {
  const t = fit(doc, s, w);
  const tw = doc.widthOfString(t);
  doc.text(t, align === "right" ? x + w - tw : align === "center" ? x + (w - tw) / 2 : x, y, { lineBreak: false });
}
const font = (doc: Doc, bold: boolean, size: number, color: string) => doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size).fillColor(color);
const ensure = (doc: Doc, y: number, h: number) => { if (y + h > BOTTOM) { doc.addPage(); return TOP; } return y; };
const niceMax = (v: number) => { const p = Math.pow(10, Math.floor(Math.log10(v))); const n = v / p; return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * p; };

/* ----------------------------------- charts ----------------------------------- */

function noData(doc: Doc, x: number, y: number, w: number, h: number) {
  font(doc, false, 8, "#9CA3AF");
  put(doc, "No data for this period", x, y + h / 2 - 4, w, "center");
}
function legend(doc: Doc, items: { name: string; color: string }[], x: number, y: number) {
  let lx = x;
  items.forEach((it) => {
    doc.save().rect(lx, y + 1, 6, 6).fill(it.color).restore();
    font(doc, false, 7, "#4B5563");
    put(doc, it.name, lx + 9, y, 80);
    lx += 14 + Math.min(80, doc.widthOfString(it.name)) + 8;
  });
}

function hbar(doc: Doc, c: ChartDef, x: number, y: number, w: number, h: number) {
  const data = (c.data || []).filter((d) => d.value > 0 || c.unit === "%").slice(0, Math.floor(h / 15));
  if (!data.length) return noData(doc, x, y, w, h);
  const lw = w * 0.36, bx = x + lw + 6, bw = w - lw - 52, rh = Math.min(17, h / data.length), max = Math.max(1, ...data.map((d) => d.value));
  data.forEach((d, i) => {
    const ry = y + i * rh, bl = Math.max(1.5, (d.value / max) * bw);
    font(doc, false, 7.5, "#374151");
    put(doc, d.name, x, ry + rh / 2 - 4, lw);
    doc.save().roundedRect(bx, ry + rh / 2 - 4.5, bl, 9, 2).fill(d.color || PAL[i % PAL.length]).restore();
    font(doc, true, 7.5, "#111827");
    put(doc, num(d.value, c.unit), bx + bl + 4, ry + rh / 2 - 4, 44);
  });
}

function vbar(doc: Doc, c: ChartDef, x: number, y: number, w: number, h: number) {
  const data = c.data || [];
  if (!data.length || data.every((d) => d.value === 0)) return noData(doc, x, y, w, h);
  const slot = w / data.length, bw = Math.min(34, slot * 0.66), max = Math.max(1, ...data.map((d) => d.value)), ph = h - 28;
  data.forEach((d, i) => {
    const bh = (d.value / max) * (ph - 10), bx = x + i * slot + (slot - bw) / 2;
    doc.save().roundedRect(bx, y + ph - bh, bw, Math.max(1, bh), 2).fill(d.color || PAL[i % PAL.length]).restore();
    font(doc, true, 7, "#111827");
    put(doc, num(d.value, c.unit), x + i * slot, y + ph - bh - 9, slot, "center");
    font(doc, false, 6.5, "#6B7280");
    put(doc, d.name, x + i * slot, y + ph + 5, slot, "center");
  });
}

function hstack(doc: Doc, c: ChartDef, x: number, y: number, w: number, h: number) {
  const xs = (c.x || []).slice(0, Math.floor((h - 14) / 15)), ser = c.series || [];
  if (!xs.length || !ser.length) return noData(doc, x, y, w, h);
  legend(doc, ser, x, y);
  const lw = w * 0.34, bx = x + lw + 6, bw = w - lw - 46, top = y + 14, rh = Math.min(17, (h - 14) / xs.length);
  const totals = xs.map((_, i) => ser.reduce((t, s) => t + (s.values[i] || 0), 0)), max = Math.max(1, ...totals);
  xs.forEach((name, i) => {
    const ry = top + i * rh;
    font(doc, false, 7.5, "#374151");
    put(doc, name, x, ry + rh / 2 - 4, lw);
    let cx = bx;
    ser.forEach((s) => { const sw = ((s.values[i] || 0) / max) * bw; if (sw > 0) doc.save().rect(cx, ry + rh / 2 - 4.5, sw, 9).fill(s.color).restore(); cx += sw; });
    font(doc, true, 7.5, "#111827");
    put(doc, num(totals[i]), cx + 4, ry + rh / 2 - 4, 40);
  });
}

function lines(doc: Doc, c: ChartDef, x: number, y: number, w: number, h: number) {
  const xs = c.x || [], ser = c.series || [];
  if (!xs.length || !ser.length || ser.every((s) => s.values.every((v) => v === 0))) return noData(doc, x, y, w, h);
  if (ser.length > 1) legend(doc, ser, x, y);
  const px = x + 28, py = y + 14, pw = w - 36, ph = h - 14 - 16, max = niceMax(Math.max(1, ...ser.flatMap((s) => s.values)));
  for (let i = 0; i <= 4; i++) {
    const gy = py + ph - (ph * i) / 4;
    doc.save().lineWidth(0.4).strokeColor("#E5E7EB").moveTo(px, gy).lineTo(px + pw, gy).stroke().restore();
    font(doc, false, 6, "#6B7280");
    put(doc, String(Math.round(((max * i) / 4) * 10) / 10), x, gy - 3, 24, "right");
  }
  const step = pw / Math.max(1, xs.length - 1);
  ser.forEach((s) => {
    doc.save().lineWidth(1.6).strokeColor(s.color);
    s.values.forEach((v, i) => { const vx = px + i * step, vy = py + ph - (v / max) * ph; if (i) doc.lineTo(vx, vy); else doc.moveTo(vx, vy); });
    doc.stroke().restore();
  });
  const every = Math.ceil(xs.length / 8);
  xs.forEach((l, i) => { if (i % every === 0) { font(doc, false, 6, "#6B7280"); put(doc, l, px + i * step - 20, py + ph + 4, 40, "center"); } });
}

function donut(doc: Doc, c: ChartDef, x: number, y: number, w: number, h: number) {
  const data = (c.data || []).filter((d) => d.value > 0), total = data.reduce((t, d) => t + d.value, 0);
  if (!total) return noData(doc, x, y, w, h);
  const r = Math.min(h / 2 - 2, 62), cx = x + r + 6, cy = y + h / 2;
  let a0 = -Math.PI / 2;
  if (data.length === 1) doc.save().circle(cx, cy, r).fill(data[0].color || PAL[0]).restore();
  else data.forEach((d, i) => {
    const a1 = a0 + (d.value / total) * Math.PI * 2, large = a1 - a0 > Math.PI ? 1 : 0;
    doc.save().path(`M ${cx} ${cy} L ${cx + r * Math.cos(a0)} ${cy + r * Math.sin(a0)} A ${r} ${r} 0 ${large} 1 ${cx + r * Math.cos(a1)} ${cy + r * Math.sin(a1)} Z`).fill(d.color || PAL[i % PAL.length]).restore();
    a0 = a1;
  });
  doc.save().circle(cx, cy, r * 0.58).fill("#FFFFFF").restore();
  font(doc, true, 13, "#111827");
  put(doc, num(total), cx - r, cy - 8, r * 2, "center");
  font(doc, false, 6.5, "#6B7280");
  put(doc, "total", cx - r, cy + 6, r * 2, "center");
  const lx = x + r * 2 + 22, lw = w - r * 2 - 28, rh = Math.min(16, (h - 6) / data.length);
  data.slice(0, Math.floor((h - 6) / rh)).forEach((d, i) => {
    const ly = y + 4 + i * rh;
    doc.save().rect(lx, ly + 1, 7, 7).fill(d.color || PAL[i % PAL.length]).restore();
    font(doc, false, 7.5, "#374151");
    put(doc, d.name, lx + 11, ly, lw - 70);
    font(doc, true, 7.5, "#111827");
    put(doc, `${num(d.value)} (${Math.round((d.value / total) * 100)}%)`, lx + lw - 62, ly, 62, "right");
  });
}

function chart(doc: Doc, c: ChartDef, x: number, y: number, w: number) {
  doc.save().roundedRect(x, y, w, CH, 6).lineWidth(0.7).strokeColor("#E5E7EB").stroke().restore();
  font(doc, true, 8.5, "#111827");
  put(doc, c.title, x + 10, y + 8, w - 20);
  let top = y + 22;
  if (c.note) { font(doc, false, 6.5, "#9CA3AF"); put(doc, c.note, x + 10, y + 19, w - 20); top = y + 31; }
  const ix = x + 10, iw = w - 20, ih = CH - (top - y) - 8;
  if (c.type === "hbar") hbar(doc, c, ix, top, iw, ih);
  else if (c.type === "bar") vbar(doc, c, ix, top, iw, ih);
  else if (c.type === "hstacked") hstack(doc, c, ix, top, iw, ih);
  else if (c.type === "line") lines(doc, c, ix, top, iw, ih);
  else donut(doc, c, ix, top, iw, ih);
}

/* ------------------------------ page building blocks ------------------------------ */

function cover(doc: Doc, meta: ReportMeta, title: string) {
  doc.save().rect(0, 0, 842, 78).fill(TEAL).restore();
  font(doc, true, 20, "#FFFFFF");
  put(doc, title, L, 18, W);
  font(doc, false, 9, "#CCFBF1");
  put(doc, `${meta.workspaceName}   |   ${meta.from} to ${meta.to} (${meta.days} days)   |   ${meta.project ? `Project: ${meta.project}` : "All projects you can see"}`, L, 46, W);
  put(doc, `Generated ${new Date(meta.generatedAt).toLocaleString("en-GB", { timeZone: meta.tz })} by ${meta.generatedBy}   |   timezone ${meta.tz}`, L, 59, W);
  return 96;
}
function sectionTitle(doc: Doc, y: number, t: string) {
  doc.save().rect(L, y, 4, 18).fill(TEAL).restore();
  font(doc, true, 14, "#111827");
  put(doc, t, L + 12, y + 2, W);
  return y + 30;
}
function kpiRow(doc: Doc, y: number, list: Kpi[]) {
  const per = 5, gap = 8, w = (W - gap * (per - 1)) / per, h = 54;
  for (let i = 0; i < list.length; i += per) {
    y = ensure(doc, y, h + 8);
    list.slice(i, i + per).forEach((k, j) => {
      const x = L + j * (w + gap);
      doc.save().roundedRect(x, y, w, h, 5).fill("#F3F4F6").restore();
      font(doc, false, 7.5, "#6B7280");
      put(doc, k.label, x + 8, y + 7, w - 16);
      font(doc, true, 15, k.tone ? TONE[k.tone] : "#111827");
      put(doc, k.value, x + 8, y + 19, w - 16);
      if (k.sub) { font(doc, false, 6.5, "#6B7280"); put(doc, k.sub, x + 8, y + 41, w - 16); }
    });
    y += h + 8;
  }
  return y;
}
function table(doc: Doc, y: number, t: TableDef) {
  y = ensure(doc, y, 60);
  font(doc, true, 10, "#111827");
  put(doc, t.title, L, y, W);
  y += 15;
  if (t.note) { font(doc, false, 7, "#9CA3AF"); put(doc, t.note, L, y - 2, W); y += 10; }
  if (!t.rows.length) { font(doc, false, 8, "#6B7280"); put(doc, "Nothing to show for this period.", L, y, W); return y + 22; }
  const weights = t.columns.map((c) => c.w ?? ((c.fmt || "text") === "text" ? 2.4 : 1)), sum = weights.reduce((a, b) => a + b, 0), widths = weights.map((x) => (x / sum) * W);
  const head = (yy: number) => {
    doc.save().rect(L, yy, W, 17).fill("#1F2937").restore();
    let x = L;
    t.columns.forEach((c, i) => { font(doc, true, 7.5, "#FFFFFF"); put(doc, c.label, x + 4, yy + 5, widths[i] - 8, (c.fmt || "text") === "text" ? "left" : "right"); x += widths[i]; });
    return yy + 17;
  };
  y = head(y);
  t.rows.forEach((r, ri) => {
    if (y + 15 > BOTTOM) { doc.addPage(); y = head(TOP); }
    if (ri % 2) doc.save().rect(L, y, W, 15).fill("#F3F4F6").restore();
    let x = L;
    t.columns.forEach((c, i) => { font(doc, false, 7.5, "#111827"); put(doc, fmtCell(r[c.key], c.fmt), x + 4, y + 4, widths[i] - 8, (c.fmt || "text") === "text" ? "left" : "right"); x += widths[i]; });
    y += 15;
  });
  return y + 14;
}

export function buildPdf(meta: ReportMeta, sections: SectionDef[], title: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", layout: "landscape", margin: 34, bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    let y = cover(doc, meta, title);
    sections.forEach((sec, si) => {
      if (si > 0) { doc.addPage(); y = TOP; }
      y = sectionTitle(doc, y, sec.title);
      y = kpiRow(doc, y, sec.kpis);
      const cw = (W - 12) / 2;
      for (let i = 0; i < sec.charts.length; i += 2) {
        y = ensure(doc, y, CH + 10);
        chart(doc, sec.charts[i], L, y, cw);
        if (sec.charts[i + 1]) chart(doc, sec.charts[i + 1], L + cw + 12, y, cw);
        y += CH + 10;
      }
      sec.tables.forEach((t) => { y = table(doc, y, t); });
      sec.notes.forEach((n) => { y = ensure(doc, y, 14); font(doc, false, 7, "#6B7280"); put(doc, `Note: ${n}`, L, y, W); y += 11; });
    });

    const range = doc.bufferedPageRange();
    for (let i = 0; i < range.count; i++) {
      doc.switchToPage(i);
      const keep = doc.page.margins.bottom;
      doc.page.margins.bottom = 0; // writing in the bottom margin must not create new pages
      font(doc, false, 7, "#9CA3AF");
      put(doc, `Flowbase · ${meta.workspaceName}`, L, 595 - 24, 300);
      put(doc, `Page ${i + 1} of ${range.count}`, 842 - L - 100, 595 - 24, 100, "right");
      doc.page.margins.bottom = keep;
    }
    doc.end();
  });
}

/* ----------------------------------------- Excel ----------------------------------------- */

const sheetName = (taken: Set<string>, s: string) => {
  let n = s.replace(/[:\\/?*[\]]/g, " ").slice(0, 28).trim() || "Sheet", k = 2, out = n;
  while (taken.has(out.toLowerCase())) out = `${n.slice(0, 26)} ${k++}`;
  taken.add(out.toLowerCase());
  return out;
};

export async function buildXlsx(meta: ReportMeta, sections: SectionDef[], title: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Flowbase";
  wb.created = new Date();
  const taken = new Set<string>();
  const head = (ws: ExcelJS.Worksheet, row = 1) => {
    const r = ws.getRow(row);
    r.font = { bold: true, color: { argb: "FFFFFFFF" } };
    r.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F2937" } };
    r.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    r.height = 26;
  };

  const sum = wb.addWorksheet(sheetName(taken, "Summary"));
  sum.addRow([title]).font = { bold: true, size: 14 };
  sum.addRow([`${meta.workspaceName} · ${meta.from} to ${meta.to} · ${meta.project ? `Project: ${meta.project}` : "All projects you can see"} · timezone ${meta.tz}`]).font = { italic: true, color: { argb: "FF6B7280" } };
  sum.addRow([]);
  const hr = sum.addRow(["Section", "Metric", "Value", "Note"]);
  head(sum, hr.number);
  sum.columns = [{ width: 18 }, { width: 30 }, { width: 18 }, { width: 60 }];
  sections.forEach((sec) => sec.kpis.forEach((k) => sum.addRow([sec.title, k.label, k.value, k.sub || ""])));
  sections.forEach((sec) => sec.notes.forEach((n) => sum.addRow([sec.title, "Note", "", n])));

  const cd = wb.addWorksheet(sheetName(taken, "Chart data"));
  cd.columns = [{ header: "Section", width: 16 }, { header: "Chart", width: 34 }, { header: "Label", width: 28 }, { header: "Series", width: 18 }, { header: "Value", width: 12 }];
  head(cd);
  sections.forEach((sec) => sec.charts.forEach((c) => {
    (c.data || []).forEach((d) => cd.addRow([sec.title, c.title, d.name, "", d.value]));
    (c.series || []).forEach((s) => (c.x || []).forEach((lab, i) => cd.addRow([sec.title, c.title, lab, s.name, s.values[i] ?? 0])));
  }));

  sections.forEach((sec) => sec.tables.forEach((t) => {
    const ws = wb.addWorksheet(sheetName(taken, `${sec.title} - ${t.title}`));
    const label = (c: TableDef["columns"][number]) => (c.fmt === "dur" ? `${c.label} (hours)` : c.fmt === "pct" ? `${c.label} (%)` : c.label);
    ws.columns = t.columns.map((c) => ({ header: label(c), key: c.key, width: (c.fmt || "text") === "text" ? 28 : 14 }));
    head(ws);
    t.rows.forEach((r) => {
      const row: Record<string, any> = {};
      t.columns.forEach((c) => {
        const v = r[c.key];
        row[c.key] = v == null ? "" : c.fmt === "dur" ? Math.round((Number(v) / 60) * 100) / 100 : c.fmt === "date" ? new Date(v) : v;
      });
      const added = ws.addRow(row);
      t.columns.forEach((c, i) => { if (c.fmt === "date") added.getCell(i + 1).numFmt = "dd mmm yyyy"; });
    });
    ws.views = [{ state: "frozen", ySplit: 1 }];
    if (t.rows.length) ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: t.columns.length } };
  }));

  return Buffer.from(await wb.xlsx.writeBuffer());
}