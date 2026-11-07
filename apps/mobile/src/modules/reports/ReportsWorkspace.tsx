import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useNetworkState } from 'expo-network';
import { randomUUID } from 'expo-crypto';
import {
  BootstrapResponseSchema,
  ReportDatasetRequestSchema,
  ReportDatasetSchema,
  ReportDefinitionSchema,
  REPORT_DIMENSIONS,
  REPORT_FILTER_FIELDS,
  REPORT_METRICS,
  type ReportDataset,
  type ReportDefinition,
  type ReportFilter,
  type ReportGroup,
} from '@lumina/contracts';
import {
  applyCrossFilter,
  boliviaDate,
  executeReport,
  exportReportCsv,
  validateReport,
} from '@lumina/reporting';
import { api, captureSessionScope, isCurrentSessionScope } from '../../api';
import { ApiProblem } from '../../errors/ApiProblem';
import type { Identity } from '../../types';
import { bootstrapOfflineVault } from '../../offline/bootstrap';
import { openAdminWorkspace } from '../../offline/adminWorkspace';
import { sha256 } from '../../offline/nativeStorage';
import { readReportDataset } from './datasetDownload';
import { defaultMobileReport } from './reportDefaults';
import { reportLabels as labels } from './reportLabels';
import { displayReportValue, ReportChart } from './ReportChart';
import { ReportAssistant } from './ReportAssistant';
import { shareDslCsv } from './shareDslReport';

type Copy = { dataset: ReportDataset; definition: ReportDefinition; invalidated?: boolean };
const charts = { bar: 'Barras', line: 'Línea', area: 'Área', donut: 'Anillo', table: 'Tabla' };
const operations = {
  eq: 'Igual a',
  neq: 'Distinto de',
  in: 'Dentro de',
  not_in: 'Fuera de',
  gte: 'Mayor o igual',
  lte: 'Menor o igual',
  between: 'Entre',
  is_null: 'Sin dato',
};
export function Choice({
  items,
  value,
  onChange,
}: {
  items: { id: string; label: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  return (
    <ScrollView horizontal contentContainerStyle={s.choices}>
      {items.map((item) => (
        <Pressable
          key={item.id}
          accessibilityRole="button"
          accessibilityState={{ selected: value === item.id }}
          onPress={() => onChange(item.id)}
          style={[s.choice, value === item.id && s.selected]}
        >
          <Text style={value === item.id ? s.selectedText : s.small}>{item.label}</Text>
        </Pressable>
      ))}
    </ScrollView>
  );
}
export function ReportButton({
  label,
  onPress,
  disabled = false,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      disabled={disabled}
      onPress={onPress}
      style={[s.button, disabled && s.disabled]}
    >
      <Text style={s.buttonText}>{label}</Text>
    </Pressable>
  );
}
export function ReportField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <View style={{ gap: 5 }}>
      <Text style={s.label}>{label}</Text>
      <TextInput accessibilityLabel={label} value={value} onChangeText={onChange} style={s.input} />
    </View>
  );
}
export function ReportsWorkspace({ user }: { user: Identity }) {
  const network = useNetworkState(),
    online = network.isConnected !== false && network.isInternetReachable !== false;
  const [source, setSource] = useState<ReportDataset['source']>('REAL'),
    [from, setFrom] = useState(() =>
      boliviaDate(new Date(Date.now() - 29 * 86400000).toISOString()),
    ),
    [to, setTo] = useState(() => boliviaDate(new Date().toISOString()));
  const [data, setData] = useState<ReportDataset | null>(null),
    [draft, setDraft] = useState<ReportDefinition | null>(null),
    [applied, setApplied] = useState<ReportDefinition | null>(null);
  const [busy, setBusy] = useState(''),
    [error, setError] = useState(''),
    [message, setMessage] = useState(''),
    [aiEnabled, setAiEnabled] = useState(false);
  const [cross, setCross] = useState<{
    dimension: ReportDefinition['dimensions'][number];
    value: string;
  } | null>(null);
  const life = useRef<AbortController | null>(null),
    working = useRef(false);
  const current = () => Boolean(life.current && !life.current.signal.aborted);
  useEffect(() => {
    const controller = new AbortController();
    life.current = controller;
    const session = captureSessionScope();
    void (async () => {
      const work = await openAdminWorkspace();
      const cached = await work.records.get<Copy>(work.scope, 'report-dsl', 'current');
      const boot = await work.records.get(work.scope, 'bootstrap', 'current');
      if (controller.signal.aborted || !isCurrentSessionScope(session)) return;
      if (boot) {
        const value = BootstrapResponseSchema.parse(boot.value);
        setAiEnabled(
          value.entitlements.features.aiReports &&
            !value.entitlements.readOnly &&
            Date.now() < Date.parse(value.entitlements.periodTo),
        );
      }
      if (!cached) return;
      if (cached.value.invalidated)
        throw new Error('La autorización del corte cambió. Descarga un conjunto nuevo.');
      const dataset = ReportDatasetSchema.parse(cached.value.dataset),
        definition = ReportDefinitionSchema.parse(cached.value.definition);
      if (dataset.tenantId !== work.scope.tenantId || dataset.ownerId !== work.scope.actorId)
        throw new Error('El reporte pertenece a otra cuenta.');
      try {
        await api('/reports/datasets/' + dataset.datasetId, { signal: controller.signal });
      } catch (reason) {
        if (!ApiProblem.isNetwork(reason)) {
          if (
            !controller.signal.aborted &&
            reason instanceof ApiProblem &&
            [401, 403, 404, 410].includes(reason.status)
          )
            await work.records.put(work.scope, 'report-dsl', 'current', {
              ...cached.value,
              invalidated: true,
            });
          throw reason;
        }
      }
      if (controller.signal.aborted || !isCurrentSessionScope(session)) return;
      setData(dataset);
      setDraft(definition);
      setApplied(definition);
      setSource(dataset.source);
      setFrom(dataset.periodFrom);
      setTo(dataset.periodTo);
      setMessage('Copia descargada: ' + new Date(dataset.asOf).toLocaleString('es-BO'));
    })().catch((reason) => {
      if (!controller.signal.aborted && isCurrentSessionScope(session))
        setError((reason as Error).message);
    });
    return () => {
      controller.abort();
      life.current = null;
    };
  }, [user]);
  const run = async (label: string, work: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(label);
    setError('');
    setMessage('');
    const session = captureSessionScope();
    try {
      await work();
    } catch (reason) {
      if (current() && isCurrentSessionScope(session)) setError((reason as Error).message);
    } finally {
      working.current = false;
      if (current() && isCurrentSessionScope(session)) setBusy('');
    }
  };
  const download = () =>
    run('Descargando corte…', async () => {
      await bootstrapOfflineVault(user);
      const work = await openAdminWorkspace(),
        session = captureSessionScope();
      const check = () => {
        work.check();
        if (!current() || !isCurrentSessionScope(session)) throw new Error('La sesión cambió.');
      };
      const input = ReportDatasetRequestSchema.parse(
        source === 'REAL' ? { source, period: { from, to, inclusive: true } } : { source },
      );
      const manifest = await api<unknown>('/reports/datasets', {
        method: 'POST',
        body: JSON.stringify(input),
        signal: life.current?.signal,
      });
      check();
      const dataset = await readReportDataset(work.scope, manifest, {
        digest: sha256,
        guard: check,
        get: (id, offset) =>
          api('/reports/datasets/' + id + '/rows?offset=' + offset + '&pageSize=500', {
            signal: life.current?.signal,
          }),
        progress: (loaded, total) => {
          if (current()) setBusy('Descargando ' + loaded + ' / ' + total + ' filas');
        },
      });
      check();
      const definition = defaultMobileReport(dataset);
      await work.records.put(work.scope, 'report-dsl', 'current', { dataset, definition });
      check();
      const boot = await work.records.get(work.scope, 'bootstrap', 'current');
      check();
      if (boot) {
        const value = BootstrapResponseSchema.parse(boot.value);
        setAiEnabled(value.entitlements.features.aiReports && !value.entitlements.readOnly);
      }
      setData(dataset);
      setDraft(definition);
      setApplied(definition);
      setCross(null);
      setFrom(dataset.periodFrom);
      setTo(dataset.periodTo);
      setMessage('Conjunto verificado y guardado para trabajar sin conexión.');
    });
  const evaluated = useMemo(() => {
    if (!data || !applied) return { result: null, error: '' };
    try {
      return { result: executeReport(applyCrossFilter(applied, cross), data), error: '' };
    } catch (error) {
      return { result: null, error: (error as Error).message };
    }
  }, [data, applied, cross]);
  const apply = () => {
    if (!draft || !data) return;
    try {
      const parsed = ReportDefinitionSchema.parse(draft),
        valid = validateReport(parsed, data);
      if (!valid.ok) throw new Error(valid.problems.map((row) => row.message).join(' '));
      setApplied(parsed);
      setCross(null);
      setError('');
      setMessage('Reporte aplicado al corte descargado.');
    } catch (reason) {
      setError((reason as Error).message);
    }
  };
  const saveOffline = () =>
    run('Guardando copia…', async () => {
      if (!data || !applied) return;
      const work = await openAdminWorkspace();
      await work.records.put(work.scope, 'report-dsl', 'current', {
        dataset: data,
        definition: applied,
      });
      if (current())
        setMessage('Dashboard y filtros guardados cifrados para reabrir sin conexión.');
    });
  const select = (group: ReportGroup) => {
    const [dimension, value] = Object.entries(group.dimensions)[0] ?? [];
    if (dimension && typeof value === 'string')
      setCross({ dimension: dimension as ReportDefinition['dimensions'][number], value });
  };
  const output = evaluated.result;
  return (
    <View style={{ gap: 14 }}>
      <View style={s.card}>
        <Text style={s.title}>Conjunto de datos</Text>
        <Choice
          items={[
            { id: 'REAL', label: 'Datos reales' },
            { id: 'DEMOSTRACION_SINTETICA', label: 'Demostración sintética' },
          ]}
          value={source}
          onChange={(value) => setSource(value as typeof source)}
        />
        <ReportField label="Desde (AAAA-MM-DD)" value={from} onChange={setFrom} />
        <ReportField label="Hasta (AAAA-MM-DD)" value={to} onChange={setTo} />
        <ReportButton
          label="Descargar y verificar datos"
          onPress={() => void download()}
          disabled={!!busy || !online}
        />
        <Text style={s.small}>
          {online ? 'Con conexión' : 'Sin conexión: usa el último corte descargado y sus filtros.'}
        </Text>
        {data ? (
          <Text style={s.small}>
            {data.source === 'REAL'
              ? 'DATOS REALES'
              : 'DEMOSTRACIÓN SINTÉTICA · No representa ventas reales'}
            {'\n'}Corte: {new Date(data.asOf).toLocaleString('es-BO')} · {data.rowCount} filas ·{' '}
            {data.complete
              ? 'Cobertura completa'
              : 'Cobertura parcial: ' + data.omittedCoverage.join(', ')}
          </Text>
        ) : null}
      </View>
      {busy ? (
        <View>
          <ActivityIndicator color="#173e2a" />
          <Text style={s.small}>{busy}</Text>
        </View>
      ) : null}
      {error || evaluated.error ? (
        <Text accessibilityRole="alert" style={s.error}>
          {error || evaluated.error}
        </Text>
      ) : null}
      {message ? <Text style={s.notice}>{message}</Text> : null}
      {data && draft ? (
        <>
          <View style={s.card}>
            <Text style={s.title}>Diseñar reporte</Text>
            <ReportField
              label="Título del reporte"
              value={draft.title}
              onChange={(title) => setDraft({ ...draft, title })}
            />
            <Choice
              items={[
                { id: 'ventas_confirmadas', label: 'Ventas confirmadas' },
                { id: 'stock_al_corte', label: 'Inventario al corte' },
              ]}
              value={draft.fact}
              onChange={(fact) => setDraft(defaultMobileReport(data, fact === 'stock_al_corte'))}
            />
            <ReportField
              label="Período desde"
              value={draft.period.from}
              onChange={(from) => setDraft({ ...draft, period: { ...draft.period, from } })}
            />
            <ReportField
              label="Período hasta"
              value={draft.period.to}
              onChange={(to) => setDraft({ ...draft, period: { ...draft.period, to } })}
            />
            <Text style={s.label}>Indicadores</Text>
            <View style={s.wrap}>
              {REPORT_METRICS.filter(
                (metric) => metric.endsWith('_al_corte') === (draft.fact === 'stock_al_corte'),
              ).map((metric) => (
                <Toggle
                  key={metric}
                  label={labels[metric]!}
                  active={draft.metrics.includes(metric)}
                  onPress={() =>
                    setDraft({
                      ...draft,
                      metrics: draft.metrics.includes(metric)
                        ? draft.metrics.filter((item) => item !== metric)
                        : [...draft.metrics, metric],
                    })
                  }
                />
              ))}
            </View>
            <Text style={s.label}>Agrupar por (hasta cinco)</Text>
            <View style={s.wrap}>
              {REPORT_DIMENSIONS.filter(
                (field) =>
                  data.availableColumns.includes(field) &&
                  (draft.fact !== 'stock_al_corte' ||
                    [
                      'ubicacion',
                      'categoria',
                      'marca',
                      'producto',
                      'variante',
                      'talla',
                      'color',
                    ].includes(field)),
              ).map((field) => (
                <Toggle
                  key={field}
                  label={labels[field]!}
                  active={draft.dimensions.includes(field)}
                  onPress={() =>
                    setDraft({
                      ...draft,
                      dimensions: draft.dimensions.includes(field)
                        ? draft.dimensions.filter((item) => item !== field)
                        : [...draft.dimensions, field].slice(0, 5),
                      order: [],
                    })
                  }
                />
              ))}
            </View>
            <Choice
              items={Object.entries(charts).map(([id, label]) => ({ id, label }))}
              value={draft.chart}
              onChange={(chart) => setDraft({ ...draft, chart: chart as typeof draft.chart })}
            />
            <ReportField
              label="Máximo de grupos (1 a 1000)"
              value={String(draft.limit)}
              onChange={(value) => setDraft({ ...draft, limit: Number(value) })}
            />
            <Choice
              items={[
                { id: 'none', label: 'Orden natural' },
                { id: 'desc', label: 'Mayor indicador primero' },
                { id: 'asc', label: 'Menor indicador primero' },
              ]}
              value={
                draft.order[0] && 'metric' in draft.order[0] ? draft.order[0].direction : 'none'
              }
              onChange={(value) =>
                setDraft({
                  ...draft,
                  order:
                    value === 'none' || !draft.metrics[0]
                      ? []
                      : [{ metric: draft.metrics[0], direction: value as 'asc' | 'desc' }],
                })
              }
            />
            {draft.fact === 'ventas_confirmadas' ? (
              <>
                <ReportButton
                  label={draft.comparison ? 'Quitar comparación' : 'Comparar con otro período'}
                  onPress={() =>
                    setDraft({
                      ...draft,
                      comparison: draft.comparison
                        ? undefined
                        : {
                            from: data.periodFrom,
                            to: data.periodTo,
                            mode: 'custom',
                            requiresCoverage: true,
                          },
                    })
                  }
                />
                {draft.comparison ? (
                  <>
                    <ReportField
                      label="Comparación desde"
                      value={draft.comparison.from}
                      onChange={(from) =>
                        setDraft({ ...draft, comparison: { ...draft.comparison!, from } })
                      }
                    />
                    <ReportField
                      label="Comparación hasta"
                      value={draft.comparison.to}
                      onChange={(to) =>
                        setDraft({ ...draft, comparison: { ...draft.comparison!, to } })
                      }
                    />
                  </>
                ) : null}
              </>
            ) : null}
          </View>
          <FilterEditor data={data} draft={draft} change={setDraft} reportError={setError} />
          <View style={s.card}>
            <Text style={s.title}>Gráficos del dashboard</Text>
            <Text style={s.small}>
              Agrega gráficos con la métrica, agrupación y estilo seleccionados. Cada gráfico
              permite filtrar el dashboard.
            </Text>
            <ReportButton
              label="Agregar gráfico"
              disabled={
                !draft.dimensions[0] || !draft.metrics[0] || draft.dashboard.widgets.length >= 16
              }
              onPress={() =>
                setDraft({
                  ...draft,
                  dashboard: {
                    ...draft.dashboard,
                    widgets: [
                      ...draft.dashboard.widgets,
                      {
                        id: randomUUID(),
                        chart: draft.chart,
                        dimension: draft.dimensions[0]!,
                        metric: draft.metrics[0]!,
                      },
                    ],
                  },
                })
              }
            />
            {draft.dashboard.widgets.map((widget) => (
              <Pressable
                key={widget.id}
                accessibilityRole="button"
                onPress={() =>
                  setDraft({
                    ...draft,
                    dashboard: {
                      ...draft.dashboard,
                      widgets: draft.dashboard.widgets.filter((row) => row.id !== widget.id),
                    },
                  })
                }
              >
                <Text style={s.small}>
                  {labels[widget.metric]} por {labels[widget.dimension]} · {charts[widget.chart]} ·
                  Quitar
                </Text>
              </Pressable>
            ))}
            <ReportButton label="Aplicar filtros y dashboard" onPress={apply} />
            {JSON.stringify(draft) !== JSON.stringify(applied) ? (
              <Text style={s.notice}>
                Hay cambios pendientes de aplicar. Revisa los filtros antes de actualizar el
                dashboard.
              </Text>
            ) : null}
          </View>
          <ReportAssistant
            key={data.datasetId}
            dataset={data}
            enabled={online && aiEnabled}
            review={(definition) => {
              setDraft(definition);
              setMessage('Propuesta en los filtros. Revisa sus valores y pulsa Aplicar.');
            }}
          />
        </>
      ) : null}
      {output && data && applied ? (
        <View style={s.card}>
          <Text style={s.title}>{applied.title}</Text>
          <Text style={s.small}>
            {output.source === 'REAL' ? 'DATOS REALES' : 'DEMOSTRACIÓN SINTÉTICA'} · Corte{' '}
            {output.asOf}
          </Text>
          <View style={s.wrap}>
            {Object.entries(output.kpis).map(([metric, value]) => (
              <View key={metric} style={s.kpi}>
                <Text style={s.small}>{labels[metric] ?? metric}</Text>
                <Text style={s.kpiValue}>{displayReportValue(value)}</Text>
                {value?.reason ? <Text style={s.small}>{value.reason}</Text> : null}
                {output.comparison ? (
                  <Text style={s.small}>
                    Comparación:{' '}
                    {displayReportValue(output.comparison.kpis[metric as keyof typeof output.kpis])}
                  </Text>
                ) : null}
              </View>
            ))}
          </View>
          {output.warnings.map((warning, index) => (
            <Text key={index} style={s.notice}>
              {warning}
            </Text>
          ))}
          {cross ? (
            <ReportButton label="Quitar filtro del gráfico" onPress={() => setCross(null)} />
          ) : null}
          <ReportChart groups={output.groups} definition={applied} data={data} select={select} />
          {output.widgets?.map((widget) => {
            const design = applied.dashboard.widgets.find((item) => item.id === widget.id)!;
            return (
              <View key={widget.id}>
                <Text style={s.label}>
                  {labels[design.metric]} por {labels[design.dimension]}
                </Text>
                <ReportChart
                  groups={widget.groups}
                  data={data}
                  definition={{
                    ...applied,
                    chart: design.chart,
                    dimensions: [design.dimension],
                    metrics: [design.metric],
                  }}
                  select={select}
                />
              </View>
            );
          })}
          <Text style={s.label}>Detalle · {output.detail.total} filas</Text>
          {output.detail.rows.slice(0, 20).map((row, index) => (
            <Text key={index} style={s.small}>
              {Object.entries(row)
                .map(
                  ([key, value]) =>
                    (labels[key] ?? key) +
                    ': ' +
                    String(
                      typeof value === 'string'
                        ? ((data.labels as Record<string, Record<string, string>> | undefined)?.[
                            key
                          ]?.[value] ?? value)
                        : (value ?? 'Sin dato'),
                    ),
                )
                .join(' · ')}
            </Text>
          ))}
          {output.detail.total > 20 ? (
            <Text style={s.small}>
              Vista previa de 20 filas. Exporta CSV para revisar el detalle disponible.
            </Text>
          ) : null}
          <ReportButton
            label="Guardar dashboard para offline"
            onPress={() => void saveOffline()}
            disabled={!!busy}
          />
          <ReportButton
            label="Compartir CSV del reporte"
            onPress={() => void run('Exportando…', () => shareDslCsv(exportReportCsv(output)))}
            disabled={!!busy}
          />
        </View>
      ) : null}
    </View>
  );
}
function Toggle({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked: active }}
      onPress={onPress}
      style={[s.choice, active && s.selected]}
    >
      <Text style={active ? s.selectedText : s.small}>{label}</Text>
    </Pressable>
  );
}
function FilterEditor({
  data,
  draft,
  change,
  reportError,
}: {
  data: ReportDataset;
  draft: ReportDefinition;
  change: (definition: ReportDefinition) => void;
  reportError: (message: string) => void;
}) {
  const [field, setField] = useState<ReportFilter['field']>('canal'),
    [operator, setOperator] = useState<ReportFilter['operator']>('eq'),
    [value, setValue] = useState('');
  const allowed = REPORT_FILTER_FIELDS.filter(
    (field) =>
      data.availableColumns.includes(field) ||
      [
        'periodo',
        'periodo_comparacion',
        'con_devolucion',
        'precio_unitario',
        'disponible_al_corte',
      ].includes(field),
  );
  const names = data.labels as Record<string, Record<string, string>> | undefined;
  const options = [
    ...new Set(
      [...data.sales, ...data.stock]
        .map((row) => (row.dimensions as Record<string, string | null>)[field])
        .filter((value): value is string => typeof value === 'string'),
    ),
  ].slice(0, 50);
  const add = () => {
    try {
      const scalar = (text: string): string | number | boolean =>
        ['precio_unitario', 'disponible_al_corte'].includes(field)
          ? Number(text)
          : field === 'con_devolucion'
            ? text === 'true'
            : text;
      const filter: ReportFilter = {
        field,
        operator,
        ...(operator === 'is_null'
          ? {}
          : {
              value: ['in', 'not_in', 'between'].includes(operator)
                ? value.split(',').map((item) => scalar(item.trim()))
                : scalar(value.trim()),
            }),
      };
      const parsed = ReportDefinitionSchema.parse({
        ...draft,
        filters: [...draft.filters, filter],
      });
      change(parsed);
      setValue('');
      reportError('');
    } catch (error) {
      reportError((error as Error).message);
    }
  };
  return (
    <View style={s.card}>
      <Text style={s.title}>Filtros personalizados</Text>
      <Text style={s.small}>
        Hasta veinte filtros simultáneos. Las listas y los rangos aceptan valores separados por
        coma. Los precios usan centavos de boliviano.
      </Text>
      <Choice
        items={allowed.map((id) => ({ id, label: labels[id] ?? id }))}
        value={field}
        onChange={(id) => {
          setField(id as typeof field);
          setValue('');
        }}
      />
      <Choice
        items={Object.entries(operations).map(([id, label]) => ({ id, label }))}
        value={operator}
        onChange={(id) => setOperator(id as typeof operator)}
      />
      {field === 'con_devolucion' ? (
        <Choice
          items={[
            { id: 'true', label: 'Con devolución' },
            { id: 'false', label: 'Sin devolución' },
          ]}
          value={value}
          onChange={setValue}
        />
      ) : null}
      {options.length ? (
        <Choice
          items={options.map((id) => ({ id, label: names?.[field]?.[id] ?? id }))}
          value={value}
          onChange={(id) =>
            setValue(
              ['in', 'not_in', 'between'].includes(operator)
                ? [value, id].filter(Boolean).join(',')
                : id,
            )
          }
        />
      ) : null}
      {operator !== 'is_null' ? (
        <ReportField label="Valor del filtro" value={value} onChange={setValue} />
      ) : null}
      <ReportButton label="Agregar filtro" onPress={add} disabled={draft.filters.length >= 20} />
      {draft.filters.map((filter, index) => (
        <Pressable
          key={index}
          accessibilityRole="button"
          onPress={() => change({ ...draft, filters: draft.filters.filter((_, i) => i !== index) })}
        >
          <Text style={s.notice}>
            {labels[filter.field]} · {operations[filter.operator]} ·{' '}
            {Array.isArray(filter.value) ? filter.value.join(',') : String(filter.value ?? '')} ·
            Quitar
          </Text>
        </Pressable>
      ))}
    </View>
  );
}
const s = StyleSheet.create({
  card: {
    gap: 12,
    padding: 15,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#dce4da',
    borderRadius: 15,
  },
  title: { fontSize: 16, color: '#173e2a', fontWeight: '900' },
  small: { fontSize: 11, lineHeight: 17, color: '#617268' },
  label: { fontSize: 12, color: '#294332', fontWeight: '800' },
  input: {
    minHeight: 44,
    borderWidth: 1,
    borderColor: '#dce4da',
    borderRadius: 9,
    padding: 10,
    color: '#294332',
  },
  choices: { gap: 8 },
  wrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  choice: { padding: 10, borderRadius: 10, borderWidth: 1, borderColor: '#dce4da' },
  selected: { backgroundColor: '#173e2a' },
  selectedText: { fontSize: 11, color: '#fff' },
  button: {
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#173e2a',
    alignSelf: 'flex-start',
    minHeight: 44,
  },
  buttonText: { color: '#fff', fontSize: 11, fontWeight: '800' },
  disabled: { opacity: 0.4 },
  notice: {
    padding: 10,
    color: '#46634b',
    backgroundColor: '#eef5ed',
    borderRadius: 8,
    fontSize: 11,
    lineHeight: 17,
  },
  error: {
    padding: 12,
    color: '#9a2e2e',
    backgroundColor: '#fff0ec',
    fontSize: 11,
    borderRadius: 8,
  },
  kpi: { padding: 12, backgroundColor: '#f0f6ed', borderRadius: 10, minWidth: 130, flexGrow: 1 },
  kpiValue: { fontSize: 22, color: '#173e2a', fontWeight: '900' },
});
