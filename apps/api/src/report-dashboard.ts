export type ReportChart = {
  id: string;
  title: string;
  unit: string;
  defaultType: 'bar' | 'line' | 'donut' | 'pie' | 'table' | 'kpi';
  points: { label: string; value: number }[];
  description?: string;
  period?: { from: string; to: string };
  metric?: string;
  groupBy?: string;
  totalGroups?: number;
  total?: number;
};
