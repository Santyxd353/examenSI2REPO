import { useState } from 'react';
import { Text, View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import type { AnalysisResult } from '@lumina/contracts';
import { Choice, ReportButton, ReportField } from '../reports/ReportsWorkspace';
import { analysisSlice } from './analysisResults';
const small = { color: '#617268', fontSize: 11, lineHeight: 17 } as const;
const heading = { fontWeight: '800', color: '#173e2a' } as const;
export function AnalysisResultView({ result }: { result: AnalysisResult }) {
  const [from, setFrom] = useState(result.period.from),
    [to, setTo] = useState(result.period.to),
    [location, setLocation] = useState(''),
    [channel, setChannel] = useState(''),
    [page, setPage] = useState(0);
  let selected: ReturnType<typeof analysisSlice> | null = null,
    error = '';
  try {
    selected = analysisSlice(result, { from, to, location, channel });
  } catch (reason) {
    error = (reason as Error).message;
  }
  const number = new Intl.NumberFormat('es-BO', { maximumFractionDigits: 4 });
  const max = Math.max(1, ...(selected?.forecast.map(([, value]) => value) ?? []));
  const points =
    selected?.forecast
      .map(
        ([, value], index) =>
          10 +
          (index * 300) / Math.max(1, selected!.forecast.length - 1) +
          ',' +
          (150 - (value / max) * 130),
      )
      .join(' ') ?? '';
  const variant = (id: string) => result.labels?.variants[id] ?? id;
  const place = (id: string) => result.labels?.locations[id] ?? id;
  return (
    <View style={{ gap: 11 }}>
      <Text style={heading}>
        {result.source === 'REAL' ? 'DATOS REALES DE LA TIENDA' : 'DEMOSTRACIÓN SINTÉTICA'}
      </Text>
      <Text style={small}>
        Corte: {new Date(result.asOf).toLocaleString('es-BO')}
        {'\n'}
        {result.period.from} — {result.period.to}
      </Text>
      {result.limitations.map((text, index) => (
        <Text key={index} style={small}>
          {text}
        </Text>
      ))}
      {result.dataset ? (
        <>
          <Text style={small}>Dataset: {number.format(result.dataset.rows)} filas</Text>
          {Object.entries(result.dataset.splits).map(([key, value]) => {
            const range = value as { from?: string; to?: string } | null;
            return range && typeof range === 'object' && range.from && range.to ? (
              <Text key={key} style={small}>
                {(
                  { train: 'Entrenamiento', validation: 'Validación', test: 'Prueba' } as Record<
                    string,
                    string
                  >
                )[key] ?? key}
                : {range.from} — {range.to}
              </Text>
            ) : null;
          })}
        </>
      ) : null}
      {result.model ? (
        <Text style={small}>
          {result.model.algorithm} · {result.model.version}
        </Text>
      ) : null}
      {result.metrics.length ? (
        <>
          <Text style={heading}>Evaluación del modelo completo</Text>
          <Text style={small}>
            Los filtros no recalculan estas métricas. MAE, RMSE y WAPE se comparan con una
            referencia estacional; un error menor es mejor.
          </Text>
          {result.metrics.map((metric, index) => (
            <View
              key={index}
              style={{ paddingVertical: 8, borderBottomWidth: 1, borderBottomColor: '#e3e9e0' }}
            >
              <Text style={small}>
                {metric.name} · {metric.partition === 'PRUEBA' ? 'Prueba' : 'Validación'} ·{' '}
                {metric.horizonDays} días · {metric.observations} observaciones
              </Text>
              <Text style={small}>
                Modelo:{' '}
                {metric.value === null ? 'N/A · ' + metric.reason : number.format(metric.value)} ·
                Referencia: {metric.baseline === null ? 'N/A' : number.format(metric.baseline)}
              </Text>
              {metric.value !== null &&
              metric.baseline !== null &&
              ['MAE', 'RMSE', 'WAPE'].includes(metric.name) ? (
                <Text style={small}>
                  {metric.value < metric.baseline
                    ? 'Menor error que la referencia.'
                    : 'Este modelo no mejora el error de referencia.'}
                </Text>
              ) : null}
            </View>
          ))}
        </>
      ) : null}
      <ReportField
        label="Desde (dentro del corte)"
        value={from}
        onChange={(value) => {
          setFrom(value);
          setPage(0);
        }}
      />
      <ReportField
        label="Hasta (dentro del corte)"
        value={to}
        onChange={(value) => {
          setTo(value);
          setPage(0);
        }}
      />
      <Choice
        items={[
          { id: '', label: 'Todas las ubicaciones' },
          ...result.locationIds.map((id) => ({ id, label: place(id) })),
        ]}
        value={location}
        onChange={(value) => {
          setLocation(value);
          setPage(0);
        }}
      />
      <Choice
        items={[
          { id: '', label: 'Todos los canales' },
          ...['APP', 'WEB', 'TIENDA'].map((id) => ({ id, label: id })),
        ]}
        value={channel}
        onChange={(value) => {
          setChannel(value);
          setPage(0);
        }}
      />
      {error ? <Text style={{ color: '#9a2e2e', fontSize: 11 }}>{error}</Text> : null}
      {selected?.forecast.length ? (
        <>
          <Text style={heading}>Pronóstico filtrado</Text>
          <Svg
            height={170}
            width="100%"
            viewBox="0 0 320 170"
            accessibilityLabel="Pronóstico por fecha"
          >
            <Polyline points={points} stroke="#315f48" strokeWidth={3} fill="none" />
          </Svg>
          {selected.forecast.map(([date, value]) => (
            <Text key={date} style={small}>
              {date}: {number.format(value)} unidades estimadas
            </Text>
          ))}
        </>
      ) : null}
      {selected && result.forecast.length && !selected.forecast.length ? (
        <Text style={small}>No hay observaciones de pronóstico para este segmento.</Text>
      ) : null}
      {selected?.suggestions.length ? (
        <>
          <Text style={heading}>Propuestas de reposición</Text>
          <Text style={small}>
            No modifican stock ni crean compras. Las fechas corresponden al corte de inventario de
            cada propuesta.
          </Text>
          {selected.suggestions.slice(0, 30).map((row, index) => (
            <View key={index}>
              <Text style={small}>
                {variant(row.variantId)} · {place(row.locationId)} · Sugerido:{' '}
                {row.suggestedQuantity}
              </Text>
              <Text style={small}>
                Disponible {row.available} · Seguridad {row.safetyStock} · Demanda en plazo{' '}
                {number.format(row.demandDuringLead)} · Entradas confirmadas {row.confirmedInbound}{' '}
                · Plazo {row.leadTimeDays} días ·{' '}
                {row.demandSource === 'FORECAST' ? 'Pronóstico' : 'Regla básica'} ·{' '}
                {row.inventoryAsOf}
              </Text>
              {row.limitations.map((text, i) => (
                <Text key={i} style={small}>
                  {text}
                </Text>
              ))}
            </View>
          ))}
          {selected.suggestions.length > 30 ? (
            <Text style={small}>
              Vista previa de 30 propuestas. El JSON contiene el resultado completo.
            </Text>
          ) : null}
        </>
      ) : null}
      {selected?.alerts.length ? (
        <>
          <Text style={heading}>Anomalías para revisión · {selected.alerts.length}</Text>
          <Text style={small}>
            Una alerta estadística requiere revisión; no constituye prueba de irregularidad.
          </Text>
          {selected.alerts.slice(page * 20, (page + 1) * 20).map((row, index) => (
            <Text key={index} style={small}>
              {row.date} · {variant(row.variantId)} · {place(row.locationId)} · {row.channel} ·
              Puntaje {number.format(row.score)} · Umbral {number.format(row.threshold)}
            </Text>
          ))}
          <ReportButton
            label="Página anterior de alertas"
            onPress={() => setPage((value) => Math.max(0, value - 1))}
            disabled={page === 0}
          />
          <ReportButton
            label="Siguiente página de alertas"
            onPress={() => setPage((value) => value + 1)}
            disabled={(page + 1) * 20 >= selected.alerts.length}
          />
        </>
      ) : null}
    </View>
  );
}
