import {
  ReportDefinitionSchema,
  type ReportDataset,
  type ReportDefinition,
} from '@lumina/contracts';
import { validateReport } from '@lumina/reporting';

export function validateMobileProposal(
  raw: unknown,
  data: ReportDataset,
): { explanation: string; definition: ReportDefinition | null } {
  const value = raw as { explanation?: unknown; definition?: unknown };
  if (
    !value ||
    typeof value.explanation !== 'string' ||
    !value.explanation.trim() ||
    value.explanation.length > 500
  )
    throw new Error('La propuesta no tiene una explicación válida.');
  if (value.definition === null) return { explanation: value.explanation, definition: null };
  const definition = ReportDefinitionSchema.parse(value.definition);
  if (definition.datasetId !== data.datasetId || definition.source !== data.source)
    throw new Error('La propuesta pertenece a otro conjunto o fuente.');
  const validation = validateReport(definition, data);
  if (!validation.ok) throw new Error(validation.problems.map((item) => item.message).join(' '));
  return { explanation: value.explanation, definition };
}
