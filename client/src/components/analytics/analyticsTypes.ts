export interface Kpi { label: string; value: string; sub?: string; tone?: "good" | "bad" | "warn" | "info" }
export interface ChartDef {
  id: string; title: string; type: "bar" | "hbar" | "hstacked" | "line" | "donut"; note?: string; unit?: string;
  data?: { name: string; value: number; color?: string }[];
  x?: string[]; series?: { name: string; color: string; values: number[] }[];
}
export interface TableCol { key: string; label: string; fmt?: "text" | "int" | "pct" | "dur" | "date" | "dec1"; w?: number }
export interface TableDef { id: string; title: string; note?: string; columns: TableCol[]; rows: Record<string, any>[] }
export interface SectionDef { key: string; title: string; kpis: Kpi[]; charts: ChartDef[]; tables: TableDef[]; notes: string[] }
export interface ReportMeta { workspaceName: string; from: string; to: string; days: number; tz: string; project: string | null; generatedAt: string; generatedBy: string }
export interface ReportOptions { sections: { key: string; label: string }[]; today: string; tz: string }