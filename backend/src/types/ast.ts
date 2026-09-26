export interface AstFunctionFact {
  /** Present only when the source gives the function a name. */
  name: string | null;
  line: number;
  /** Nesting depth of this function, including the function itself. */
  nestingDepth: number;
}

export interface AstFileResult {
  path: string;
  extension: string;
  lineCount: number;
  functionCount: number;
  classCount: number;
  importCount: number;
  exportCount: number;
  maxNestingDepth: number;
  functions: AstFunctionFact[];
}

export interface AstParseError {
  path: string;
  message: string;
}

export interface AstAnalysisSummary {
  /** Files that were parsed successfully. */
  totalFiles: number;
  totalLines: number;
  totalFunctions: number;
  totalClasses: number;
  totalImports: number;
  totalExports: number;
  parseErrors: number;
  maxNestingDepth: number;
  /** Supported files found before limits, including ones that failed to parse. */
  filesDiscovered: number;
  skippedOversizeFiles: number;
  /** True when the file cap stopped discovery or analysis early. */
  truncated: boolean;
}

export interface AstAnalysisResult {
  summary: AstAnalysisSummary;
  files: AstFileResult[];
  errors: AstParseError[];
}
