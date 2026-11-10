import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, Line, Path, Polyline, Text as SvgText } from 'react-native-svg';
import type { ReportChart } from '../../../../api/src/report-dashboard';

const colors = [
  '#693952',
  '#2d7a70',
  '#b38042',
  '#516aa0',
  '#9470a5',
  '#5c8875',
  '#b96767',
  '#7794ae',
];
const names = {
  bar: 'Barras',
  line: 'Líneas',
  pie: 'Circular',
  donut: 'Dona',
  table: 'Tabla',
  kpi: 'Indicadores',
};
const fmt = (value: number) => value.toLocaleString('es-BO', { maximumFractionDigits: 2 });
export function QueryDashboard({ charts }: { charts: ReportChart[] }) {
  return (
    <View style={{ gap: 16 }}>
      {charts.map((chart) => (
        <ChartCard key={chart.id} chart={chart} />
      ))}
    </View>
  );
}
function ChartCard({ chart }: { chart: ReportChart }) {
  const [type, setType] = useState(chart.defaultType);
  const [controls, setControls] = useState(false);
  const [data, setData] = useState(false);
  const max = Math.max(1, ...chart.points.map((p) => Math.abs(p.value)));
  const min = Math.min(0, ...chart.points.map((p) => p.value));
  const total = chart.points.reduce((n, p) => n + p.value, 0);
  const negative = chart.points.some((p) => p.value < 0);
  const x = (i: number) => 64 + (i * 480) / Math.max(1, chart.points.length - 1);
  const y = (value: number) => 210 - ((value - min) / (max - min)) * 170;
  let angle = 0;
  return (
    <View style={s.card}>
      <Text style={s.heading}>{chart.title}</Text>
      <Text style={s.caption}>{chart.description || chart.unit}</Text>
      {chart.total !== undefined && type !== 'kpi' && (
        <View>
          <Text style={s.total}>{fmt(chart.total)}</Text>
          <Text style={s.caption}>{chart.unit} en el alcance consultado</Text>
        </View>
      )}
      {!chart.points.length ? (
        <Text>Sin registros con estos filtros.</Text>
      ) : type === 'kpi' ? (
        chart.points.map((p, i) => (
          <View key={i} style={s.stat}>
            <Text>{p.label}</Text>
            <Text style={s.total}>
              {fmt(p.value)} <Text style={s.caption}>{chart.unit}</Text>
            </Text>
          </View>
        ))
      ) : type === 'table' ? null : type === 'bar' ? (
        chart.points.map((p, i) => (
          <View key={i} style={{ gap: 6 }}>
            <View style={s.row}>
              <Text style={s.label}>{p.label}</Text>
              <Text style={s.value}>
                {fmt(p.value)} {chart.unit}
              </Text>
            </View>
            <View style={s.track}>
              <View
                style={{
                  height: 9,
                  width: `${(Math.abs(p.value) / max) * 100}%`,
                  backgroundColor: colors[i % colors.length],
                  borderRadius: 5,
                }}
              />
            </View>
          </View>
        ))
      ) : type === 'line' ? (
        <Svg width="100%" height={200} viewBox="0 0 600 264" accessibilityLabel={chart.title}>
          {[0, 0.5, 1].map((t) => (
            <ViewLine key={t} t={t} min={min} max={max} />
          ))}
          <Polyline
            fill="none"
            stroke="#693952"
            strokeWidth={3}
            points={chart.points.map((p, i) => x(i) + ',' + y(p.value)).join(' ')}
          />
          {chart.points.map((p, i) => (
            <Circle key={i} cx={x(i)} cy={y(p.value)} r={4} fill="#693952" />
          ))}
          {[0, chart.points.length - 1].map((i, j) => (
            <SvgText key={j} x={x(i)} y={244} fontSize={12} fill="#73818a" textAnchor="middle">
              {chart.points[i]?.label.slice(0, 18)}
            </SvgText>
          ))}
        </Svg>
      ) : total <= 0 ? (
        <Text>Los valores son cero en este período.</Text>
      ) : (
        <View>
          <Svg width="100%" height={210} viewBox="0 0 260 260" accessibilityLabel={chart.title}>
            {chart.points.map((p, i) => {
              const start = angle,
                slice = (p.value / total) * Math.PI * 2;
              angle += slice;
              if (type === 'donut')
                return (
                  <Circle
                    key={i}
                    cx={130}
                    cy={130}
                    r={96}
                    fill="none"
                    stroke={colors[i % colors.length]}
                    strokeWidth={34}
                    strokeDasharray={[(p.value / total) * 603.186, 603.186]}
                    strokeDashoffset={-start * 96}
                    rotation={-90}
                    origin="130,130"
                  />
                );
              return p.value === total ? (
                <Circle key={i} cx={130} cy={130} r={96} fill={colors[i % colors.length]} />
              ) : (
                <Path
                  key={i}
                  d={
                    'M130,130 L' +
                    (130 + 96 * Math.cos(start)) +
                    ',' +
                    (130 + 96 * Math.sin(start)) +
                    ' A96,96 0 ' +
                    (slice > Math.PI ? 1 : 0) +
                    ' 1 ' +
                    (130 + 96 * Math.cos(angle)) +
                    ',' +
                    (130 + 96 * Math.sin(angle)) +
                    ' Z'
                  }
                  fill={colors[i % colors.length]}
                />
              );
            })}
          </Svg>
          {chart.points.map((p, i) => (
            <View key={i} style={s.legend}>
              <View
                style={{
                  width: 9,
                  height: 9,
                  borderRadius: 5,
                  backgroundColor: colors[i % colors.length],
                }}
              />
              <Text style={s.label}>{p.label}</Text>
              <Text style={s.value}>
                {fmt(p.value)} · {((p.value / total) * 100).toFixed(1)}%
              </Text>
            </View>
          ))}
        </View>
      )}
      <Pressable accessibilityRole="button" onPress={() => setControls(!controls)}>
        <Text style={s.link}>Cambiar visualización · {names[type]}</Text>
      </Pressable>
      {controls && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(names).map(([key, label]) => (
            <Pressable
              key={key}
              accessibilityRole="button"
              disabled={negative && ['pie', 'donut'].includes(key)}
              onPress={() => setType(key as typeof type)}
              style={{
                padding: 10,
                backgroundColor: key === type ? '#693952' : '#f1ebee',
                borderRadius: 8,
              }}
            >
              <Text style={{ color: key === type ? 'white' : '#693952' }}>{label}</Text>
            </Pressable>
          ))}
        </View>
      )}
      {type !== 'kpi' && (
        <Pressable accessibilityRole="button" onPress={() => setData(!data)}>
          <Text style={s.link}>{data ? 'Ocultar' : 'Ver'} datos</Text>
        </Pressable>
      )}
      {(data || type === 'table') && (
        <ScrollView nestedScrollEnabled style={{ maxHeight: 230 }}>
          {chart.points.map((p, i) => (
            <View key={i} style={s.legend}>
              <Text style={s.label}>{p.label}</Text>
              <Text style={s.value}>
                {fmt(p.value)} {chart.unit}
              </Text>
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}
function ViewLine({ t, min, max }: { t: number; min: number; max: number }) {
  return (
    <>
      <Line x1={64} x2={544} y1={210 - t * 170} y2={210 - t * 170} stroke="#e9edef" />
      <SvgText x={54} y={214 - t * 170} fontSize={11} textAnchor="end" fill="#73818a">
        {fmt(min + t * (max - min))}
      </SvgText>
    </>
  );
}
const s = StyleSheet.create({
  card: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e4e8e7',
    borderRadius: 16,
    padding: 16,
    gap: 14,
    marginTop: 8,
  },
  heading: { fontSize: 18, fontWeight: '800', color: '#243c35' },
  caption: { fontSize: 11, lineHeight: 17, color: '#73818a' },
  total: { fontSize: 30, fontWeight: '800', color: '#693952' },
  row: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'space-between' },
  label: { flex: 1, color: '#40544d', fontSize: 12, lineHeight: 18 },
  value: { fontSize: 12, fontWeight: '700', color: '#324b42' },
  track: { height: 9, borderRadius: 5, backgroundColor: '#f1f3f2' },
  legend: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderColor: '#eff1f0',
  },
  link: { fontSize: 12, fontWeight: '600', color: '#693952', paddingVertical: 8 },
  stat: { padding: 12, borderRadius: 10, backgroundColor: '#f8f6f7' },
});
