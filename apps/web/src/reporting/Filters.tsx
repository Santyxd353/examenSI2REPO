import { useMemo, useState } from 'react';
import {
  minorToDecimal,
  moneyToMinor,
  REPORT_FILTER_FIELDS,
  ReportFilterSchema,
  type ReportDataset,
  type ReportDefinition,
  type ReportFilter,
} from '@lumina/contracts';
import { fields, label } from './report-data';

const inventoryFields = [
  'ubicacion',
  'categoria',
  'marca',
  'producto',
  'variante',
  'talla',
  'color',
  'disponible_al_corte',
];
const operatorNames = {
  eq: 'Es igual a',
  neq: 'Es distinto de',
  in: 'Está en la lista',
  not_in: 'Está fuera de la lista',
  gte: 'Desde',
  lte: 'Hasta',
  between: 'Entre',
  is_null: 'Sin dato',
};
type Operator = keyof typeof operatorNames;
export function describeFilter(data: ReportDataset, filter: ReportFilter) {
  const format = (value: unknown) => {
    if (typeof value === 'string') return label(data, filter.field, value);
    if (typeof value === 'boolean') return value ? 'Sí' : 'No';
    if (filter.field === 'precio_unitario' && typeof value === 'number')
      return 'Bs ' + minorToDecimal(value).replace('.', ',');
    return String(value ?? '');
  };
  const values = Array.isArray(filter.value)
    ? filter.value.map(format).join(', ')
    : format(filter.value);
  return [fields[filter.field], operatorNames[filter.operator], values].filter(Boolean).join(' · ');
}
const dates = ['dia', 'periodo', 'periodo_comparacion'];
function optionsFor(data: ReportDataset, field: ReportFilter['field']) {
  if (field === 'ubicacion') return data.downloadedLocationIds;
  if (field === 'metodo_pago') return [...new Set(data.payments.map((row) => row.method))].sort();
  if (field === 'estado_pago') return [...new Set(data.payments.map((row) => row.status))].sort();
  const result = new Set<string>();
  for (const row of [...data.sales, ...data.returns, ...data.refunds, ...data.stock]) {
    const value = (row.dimensions as Record<string, string | null>)[field];
    if (value != null) result.add(value);
  }
  return [...result].sort().slice(0, 1000);
}

export function Filters({
  data,
  definition,
  change,
}: {
  data: ReportDataset;
  definition: ReportDefinition;
  change: (filters: ReportFilter[]) => void;
}) {
  const allowed = REPORT_FILTER_FIELDS.filter(
    (field) =>
      !['periodo', 'periodo_comparacion'].includes(field) &&
      data.availableColumns.includes(field) &&
      (definition.fact === 'stock_al_corte'
        ? inventoryFields.includes(field)
        : field !== 'disponible_al_corte'),
  );
  const [selected, setSelected] = useState<ReportFilter['field']>('ubicacion');
  const field = allowed.includes(selected) ? selected : allowed[0];
  const [operator, setOperator] = useState<Operator>('eq');
  const [value, setValue] = useState('');
  const [upper, setUpper] = useState('');
  const [many, setMany] = useState<string[]>([]);
  const [error, setError] = useState('');
  const options = useMemo(() => (field ? optionsFor(data, field) : []), [data, field]);
  const numeric = field === 'precio_unitario' || field === 'disponible_al_corte';
  const operators: Operator[] =
    field === 'con_devolucion'
      ? ['eq', 'neq']
      : numeric || dates.includes(field)
        ? ['eq', 'neq', 'gte', 'lte', 'between', 'is_null']
        : ['eq', 'neq', 'in', 'not_in', 'is_null'];
  const op = operators.includes(operator) ? operator : 'eq';
  const convert = (raw: string) => {
    const text = raw.trim();
    if (!text) throw new Error('Indica un valor de filtro.');
    if (field === 'precio_unitario') return moneyToMinor(text.replace(',', '.'));
    if (numeric) return Number(text);
    if (field === 'con_devolucion') return text === 'true';
    return text;
  };
  const add = () => {
    try {
      const values =
        op === 'between'
          ? [convert(value), convert(upper)]
          : op === 'in' || op === 'not_in'
            ? options.length
              ? many
              : value
                  .split(',')
                  .map((text) => text.trim())
                  .filter(Boolean)
            : undefined;
      const next = ReportFilterSchema.parse({
        field,
        operator: op,
        ...(op === 'is_null' ? {} : { value: values ?? convert(value) }),
      });
      change([...definition.filters, next]);
      setError('');
      setValue('');
      setUpper('');
      setMany([]);
    } catch (reason) {
      setError(
        (reason as Error).message.startsWith('[')
          ? 'Revisa el operador y los valores del filtro.'
          : (reason as Error).message,
      );
    }
  };
  return (
    <fieldset className="report-filters-panel">
      <legend>Filtros de datos</legend>
      <div className="report-chips">
        {definition.filters.map((filter, i) => (
          <button
            type="button"
            key={i}
            aria-label={`Quitar filtro ${fields[filter.field]}`}
            onClick={() => change(definition.filters.filter((_, index) => index !== i))}
          >
            {describeFilter(data, filter)} <span aria-hidden="true">×</span>
          </button>
        ))}
      </div>
      <div className="report-fields report-filter-fields">
        <label>
          Campo del filtro
          <select
            value={field ?? ''}
            onChange={(event) => {
              setSelected(event.target.value as ReportFilter['field']);
              setValue('');
              setUpper('');
              setMany([]);
              setOperator('eq');
            }}
          >
            {allowed.map((key) => (
              <option key={key} value={key}>
                {fields[key]}
              </option>
            ))}
          </select>
        </label>
        <label>
          Operador
          <select
            value={op}
            onChange={(event) => {
              setOperator(event.target.value as Operator);
              setValue('');
              setMany([]);
            }}
          >
            {operators.map((key) => (
              <option key={key} value={key}>
                {operatorNames[key]}
              </option>
            ))}
          </select>
        </label>
        {op !== 'is_null' && (
          <label>
            Valor del filtro
            {field === 'con_devolucion' ? (
              <select value={value} onChange={(event) => setValue(event.target.value)}>
                <option value="">Seleccionar</option>
                <option value="true">Sí</option>
                <option value="false">No</option>
              </select>
            ) : options.length && (op === 'in' || op === 'not_in') ? (
              <select
                multiple
                size={3}
                value={many}
                onChange={(event) =>
                  setMany(Array.from(event.target.selectedOptions, (option) => option.value))
                }
              >
                {options.map((key) => (
                  <option key={key} value={key}>
                    {label(data, field, key)}
                  </option>
                ))}
              </select>
            ) : options.length && (op === 'eq' || op === 'neq') ? (
              <select value={value} onChange={(event) => setValue(event.target.value)}>
                <option value="">Seleccionar</option>
                {options.map((key) => (
                  <option key={key} value={key}>
                    {label(data, field, key)}
                  </option>
                ))}
              </select>
            ) : (
              <input
                type={dates.includes(field) ? 'date' : 'text'}
                value={value}
                placeholder={field === 'precio_unitario' ? 'Bs' : undefined}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </label>
        )}
        {op === 'between' && (
          <label>
            Valor máximo
            <input
              type={dates.includes(field) ? 'date' : 'text'}
              value={upper}
              onChange={(event) => setUpper(event.target.value)}
            />
          </label>
        )}
        <button
          type="button"
          className="secondary"
          disabled={!field || definition.filters.length >= 20}
          onClick={add}
        >
          Añadir filtro
        </button>
      </div>
      {error && (
        <p className="report-warning" role="alert">
          {error}
        </p>
      )}
    </fieldset>
  );
}
