export type {
  ReportDefinition,
  ReportDataset,
  ReportResult,
  ReportGroup,
  ReportValue,
  ReportMetric,
  ReportDimension,
  ValidationResult,
  CrossFilterSelection,
} from '@lumina/contracts';
// A10 supplies executable functions; no placeholder results are exported.
export type ReportingEngine = {
  validateReport: (
    definition: import('@lumina/contracts').ReportDefinition,
    dataset: import('@lumina/contracts').ReportDataset,
  ) => import('@lumina/contracts').ValidationResult;
  executeReport: (
    definition: import('@lumina/contracts').ReportDefinition,
    dataset: import('@lumina/contracts').ReportDataset,
  ) => import('@lumina/contracts').ReportResult;
  applyCrossFilter: (
    definition: import('@lumina/contracts').ReportDefinition,
    selection: import('@lumina/contracts').CrossFilterSelection,
  ) => import('@lumina/contracts').ReportDefinition;
  exportReportCsv: (result: import('@lumina/contracts').ReportResult) => string;
};
