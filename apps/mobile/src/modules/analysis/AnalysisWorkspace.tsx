import { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, Text, View } from 'react-native';
import { useNetworkState } from 'expo-network';
import { randomUUID } from 'expo-crypto';
import {
  AnalysisJobViewSchema,
  AnalysisRequestSchema,
  BootstrapResponseSchema,
  canonicalJson,
  type AnalysisJobView,
  type AnalysisRequest,
  type Entitlements,
} from '@lumina/contracts';
import { api, captureSessionScope, isCurrentSessionScope } from '../../api';
import type { Identity } from '../../types';
import { ApiProblem } from '../../errors/ApiProblem';
import { bootstrapOfflineVault } from '../../offline/bootstrap';
import { openAdminWorkspace } from '../../offline/adminWorkspace';
import { Choice, ReportButton } from '../reports/ReportsWorkspace';
import { shareDslJson } from '../reports/shareDslReport';
import { checkedAnalysisCopy,parseAnalysisJobs } from './analysisResults';
import { AnalysisResultView } from './AnalysisResultView';

const actions: Record<AnalysisRequest['action'], string> = {
  GENERATE_DATASET: 'Preparar demostración',
  TRAIN_DEMAND: 'Entrenar demanda',
  TRAIN_ANOMALY: 'Entrenar anomalías',
  FORECAST: 'Generar pronóstico',
  SUGGEST_RESTOCK: 'Proponer reposición',
};
const states: Record<AnalysisJobView['status'], string> = {
  QUEUED: 'En cola',
  RUNNING: 'Procesando',
  COMPLETED: 'Completado',
  FAILED: 'Falló',
  INSUFFICIENT_DATA: 'Historial insuficiente',
};
const card = {
  gap: 11,
  padding: 15,
  backgroundColor: '#fff',
  borderRadius: 14,
  borderWidth: 1,
  borderColor: '#dce4da',
} as const;
const small = { color: '#617268', fontSize: 11, lineHeight: 17 } as const;

export function AnalysisWorkspace({ user }: { user: Identity }) {
  const network = useNetworkState(),
    online = network.isConnected !== false && network.isInternetReachable !== false;
  const [jobs, setJobs] = useState<AnalysisJobView[]>([]),
    [selected, setSelected] = useState(''),
    [cap, setCap] = useState<Entitlements | null>(null);
  const [source, setSource] = useState<AnalysisRequest['source']>('DEMOSTRACION_SINTETICA'),
    [action, setAction] = useState<AnalysisRequest['action']>('GENERATE_DATASET');
  const [dataset, setDataset] = useState(''),
    [model, setModel] = useState(''),
    [forecast, setForecast] = useState(''),
    [horizon, setHorizon] = useState<7 | 30>(7),
    [channel, setChannel] = useState<'APP' | 'WEB' | 'TIENDA'>('APP');
  const [locations, setLocations] = useState<string[]>(['demo-ubicacion-01']),
    [realLocations, setRealLocations] = useState<{ id: string; nombre: string }[]>([]);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [notice, setNotice] = useState('');
  const controller = useRef<AbortController | null>(null),
    running = useRef(false);
  const active = () => Boolean(controller.current && !controller.current.signal.aborted);
  const run = async (work: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    const session = captureSessionScope();
    try {
      await work();
    } catch (reason) {
      if (active() && isCurrentSessionScope(session)) setError((reason as Error).message);
    } finally {
      running.current = false;
      if (active() && isCurrentSessionScope(session)) setBusy(false);
    }
  };
  const load = async () => {
    const response = await api<unknown>('/analytics/jobs', { signal: controller.current?.signal });
    const list = parseAnalysisJobs(response);
    if (active()) {
      setJobs((previous) =>
        list.map((row) => {
          const old = previous.find((item) => item.id === row.id);
          return old?.result && old.status === row.status ? { ...row, result: old.result } : row;
        }),
      );
      setSelected((old) => old || list[0]?.id || '');
    }
  };
  useEffect(() => {
    const abort = new AbortController();
    controller.current = abort;
    const session = captureSessionScope();
    void (async () => {
      if(online){try{await bootstrapOfflineVault(user);}catch(reason){if(!ApiProblem.isNetwork(reason))throw reason;}}
      const work = await openAdminWorkspace();
      const boot = await work.records.get(work.scope, 'bootstrap', 'current'),
        copy = await work.records.get(work.scope, 'analysis-result', 'current');
      if (abort.signal.aborted || !isCurrentSessionScope(session)) return;
      const entitlement = boot ? BootstrapResponseSchema.parse(boot.value).entitlements : null;
      setCap(entitlement);
      if (copy) {
        const job = checkedAnalysisCopy(copy.value, work.scope);
        setJobs([job]);
        setSelected(job.id);
        setSource(job.source);
        setNotice('Resultado guardado: disponible para filtrar sin conexión.');
      }
      if (online && entitlement?.features.demand) {
        await load();
        const names = await api<{ id: string; nombre: string; activa: boolean }[]>('/locations', {
          signal: abort.signal,
        }).catch(() => []);
        if (!abort.signal.aborted && isCurrentSessionScope(session))
          setRealLocations(names.filter((row) => row.activa));
      }
    })().catch((reason) => {
      if (!abort.signal.aborted && isCurrentSessionScope(session))
        setError((reason as Error).message);
    });
    return () => {
      abort.abort();
      controller.current = null;
    };
  }, [user, online]);
  const open = (id: string) =>
    run(async () => {
      const row = AnalysisJobViewSchema.parse(
        await api('/analytics/jobs/' + id, { signal: controller.current?.signal }),
      );
      if (active()) {
        setSelected(row.id);
        setJobs((previous) => [row, ...previous.filter((item) => item.id !== row.id)]);
      }
    });
  const create = () =>
    run(async () => {
      await bootstrapOfflineVault(user);
      const work = await openAdminWorkspace(),
        session = captureSessionScope();
      const input = {
        source,
        action,
        channel,
        ...(locations.length ? { locationIds: locations } : {}),
        ...(['TRAIN_DEMAND', 'TRAIN_ANOMALY'].includes(action) && dataset
          ? { datasetJobId: dataset }
          : {}),
        ...(action === 'FORECAST'
          ? { horizonDays: horizon, ...(model ? { modelJobId: model } : {}) }
          : {}),
        ...(action === 'SUGGEST_RESTOCK' && forecast ? { forecastJobId: forecast } : {}),
      };
      const saved = await work.records.get<{ payload: string; operationId: string }>(
        work.scope,
        'analysis-intent',
        'current',
      );
      const payload = canonicalJson(input),
        operationId = saved?.value.payload === payload ? saved.value.operationId : randomUUID();
      const request = AnalysisRequestSchema.parse({ ...input, operationId });
      await work.records.put(work.scope, 'analysis-intent', 'current', { payload, operationId });
      work.check();
      const job = AnalysisJobViewSchema.parse(
        await api('/analytics/jobs', {
          method: 'POST',
          body: JSON.stringify(request),
          signal: controller.current?.signal,
        }),
      );
      if (!active() || !isCurrentSessionScope(session)) return;
      setSelected(job.id);
      setJobs((previous) => [job, ...previous.filter((item) => item.id !== job.id)]);
      setNotice('Análisis registrado. Continúa en el servidor aunque cierres esta pantalla.');
    });
  const job = jobs.find((row) => row.id === selected),
    ml = Boolean(cap?.features.demand),
    enabled = ml && !cap?.readOnly && Boolean(cap&&Date.now()<Date.parse(cap.periodTo)) && online;
  const completed = jobs.filter((row) => row.source === source && row.status === 'COMPLETED');
  const save = () =>
    run(async () => {
      if (!job?.result) return;
      const work = await openAdminWorkspace();
      await work.records.put(work.scope, 'analysis-result', 'current', {
        tenantId: work.scope.tenantId,
        actorId: work.scope.actorId,
        job,
      });
      if (active()) setNotice('Resultado guardado cifrado para reabrir y filtrar sin conexión.');
    });
  return (
    <View style={{ gap: 14 }}>
      <View style={card}>
        <Text style={{ color: '#173e2a', fontWeight: '900', fontSize: 18 }}>
          Laboratorio de análisis
        </Text>
        <Text style={small}>
          Profesional incluye demanda y reposición. Negocio agrega anomalías y análisis entre
          ubicaciones. La demostración usa datos sintéticos identificados.
        </Text>
        {!online ? (
          <Text style={small}>
            Sin conexión: puedes explorar el resultado descargado. Entrenar y generar resultados
            requiere conexión.
          </Text>
        ) : null}
        {!ml ? (
          <Text style={small}>
            Tu plan conserva reportes manuales y dashboards offline. El entrenamiento requiere
            Profesional o Negocio.
          </Text>
        ) : null}
        <ReportButton
          label="Actualizar análisis"
          onPress={() => void run(load)}
          disabled={!online || busy || !ml}
        />
        {error ? (
          <Text accessibilityRole="alert" style={{ color: '#9a2e2e', fontSize: 11 }}>
            {error}
          </Text>
        ) : null}
        {notice ? <Text style={small}>{notice}</Text> : null}
        {busy ? <ActivityIndicator color="#173e2a" /> : null}
      </View>
      {ml ? (
        <View style={card}>
          <Text style={{ fontSize: 15, fontWeight: '800', color: '#173e2a' }}>
            Preparar análisis
          </Text>
          <Choice
            items={[
              { id: 'DEMOSTRACION_SINTETICA', label: 'Demostración sintética' },
              { id: 'REAL', label: 'Datos de mi tienda' },
            ]}
            value={source}
            onChange={(value) => {
              setSource(value as typeof source);
              setAction(value === 'REAL' ? 'SUGGEST_RESTOCK' : 'GENERATE_DATASET');
              setLocations(value === 'REAL' ? [] : ['demo-ubicacion-01']);
              setDataset('');
              setModel('');
              setForecast('');
            }}
          />
          <Choice
            items={Object.entries(actions)
              .filter(([id]) => id !== 'TRAIN_ANOMALY' || cap?.features.anomalies)
              .filter(([id]) => source !== 'REAL' || id !== 'GENERATE_DATASET')
              .map(([id, label]) => ({ id, label }))}
            value={action}
            onChange={(value) => setAction(value as typeof action)}
          />
          <Text style={small}>
            Ubicaciones{' '}
            {cap?.features.multilocationAnalysis
              ? '(puedes seleccionar varias)'
              : '(selecciona una)'}
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {(source === 'REAL'
              ? realLocations.map((row) => ({ id: row.id, name: row.nombre }))
              : Array.from({ length: 3 }, (_, index) => ({
                  id: 'demo-ubicacion-' + String(index + 1).padStart(2, '0'),
                  name: 'Ubicación demo ' + (index + 1),
                }))
            ).map((row) => (
              <Pressable
                key={row.id}
                accessibilityRole="checkbox"
                accessibilityState={{ checked: locations.includes(row.id) }}
                style={{
                  padding: 10,
                  borderWidth: 1,
                  borderColor: '#dce4da',
                  borderRadius: 9,
                  backgroundColor: locations.includes(row.id) ? '#dfeadd' : '#fff',
                }}
                onPress={() =>
                  setLocations((previous) =>
                    cap?.features.multilocationAnalysis
                      ? previous.includes(row.id)
                        ? previous.filter((id) => id !== row.id)
                        : [...previous, row.id]
                      : [row.id],
                  )
                }
              >
                <Text style={small}>{row.name}</Text>
              </Pressable>
            ))}
          </View>
          {source === 'REAL' && !realLocations.length ? (
            <Text style={small}>Se usarán tus ubicaciones autorizadas por el servidor.</Text>
          ) : null}
          <Choice
            items={['APP', 'WEB', 'TIENDA'].map((id) => ({
              id,
              label: id === 'TIENDA' ? 'Mostrador' : id,
            }))}
            value={channel}
            onChange={(value) => setChannel(value as typeof channel)}
          />
          {['TRAIN_DEMAND', 'TRAIN_ANOMALY'].includes(action) &&
          source === 'DEMOSTRACION_SINTETICA' ? (
            <>
              <Text style={small}>Dataset generado</Text>
              <Choice
                items={completed
                  .filter((row) => row.action === 'GENERATE_DATASET')
                  .map((row) => ({
                    id: row.id,
                    label: new Date(row.createdAt).toLocaleString('es-BO'),
                  }))}
                value={dataset}
                onChange={setDataset}
              />
            </>
          ) : null}
          {action === 'FORECAST' ? (
            <>
              <Text style={small}>Modelo de demanda</Text>
              <Choice
                items={completed
                  .filter((row) => row.action === 'TRAIN_DEMAND')
                  .map((row) => ({
                    id: row.id,
                    label: new Date(row.createdAt).toLocaleString('es-BO'),
                  }))}
                value={model}
                onChange={setModel}
              />
              <Choice
                items={[
                  { id: '7', label: '7 días' },
                  { id: '30', label: '30 días' },
                ]}
                value={String(horizon)}
                onChange={(value) => setHorizon(Number(value) as 7 | 30)}
              />
            </>
          ) : null}
          {action === 'SUGGEST_RESTOCK' && source === 'DEMOSTRACION_SINTETICA' ? (
            <>
              <Text style={small}>Pronóstico terminado</Text>
              <Choice
                items={completed
                  .filter((row) => row.action === 'FORECAST')
                  .map((row) => ({
                    id: row.id,
                    label: new Date(row.createdAt).toLocaleString('es-BO'),
                  }))}
                value={forecast}
                onChange={setForecast}
              />
            </>
          ) : null}
          <ReportButton
            label="Registrar análisis"
            onPress={() => void create()}
            disabled={!enabled || busy}
          />
          <Text style={small}>
            Repetir la misma solicitud recupera su análisis. Cambia sus parámetros para preparar
            otro. La reposición es una propuesta para revisión.
          </Text>
        </View>
      ) : null}
      <View style={card}>
        <Text style={{ fontSize: 15, fontWeight: '800', color: '#173e2a' }}>Mis análisis</Text>
        {jobs.length ? (
          jobs.map((row) => (
            <Pressable
              key={row.id}
              accessibilityRole="button"
              disabled={busy}
              onPress={() => (online ? void open(row.id) : setSelected(row.id))}
              style={{ paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#e3e9e0' }}
            >
              <Text style={small}>
                {actions[row.action]} · {states[row.status]} ·{' '}
                {row.source === 'REAL' ? 'REAL' : 'DEMOSTRACIÓN'} ·{' '}
                {new Date(row.createdAt).toLocaleString('es-BO')}
              </Text>
            </Pressable>
          ))
        ) : (
          <Text style={small}>Todavía no hay análisis disponibles para esta cuenta.</Text>
        )}
      </View>
      {job ? (
        <View style={card}>
          <Text style={{ fontWeight: '800', fontSize: 15, color: '#173e2a' }}>
            {actions[job.action]} · {states[job.status]}
          </Text>
          {job.message ? <Text style={small}>{job.message}</Text> : null}
          {['QUEUED', 'RUNNING'].includes(job.status) ? (
            <>
              <Text style={small}>
                El trabajo sigue en el servidor. Un entrenamiento puede tardar varios minutos.
              </Text>
              <ReportButton
                label="Consultar progreso"
                onPress={() => void open(job.id)}
                disabled={!online || busy}
              />
            </>
          ) : null}
          {job.result ? (
            <>
              <AnalysisResultView key={job.id} result={job.result} />
              <ReportButton
                label="Guardar resultado para offline"
                onPress={() => void save()}
                disabled={busy}
              />
              <ReportButton
                label="Compartir resultado completo JSON"
                onPress={() => void run(() => shareDslJson(JSON.stringify(job.result, null, 2)))}
                disabled={busy}
              />
            </>
          ) : null}
        </View>
      ) : null}
    </View>
  );
}
