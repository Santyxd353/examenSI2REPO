import { useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';
import Svg, { Circle, Polyline, Rect } from 'react-native-svg';
import type { ReportChart } from '../../../../api/src/report-dashboard';

export function QueryDashboard({ charts }: { charts: ReportChart[] }) {
  const [selected, select] = useState(charts[0]?.id);
  const [kind, setKind] = useState<ReportChart['defaultType'] | null>(null);
  const chart = charts.find((item) => item.id === selected) || charts[0];
  if (!chart) return null;
  const type = kind || chart.defaultType;
  const max = Math.max(1, ...chart.points.map((p) => Math.abs(p.value)));
  const min = Math.min(0, ...chart.points.map(p => p.value));
  const total = chart.points.reduce((sum, p) => sum + p.value, 0);
  const colors = ['#703951', '#286b61', '#a96a34', '#526aa3', '#8a5798'];
  let offset = 0;
  return (
    <View style={{ gap: 12, marginTop: 12 }}>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
        {charts.map((item) => (
          <Pressable
            key={item.id}
            accessibilityRole="button"
            accessibilityState={{ selected: item.id === chart.id }}
            onPress={() => {
              select(item.id);
              setKind(null);
            }}
            style={{
              padding: 10,
              borderRadius: 8,
              backgroundColor: item.id === chart.id ? '#703951' : '#eee7eb',
            }}
          >
            <Text style={{ color: item.id === chart.id ? '#fff' : '#503040', fontSize: 12 }}>
              {item.title}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={{ fontWeight: '700' }}>
        {chart.title} · {chart.unit}
      </Text>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
        {(['bar', 'line', 'donut'] as const).map((item, i) => (
          <Pressable
            key={item}
            accessibilityRole="button"
            accessibilityState={{ selected: type === item }}
            disabled={item === 'donut' && chart.points.some((p) => p.value < 0)}
            onPress={() => setKind(item)}
            style={{
              padding: 10,
              borderWidth: 1,
              borderColor: type === item ? '#703951' : '#ddd',
              borderRadius: 8,
            }}
          >
            <Text>{['Barras', 'Líneas', 'Dona'][i]}</Text>
          </Pressable>
        ))}
      </View>
      {!chart.points.length || chart.points.every((p) => p.value === 0) ? (
        <Text>Sin datos para graficar en este período.</Text>
      ) : (
        <Svg width="100%" height={200} viewBox="0 0 600 230" accessibilityLabel={chart.title}>
          {type === 'line' && (
            <>
              <Polyline
                fill="none"
                stroke="#703951"
                strokeWidth={3}
                points={chart.points
                  .map(
                    (p, i) =>
                      30 +
                      (i * 540) / Math.max(1, chart.points.length - 1) +
                      ',' +
                      (200 - ((p.value - min) / (max - min)) * 170),
                  )
                  .join(' ')}
              />
              {chart.points.length === 1 && (
                <Circle
                  cx={30}
                  cy={200 - ((chart.points[0]!.value - min) / (max - min)) * 170}
                  r={4}
                  fill="#703951"
                />
              )}
            </>
          )}
          {type === 'bar' &&
            chart.points.map((p, i) => (
              <Rect
                key={i}
                x={30 + (i * 540) / chart.points.length}
                y={p.value < 0 ? 110 : 110 - (p.value / max) * 95}
                width={Math.max(1, 540 / chart.points.length - 4)}
                height={(Math.abs(p.value) / max) * 95}
                fill={colors[i % colors.length]}
              />
            ))}
          {type === 'donut' &&
            total > 0 &&
            chart.points.map((p, i) => {
              const length = (p.value / total) * 502.65;
              const start = offset;
              offset += length;
              return (
                <Circle
                  key={i}
                  cx={300}
                  cy={115}
                  r={80}
                  fill="none"
                  stroke={colors[i % colors.length]}
                  strokeWidth={40}
                  strokeDasharray={[length, 502.65 - length]}
                  strokeDashoffset={-start}
                  rotation={-90}
                  origin="300,115"
                />
              );
            })}
        </Svg>
      )}
      <ScrollView
        style={{ maxHeight: 190 }}
        nestedScrollEnabled
        accessibilityLabel="Valores del gráfico"
      >
        {chart.points.map((p, i) => (
          <View
            key={i}
            style={{ paddingVertical: 7, borderBottomWidth: 1, borderColor: '#eee', gap: 3 }}
          >
            <Text style={{ fontSize: 11 }}>{p.label}</Text>
            <Text style={{ fontWeight: '700', color: '#703951' }}>
              {p.value.toLocaleString('es-BO', { maximumFractionDigits: 2 })} {chart.unit}
            </Text>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}
