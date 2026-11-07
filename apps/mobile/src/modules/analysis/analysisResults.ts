import { AnalysisJobViewSchema, type AnalysisResult } from '@lumina/contracts';
import type { OfflineScope } from '../../offline/scope';
export function parseAnalysisJobs(raw:unknown){
  const value=raw as {jobs?:unknown};
  if(!value||!Array.isArray(value.jobs)||value.jobs.length>30)throw new Error('La lista de análisis no es válida.');
  return value.jobs.map(row=>AnalysisJobViewSchema.parse(row));
}
export function checkedAnalysisCopy(raw: unknown, scope: OfflineScope) {
  const value = raw as { tenantId?: string; actorId?: string; job?: unknown };
  if (value?.tenantId !== scope.tenantId || value.actorId !== scope.actorId)
    throw new Error('El resultado pertenece a otra cuenta.');
  const job = AnalysisJobViewSchema.parse(value.job);
  if (job.result && (job.result.action !== job.action || job.result.source !== job.source))
    throw new Error('El resultado no corresponde al análisis solicitado.');
  return job;
}
export function analysisSlice(
  result: AnalysisResult,
  input: { from: string; to: string; location: string; channel: string },
) {
  if (
    !input.from ||
    !input.to ||
    input.from > input.to ||
    input.from < result.period.from ||
    input.to > result.period.to
  )
    throw new Error('El rango queda fuera del corte descargado.');
  const match = (row: { date: string; locationId: string; channel: string }) =>
    row.date >= input.from &&
    row.date <= input.to &&
    (!input.location || row.locationId === input.location) &&
    (!input.channel || row.channel === input.channel);
  const dates = new Map<string, number>();
  for (const row of result.forecast)
    if (match(row)) dates.set(row.date, (dates.get(row.date) ?? 0) + row.predictedUnits);
  return {
    forecast: [...dates].sort(([a], [b]) => a.localeCompare(b)),
    alerts: result.alerts.filter(match),
    suggestions: result.suggestions.filter(
      (row) => !input.location || row.locationId === input.location,
    ),
  };
}
