export interface ApiEntry {
  translation: string;
  fullAPI?: string;
  summary?: string;
  example?: string;
  [key: string]: string | undefined;
}

export type PyGscApi = Record<string, Record<string, ApiEntry>>;

export interface Bo3Function {
  fullAPI: string;
  callOn?: string;
  summary?: string;
  example?: string;
  side?: string;
  [key: string]: string | undefined;
}

export interface ReverseEntry {
  pseudo: string;
  translation: string;
}

export interface TranspileResult {
  code: string;
  /** Maps each PyGSC line (0-based index) to its GSC line (0-based index) */
  lineMap: number[];
}

export interface LintDiagnostic {
  line: number;       // 1-based
  message: string;
  severity: "warning" | "info" | "error";
}

export interface GscDiagnostic {
  gscLine: number;    // 1-based line in the GSC output
  message: string;
  severity: "warning" | "info" | "error";
}
