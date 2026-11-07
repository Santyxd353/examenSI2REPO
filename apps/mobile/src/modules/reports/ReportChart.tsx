import { Pressable, Text, View } from 'react-native';
import Svg, { Circle, Path, Polyline, Rect } from 'react-native-svg';
import type { ReportDataset, ReportDefinition, ReportGroup, ReportValue } from '@lumina/contracts';

export function displayReportValue(value: ReportValue | undefined) {
  if (!value || value.value === null) return 'N/A';
  return value.unit === 'CENTAVOS' ? 'Bs ' + (value.value / 100).toFixed(2) : String(value.value);
}
export function groupTitle(group: ReportGroup, data: ReportDataset) {
  const labels = data.labels as Record<string, Record<string, string>> | undefined;
  return (
    Object.entries(group.dimensions)
      .map(([key, value]) => (value === null ? 'Sin dato' : (labels?.[key]?.[value] ?? value)))
      .join(' · ') || 'Total'
  );
}
export function ReportChart({
  groups,
  definition,
  data,
  select,
}: {
  groups: ReportGroup[];
  definition: ReportDefinition;
  data: ReportDataset;
  select: (group: ReportGroup) => void;
}) {
  const metric = definition.metrics[0]!,
    visible = groups.slice(0, 12),
    values = visible.map((row) => Math.max(0, row.metrics[metric]?.value ?? 0)),
    max = Math.max(...values, 1),
    total = values.reduce((a, b) => a + b, 0);
  const colors = ['#315f48', '#ce9a86', '#7898a2', '#bd8c42', '#926f9d', '#6b8478'];
  let angle = 0;
  return (
    <View style={{ gap: 9 }}>
      {definition.chart === 'line' || definition.chart === 'area' ? (
        <Svg
          width="100%"
          height={170}
          viewBox="0 0 320 170"
          accessibilityLabel="Evolución de los grupos del reporte"
        >
          {definition.chart === 'area' && values.length > 0 ? (
            <Path
              d={
                'M 10 155 ' +
                values
                  .map(
                    (value, index) =>
                      'L ' +
                      (10 + (index * 300) / Math.max(1, values.length - 1)) +
                      ' ' +
                      (155 - (value / max) * 140),
                  )
                  .join(' ') +
                ' L 310 155 Z'
              }
              fill="#dceade"
            />
          ) : null}
          <Polyline
            points={values
              .map(
                (value, index) =>
                  10 +
                  (index * 300) / Math.max(1, values.length - 1) +
                  ',' +
                  (155 - (value / max) * 140),
              )
              .join(' ')}
            fill="none"
            stroke="#315f48"
            strokeWidth={3}
          />
          {visible.map((group, index) => (
            <Circle
              key={group.key}
              cx={10 + (index * 300) / Math.max(1, values.length - 1)}
              cy={155 - (values[index]! / max) * 140}
              r={6}
              fill="#315f48"
              onPress={() => select(group)}
            />
          ))}
        </Svg>
      ) : definition.chart === 'donut' ? (
        <Svg
          width="100%"
          height={180}
          viewBox="0 0 320 180"
          accessibilityLabel="Participación por grupo"
        >
          <Circle cx={160} cy={90} r={62} fill="none" stroke="#e3eae4" strokeWidth={26} />
          {visible.map((group, index) => {
            const fraction = total ? values[index]! / total : 0,
              start = angle;
            angle += fraction * 360;
            return (
              <Circle
                key={group.key}
                cx={160}
                cy={90}
                r={62}
                fill="none"
                stroke={colors[index % colors.length]}
                strokeWidth={26}
                strokeDasharray={`${fraction * 389.557} 389.557`}
                transform={`rotate(${start - 90} 160 90)`}
                onPress={() => select(group)}
              />
            );
          })}
        </Svg>
      ) : definition.chart === 'bar' ? (
        <Svg width="100%" height={180} viewBox="0 0 320 180" accessibilityLabel="Barras por grupo">
          {visible.map((group, index) => (
            <Rect
              key={group.key}
              x={(index * 320) / Math.max(1, visible.length) + 3}
              y={165 - (values[index]! / max) * 145}
              width={Math.max(2, 320 / Math.max(1, visible.length) - 6)}
              height={(values[index]! / max) * 145}
              fill={colors[index % colors.length]}
              onPress={() => select(group)}
            />
          ))}
        </Svg>
      ) : null}
      {visible.map((group) => (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={'Filtrar ' + groupTitle(group, data)}
          key={group.key}
          onPress={() => select(group)}
          style={{ borderBottomWidth: 1, borderBottomColor: '#e8ece7', paddingVertical: 9 }}
        >
          <Text style={{ fontSize: 12, color: '#294332', fontWeight: '700' }}>
            {groupTitle(group, data)}
          </Text>
          <Text style={{ fontSize: 11, color: '#617268' }}>
            {definition.metrics.map((key) => displayReportValue(group.metrics[key])).join(' · ')}
          </Text>
        </Pressable>
      ))}
      {groups.length > 12 ? (
        <Text style={{ fontSize: 10, color: '#617268' }}>
          Se muestran los primeros 12 grupos. Usa los filtros para ver otros segmentos.
        </Text>
      ) : null}
    </View>
  );
}
