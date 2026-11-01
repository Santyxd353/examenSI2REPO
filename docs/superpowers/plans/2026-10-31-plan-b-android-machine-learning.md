# Lúmina SaaS: Android y machine learning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Ejecución nativa en el Codex del compañero, coordinada con A; no crear agentes adicionales ni desplegar la VM por el mero hecho de leer este archivo.

**Goal:** Entregar Android modular con offline durable, vestidor AR local, reportes/dashboard y SaaS; implementar los workers de ML y avatar del ICONIX para integrarlos con la API/web de A.

**Architecture:** B modifica únicamente Android y workers Python, además de su evidencia. Consume contratos, motor de reportes y endpoints mantenidos por A; las pruebas con fixtures permiten avanzar mientras llegan los endpoints, y las pruebas integradas cierran cada caso.

**Tech Stack:** ExpoSDK57, ReactNative 0.86.3, TypeScript, Hermes, SQLite, SecureStore, ExpoCrypto/FileSystem/Network/Audio/Print/Sharing/WebBrowser, react-native-svg, pose-landmarker, Python 3.11/pandas/NumPy/scikit-learn/joblib/pytest y worker Blender existente.

**Spec:** `docs/saas/iconix/especificacion.json` v 2.0 y `docs/Lumina_SaaS_ICONIX_Grupo18.docx`. Ambos están en el repositorio oficial; no se necesita la ruta de Windows ni la clave SSH del coordinador.

**Responsable:** compañero y su Codex (B). **Plan complementario:** `2026-10-31-plan-a-servidor-web-integracion.md`, en esta misma carpeta. Este archivo es autónomo: incluye contratos, alcance y coordinación necesarios para B.

**Estado de este archivo:** planificación; código/endpoints descritos como nuevos todavía deben construirse y probarse. No afirmar que una función está lista por encontrar su nombre aquí.

## Instrucción lista para pegar al Codex de tu compañero

Pásale este archivo completo o, después de clonar el repositorio, pega el siguiente mensaje:

```text
Trabajaremos como equipo B del proyecto Lúmina SaaS, en este repositorio:
https://github.com/Santyxd353/examenSI2REPO.git

Lee completo docs/superpowers/plans/2026-10-31-plan-b-android-machine-learning.md
y docs/saas/iconix/especificacion.json. Lee también docs/saas/ESTADO.md.
Ejecuta el plan B, no solo lo resumas. Fecha objetivo: 07/11/2026.
Empieza por B00 y deja un registro de baseline/SHA/versiones.
Trabaja en tu clon y rama desarrollo/android-ml, desde desarrollo/saas-offline.
No borres cambios ajenos ni reemplaces la rama si ya existe.

Tu ámbito de edición es apps/mobile/**, workers/analytics/**,
workers/avatar/** y docs/evidencia/saas/equipo-b/**.
No edites API, web, Prisma, packages compartidos, manifests/locks raíz,
infraestructura ni documento Word; son responsabilidad del equipo A.
No despliegues ni reinicies la VM. No copies claves privadas por chat.

Desarrolla por bloques verificables con tests, commit y push a tu rama.
Consume los contratos/fixtures publicados por A en integración; cuando falte
un endpoint, crea el adaptador contra fixtures y registra la dependencia,
pero no llames integrado a un mock. Avanza Python o tareas independientes
mientras llega ese contrato. No dupliques el motor de reportes.

Publica handoffs en tu carpeta de evidencia con SHA, RF/CU, comandos/resultados,
protocolo y dependencias. A integrará tu rama y te dará el SHA de candidato.
Conserva Expo57, la diferencia web3D/AndroidAR, los cinco tipos offline,
los tres planes exactos y la separación REAL/DEMOSTRACION_SINTETICA.
Entrega APKQA con paquete separado .qa y metadatos; A coordina la firma
y publicación oficial compatible con el APK anterior.
```

## Cómo empezar sin esperar a que A termine

1. **B00/B01:** entorno y dataset Python se hacen sin nuevos endpoints.
2. **B04:** navegación/auth/errores puede empezar con el código actual; incorporar packages al recibir G0a.
3. **B02/B03:** entrenamiento/CLI se desarrollan localmente con requests y artefactos privados; A integra el supervisor.
4. **B05–B10:** implementar repositorios/estados y probar con fixtures; cerrar integración al recibir bootstrap/sync/rowsets reales.
5. **B16:** preparar toolchain/varianteQA temprano; el primer APK es necesario para probar B15 y el final se entrega después.

Conseguir la clave SSH o copiar una carpeta de otra computadora no es requisito para estas tareas. El despliegue coordinado lo hace A desde el candidato integrado.


## 1. Documento rector y punto de partida

Fecha del plan: **31/10/2026**. Entrega objetivo: **07/11/2026**, zona `America/La_Paz`.
Repositorio oficial: <https://github.com/Santyxd353/examenSI2REPO.git>.
Base inspeccionada: **`1e35943`**, en `desarrollo/saas-offline`; incluye la especificación ICONIX, sobre el incremento técnico `6fcac5a`.

Leer antes de programar, en este orden:

1. `docs/saas/iconix/especificacion.json`: 54 RF, 27 CU, reglas, contratos, protocolo ML y diccionario.
2. `docs/Lumina_SaaS_ICONIX_Grupo18.docx`: informe ICONIX vigente, con los diagramas de cada caso.
3. `docs/saas/ESTADO.md`: separa lo existente de lo pendiente.
4. `docs/saas/OPERACION.md`: contexto de tienda, migraciones, límites y despliegue actual.
5. Este plan completo y las interfaces del otro plan cuando una tarea las consuma.

El Word anterior `docs/Plataforma_Vestidor3D_Grupo18.docx` y `docs/saas/ICONIX.md` son referencias históricas; sus ciclos o numeraciones no sustituyen la versión 2.0. Los planes detallan implementación, no agregan prestaciones comerciales al ICONIX. Si aparece una contradicción, registrar el punto y resolverlo con el coordinador antes de implementar dos interpretaciones distintas.

### Estado real que se conserva

- NestJS 11, Prisma 6, PostgreSQL, React 19/Vite/Three.js y Android Expo SDK **57** con React Native **0.86.3** según los manifiestos actuales. Node **>=22.12**.
- Ya existe aislamiento por base, archivos, sesión y eventos de cada tienda, provisión por CLI, prueba de 14 días, comprobación de capacidades y administración modular web. Hay que ampliar y volver a verificar esas piezas.
- `reports.ts` contiene agregados, reglas estadísticas y reconocimiento de intención por expresiones; **no acredita el nuevo ML entrenado ni la IA por voz**.
- Android usa actualmente `api.ts`, `App.tsx`, `AdminDashboard.tsx`, `CatalogScreen.tsx`, `MobileCommerceSheet.tsx`, `pose.ts` y un módulo nativo `pose-landmarker`.
- El worker de avatar ya está en `workers/avatar`; no se reemplaza por un avatar fijo ni por el worker analítico.
- No existen aún `packages/contracts`, `packages/reporting`, el protocolo offline completo ni `workers/analytics`. Las rutas nuevas de este plan son **propuestas a crear**, no archivos que ya funcionan.
- Las 100 pruebas del 20/10 son evidencia histórica. Ejecutar las verificaciones actuales antes de informar nuevos resultados.

## Global Constraints

- Moda exclusivamente femenina; conservar Lúmina, vestidos, faldas, catálogo por variantes y vestidor como característica central.
- SaaS: una base comercial y un ámbito de archivos por tienda; registro fijo `platform` separado lógicamente. No hay FK entre bases independientes.
- Planes mensuales en BOB: **Esencial 149, Profesional 299, Negocio 599**; códigos **`esencial`, `pro`, `negocio`**.
- Límites Esencial/Profesional/Negocio: ubicaciones **1/5/20**, personal activo **3/15/100**, productos registrados **200/2000/10000**, generaciones de avatar al mes **30/150/500**, reportes guardados **3/15/50**, interpretaciones IA al mes **0/100/500**.
- Personal incluye propietaria/administradora y excluye compradoras. Producto archivado sigue contado; variantes no son productos adicionales. Capacidad se valida transaccionalmente, no desde la interfaz.
- Todos incluyen offline web/APK, hasta **10 prendas por clienta**, reportes manuales y dashboard local interactivo. Esencial sin ML; Profesional demanda/reposición; Negocio agrega anomalías y comparación de ubicaciones del mismo negocio.
- Stripe **TEST** y **QR_SIMULATED**. Sin cargos reales, credenciales de servidor en clientes ni activación por simple redirección.
- Un cambio inmediato confirmado abre ciclo completo, con precio y fechas visibles, cuotas nuevas y consumo anterior en historial; sin prorrateo oculto. Descenso incompatible se bloquea sin borrar datos. Cancelar renovación conserva vigencia hasta el fin pagado.
- Avatar: tres fotos distintas, vestida, frente/perfil/espalda, JPEG/PNG **<=10 MiB cada una**, altura **100–230 cm**, consentimiento y mayoría de edad; purga al terminar o antes de **24 h**. Regeneración exitosa consume cuota; fallo definitivo libera reserva.
- Web: GLB compatible sobre avatar propio aprobado, 360 grados y zoom. Android: PNG transparente con seguimiento corporal local; esa AR aproximada **no es una malla 3D corporal**.
- Offline admite `CATALOG_CREATE`, `CATALOG_UPDATE`, `CATALOG_ARCHIVE`, `STOCK_DELTA`, `STOCK_COUNT`. No ventas, pagos, transferencias ni generación de avatar offline.
- Operaciones locales inmutables, UUID estable, hash canónico, dependencias, versión, actor y tienda. No usar el saldo local como reemplazo del global. Delta compatible suma; conteo exige versión coincidente.
- Estados locales: `PENDING`, `SENDING`, `APPLIED`, `CONFLICT`, `BLOCKED`, `DISCARDED`. Servidor persiste comprobantes terminales `APPLIED`, `CONFLICT`, `REJECTED`. Bloqueos transitorios no se congelan como rechazo definitivo.
- Un UUID aplicado se recupera sin repetir efecto; UUID con contenido distinto da **409 `IDEMPOTENCY_PAYLOAD_MISMATCH`**. Recuperar comprobante sigue requiriendo identidad autorizada.
- Reportes: **10 métricas, 5 dimensiones, 20 filtros, 50 000 filas descargadas** como límites operativos del diseño; cobertura parcial siempre visible. Sin SQL/eval libre.
- Dinero: BOB, centavos enteros o decimal exacto, fecha comercial `America/La_Paz`, semana ISO. No restar devoluciones implícitamente a ventas brutas ni duplicar líneas al unir pagos.
- ML: solo demostración con datos sintéticos identificados para esta entrega. No insertar datos demo en pedido/pago/stock reales. Un selector REAL sin historial suficiente debe mostrar la limitación.
- Dataset `demo-femenino-seed42-v1`: semilla **42**, **365** fechas **2025-10-01..2026-09-30**, **12 productos**, **36 variantes**, **5 ubicaciones**, canales `WEB/APP/TIENDA`, panel **197100 filas**, incluidos ceros.
- Split por fechas: entrenamiento **255** hasta **2026-06-12**; validación **55** del **2026-06-13 al 2026-08-06**; prueba **55** del **2026-08-07 al 2026-09-30**. Primeros **28 días** son calentamiento de features.
- RandomForestRegressor, lag 1/7/14/28, medias pasadas 7/28, categorías, pronóstico recursivo **7/30 días**, baseline semanal, MAE/RMSE/WAPE. WAPE con denominador cero es **N/A**, no cero.
- IsolationForest solo Negocio; etiquetas e intensidad de inyección quedan fuera de features. Umbral fijado antes de prueba. Guardar TP/FP/TN/FN y precisión/recall/F1 con política N/A.
- Mantener APIs antiguas utilizadas por la app instalada durante la transición; una función nueva requiere interfaz, reglas, autorización y evidencia. No dar por implementado lo que solo tiene tabla, botón o mock.

## Review Focus

1. Cambio de tienda/cuenta mientras llega una respuesta o corre una descarga: la respuesta vieja no toca el almacén nuevo. Pruebas A09/B04/B09.
2. Commit correcto con respuesta perdida, doble envío y vencimiento posterior: recuperar el mismo comprobante sin duplicar ni perder la cola. Pruebas A07/B08.
3. Pedido con varios pagos y devoluciones parciales, filtro de método y semana que cruza año: importes y conteos exactos, sin duplicación. Pruebas A10/A11/B10.
4. Cierre forzado, disco lleno, archivo corrupto y sesión cerrada con pendientes: estado durable, paquete parcial y copia privada bloqueada recuperable. Pruebas A09/B05/B09.
5. Serie nueva, demanda cero y ventana de pronóstico fuera de cobertura: insuficiencia/N/A explícitos, sin fuga temporal ni resultados ficticios. Pruebas A13/B02/B03/B10.

## 2. Reparto y reglas para trabajar a la par

| Área | Responsable de editar e integrar | El otro equipo |
|---|---|---|
| `apps/api/**`, Prisma y esquema `platform` | A, Codex coordinador | B consume contratos y reporta defectos con reproducción |
| `apps/web/**` | A | B prueba ventas/reportes cruzados sin editar web |
| `packages/contracts/**`, `packages/reporting/**` | A | B consume versiones y aporta fixtures mediante su carpeta de evidencia |
| `apps/mobile/**`, dependencias/lock móvil, módulo pose | B, compañero | A consume el APK y revisa integración; no modifica esos archivos simultáneamente |
| `workers/analytics/**`, `workers/avatar/**` | B | A integra ejecución, almacenamiento, cuotas y contenedor |
| `package.json`/lock raíz, `tsconfig` raíz, Jest raíz, Docker/infra/CI | A | B comunica dependencias y requisitos de runtime |
| `scripts/**`, `catalog-assets/**`, semillas y recursos de catálogo fuera de mobile/workers | A | B consume binarios/manifiestos y comunica incompatibilidades |
| Planes, Word, JSON rector, `docs/saas/ESTADO.md` | A | B entrega evidencia; no regenera el Word por su cuenta |
| `docs/evidencia/saas/equipo-a/**` | A | Lectura por B |
| `docs/evidencia/saas/equipo-b/**` | B | Lectura por A |
| VM, migraciones y publicación oficial | Solo A como coordinador del despliegue | B no reinicia contenedores ni publica desde su rama |

Ramas: **integración** `desarrollo/saas-offline`; **A** `desarrollo/servidor-web`; **B** `desarrollo/android-ml`. Son nombres previstos: comprobar si existen antes de crearlas. `main` sigue siendo la versión publicada hasta la integración final verificada.

Cada Codex trabaja en su clon o worktree. No compartir el mismo directorio de trabajo ni editar el checkout de la VM entre ambos. No hacer `reset --hard`, `clean -fd`, `push --force` ni resolver conflictos eligiendo ciegamente `ours/theirs`. El coordinador integra con merge; no mezclar rutinariamente merge y cherry-pick de los mismos commits.

### Arranque portátil en PowerShell

En un directorio elegido por cada persona, sin suponer `C:\Users\ASUS` o `C:\Users\HP`:

```powershell
git clone https://github.com/Santyxd353/examenSI2REPO.git
Set-Location examenSI2REPO
git fetch origin
git switch desarrollo/saas-offline
git pull --ff-only origin desarrollo/saas-offline
git log -1 --oneline
git status --short
```

Si ya existe el clon, omitir `clone` y entrar en él. Si hay cambios propios, conservarlos en una rama/commit antes de cambiar; no borrarlos. El documento abierto puede crear un archivo `~$...docx`: no es código ni entregable, no agregarlo a Git.

Crear la rama propia desde la integración actual. Si la rama ya existe, `git switch` a ella y revisar su diferencia; no recrearla desde una base más vieja. Anotar el SHA inicial en el primer informe de avance.

### Ciclo de colaboración por entregable

1. Sincronizar referencias con `git fetch origin`; revisar `git status` y cambios nuevos en integración.
2. Implementar un bloque con sus pruebas, hacer commit pequeño y push **a la rama propia**.
3. Escribir un handoff en la carpeta propia de evidencia. No modificar el handoff del otro.
4. A revisa pruebas, contrato y archivos. Integra el bloque en `desarrollo/saas-offline` mediante merge y publica ese SHA.
5. El otro incorpora la integración mediante `git merge origin/desarrollo/saas-offline` en su rama limpia. Volver a probar lo que consume ese contrato.
6. Si hay que cambiar un contrato, A publica primero esquema, fixture, versión y compatibilidad; B adapta el consumidor. No renombrar campos solo en un lado.

Handoff mínimo por bloque:

```text
Bloque: Axx o Bxx
Rama y SHA:
Contrato consumido/producido y versión:
Archivos modificados:
RF/CU cubiertos:
Comandos ejecutados, fecha y resultado real:
Evidencia de dispositivo/servicio, si corresponde:
Pendientes reproducibles y dependencia concreta:
¿Toca esquema, raíz, firma o despliegue?:
Siguiente acción que necesita del otro equipo:
```

Un resultado con fixtures se llama **verificado contra fixtures**. Solo se llama integrado cuando se ejecuta contra la API y el APK/web reales. No bloquearse esperando pantallas del otro: usar fixtures versionados, implementar el adaptador y dejar visible la dependencia.

Para revisar avances sin alterar el checkout propio, consultar ramas remotas con `git log`, `git diff` y `git show` después de fetch. Ejemplo del coordinador:

```powershell
git fetch origin
git log --oneline origin/desarrollo/saas-offline..origin/desarrollo/android-ml
git diff --stat origin/desarrollo/saas-offline...origin/desarrollo/android-ml
```

Esas referencias se consultan solo después de que existan/publicadas las ramas. La integración se hace en checkout limpio de desarrollo/saas-offline: merge de la rama A revisada, merge de la B revisada, pruebas afectadas y push del resultado. Un fallo mantiene el candidato sin publicar/desplegar; no resolverlo borrando commits o seleccionando lockfiles a ciegas. La carpeta de evidencia viaja en los commits de cada rama, no es un canal automático de mensajes entre Codex.

## 3. Contratos compartidos que A publica primero

Los nombres siguientes son decisiones de implementación de este plan. A01 debe materializarlos y probarlos antes de que ambos lados dependan de ellos. Versión inicial: **`schemaVersion: "1.0"`**, `semanticsVersion: "1.0"`.

### 3.1 Paquetes y compatibilidad de compilación

- `packages/contracts`: esquemas Zod 4 y tipos, catálogo de capacidades, operaciones, errores, manifiestos, reportes y jobs; sin React, Node crypto, DOM ni Expo en runtime.
- `packages/reporting`: motor puro TypeScript de validación semántica, filtro, agregación, cobertura, selección cruzada y CSV; sin acceso a red, SQL, almacenamiento ni reloj global.
- Exportar `dist/index.js` CommonJS y `dist/index.d.ts` mediante `tsc`, con `main/types` explícitos. Consumo API/React/Android desde nombres **`@lumina/contracts`** y **`@lumina/reporting`**.
- Dependencias locales `file:packages/...` en raíz y `file:../../packages/...` en móvil. A actualiza el lock raíz; B el móvil después de recibir los paquetes.
- A introduce `build:shared` y `test:shared`. `npm run build` construye shared antes de API/web. No ampliar por accidente `rootDir: src` de la API ni cambiar la ruta actual de `dist/api/main.js`.
- Vite debe incluir los paquetes CommonJS enlazados en prebundling y conversión CommonJS de producción. B configura Metro/tsconfig para encontrarlos y prueba un bundle Android real; no basta que TypeScript los resuelva.
- No migrar Expo 57 a 58 durante esta semana ni convertir todo el repo a otra arquitectura de monorepo.

Exportaciones mínimas, con tipos definidos en el propio paquete:

```ts
type ScopeKey = { tenantId: string; actorId: string };
type OperationKind = 'CATALOG_CREATE' | 'CATALOG_UPDATE' |
  'CATALOG_ARCHIVE' | 'STOCK_DELTA' | 'STOCK_COUNT';
type LocalState = 'PENDING' | 'SENDING' | 'APPLIED' |
  'CONFLICT' | 'BLOCKED' | 'DISCARDED';
type ApiProblem = { code: string; message: string; correlationId: string;
  retryable: boolean; details?: Record<string, unknown> };
type OfflineIntent = ScopeKey & { schemaVersion: '1.0'; operationId: string;
  deviceId: string; kind: OperationKind; entityId: string; baseVersion: number | null;
  dependsOn: string[]; createdAt: string; payload: Record<string, unknown>;
  payloadHash: string };
type OperationReceipt = ScopeKey & { operationId: string; deviceId: string;
  payloadHash: string; status: 'APPLIED' | 'CONFLICT' | 'REJECTED';
  result: Record<string, unknown>; entityId: string; confirmedVersion: number | null;
  committedAt: string; correlationId: string };
type SyncOperationResult = { operationId: string; receipt?: OperationReceipt;
  blocked?: ApiProblem };
type Entitlements = {
  schemaVersion: '1.0'; tenantId: string;
  planCode: 'esencial' | 'pro' | 'negocio';
  status: 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED';
  periodFrom: string; periodTo: string; readOnly: boolean;
  cancelAtPeriodEnd: boolean; currency: 'BOB'; priceMinor: number;
  billingMode: 'STRIPE_TEST' | 'QR_SIMULATED' | null;
  limits: { locations: number; staff: number; products: number;
    avatarsPerPeriod: number; savedReports: number; aiPerPeriod: number };
  usage: { locations: number; staff: number; products: number;
    avatarsCommitted: number; avatarsReserved: number; savedReports: number;
    aiCommitted: number; aiReserved: number };
  features: { offline: true; offlineOutfitsLimit: 10; manualReports: true;
    aiReports: boolean; demand: boolean; restock: boolean;
    anomalies: boolean; multilocationAnalysis: boolean };
};
type SyncSummary = { attempted: number; applied: number; conflicts: number;
  rejected: number; blocked: number; pending: number;
  nextRetryAt: string | null; results: SyncOperationResult[] };
type DownloadStatus = { packageId: string;
  state: 'NOT_DOWNLOADED' | 'DOWNLOADING' | 'PARTIAL' | 'READY' | 'ERROR';
  bytesVerified: number; bytesExpected: number; readyItems: number;
  expectedItems: number; problem?: ApiProblem };
```

Los estados anteriores de Entitlements son el DTO normalizado de acceso; no sustituyen los estados de proveedor/facturación en la base. Trial vencido y canceled-at-end pasan a EXPIRED solo al concluir su vigencia; registrar aparte status original y motivo si se necesitan para UI. Una suscripción sin proveedor seleccionado informa billingMode=null, sin fingir que un trial ya fue cobrado.

`payload` no queda libre: `OfflineIntentSchema` es unión discriminada por `kind`, valida estrictamente cada estructura, rechaza claves extra y exporta los tipos inferidos. `CATALOG_CREATE` contiene producto y variantes con UUID estables, categorías, precios por canal y referencias de adjuntos ya preparados. `CATALOG_UPDATE` contiene parches de campos permitidos y versiones de los agregados afectados. `CATALOG_ARCHIVE` contiene motivo. `STOCK_DELTA` contiene `variantId`, `locationId`, `deltaFisico` entero no nulo y motivo. `STOCK_COUNT` contiene `variantId`, `locationId`, `observedPhysical` entero >=0 y motivo; exige `baseVersion` entero >=1.

APIs del paquete: `OfflineIntentSchema.parse(raw)`, `OperationReceiptSchema.parse(raw)`, `ReportDefinitionSchema.parse(raw)`, `AnalyticsJobSchema.parse(raw)`, `canonicalIntentJson(unsignedIntent): string`, `moneyToMinor(decimal: string): number`, `minorToDecimal(cents: number): string`. Definir y exportar `UnsignedIntent = Omit<OfflineIntent, 'payloadHash'>`.

El hash usa SHA256 del UTF-8 del JSON canónico: claves ordenadas, cadenas NFC, UUID normalizados, números finitos, fechas ISO inmutables y `dependsOn` ordenado sin repetidos. Sin `undefined`, NaN ni campos de transporte/estado. Cada adaptador calcula SHA256; el paquete no importa una API criptográfica específica de plataforma. Un mismo fixture debe producir el mismo hash en Node, navegador y Hermes. No ordenar arbitrariamente listas de variantes: su semántica se define antes de firmar.

### 3.2 Rutas objetivo y respuestas

Todas usan prefijo `/api`; los clientes pasan a su wrapper el sufijo sin duplicarlo. Cabecera `X-Tenant-Slug`; móvil también `X-Client-Channel: APP`. Tokens/cookies conservan el mecanismo actual. `tenantId/actorId` del body se contrastan con el contexto, no lo sustituyen.

| Ruta nueva u objeto a ampliar | Contrato que deben compartir |
|---|---|
| `GET /tenant/subscription` | plan, estado efectivo, `periodFrom/periodTo` ISO UTC, límites, consumo, capacidades y modo TEST/QR; nunca secretos de Stripe |
| `GET /tenant/plans` | los tres planes con precio BOB, prestaciones y límites |
| `POST /tenant/subscription/checkout` | `{planCode, provider, operationId}`; servidor fija importe y devuelve intención/URL o QR simulado |
| `POST /tenant/subscription/qr/:id/confirm` | confirmación simulada autorizada e idempotente, vinculada a intención vigente |
| `POST /tenant/subscription/cancel-renewal` | `{operationId}`; idempotente, devuelve cancelAtPeriodEnd/periodTo sin retirar acceso ya pagado |
| `POST /billing/stripe/webhook` | ruta de proveedor global con raw body y firma; no depende de slug del navegador |
| `POST /offline/bootstrap` | dispositivo/actor autenticados, identidad local autorizada, alcance, capacidades y material de clave protegido; no requiere token push |
| `GET /offline/snapshot` | `snapshotId, asOf, scope, coverage, nextCursor, entities`; paginación estable, no cambiar el corte entre páginas |
| `POST /offline/sync` | `{schemaVersion:"1.0", operations: OfflineIntent[]}`; máximo 100; `results: SyncOperationResult[]`, no un único éxito para todo el lote |
| `GET /offline/operations/:operationId` | comprobante del mismo actor/dispositivo autorizado, sin repetir la escritura |
| `POST /offline/resources` | multipart validado para adjunto pendiente, hash/tamaño/MIME/licencia; devuelve referencia por tienda/actor |
| `GET /offline/outfits?platform=ANDROID_AR` | manifiesto de hasta diez prendas por propietaria, preferencias y recursos AR compatibles |
| `GET /offline/outfits?platform=WEB_3D` | manifiesto GLB y avatar propio aprobado opcional con consentimiento |
| `POST /reports/datasets` | crear conjunto privado con definición/cobertura; devuelve manifiesto y descarga paginada estable |
| `GET /reports/datasets/:id` | metadata/cobertura autorizada; nunca devolver otro negocio por UUID |
| `GET /reports/datasets/:id/rows` | páginas con corte estable y hash verificable al completar |
| `POST /reports/execute` | DSL + conjunto autorizado; devuelve resultado del mismo motor compartido |
| `GET/POST/PATCH/DELETE /reports/definitions[/:id]` | definición/diseño versionados y cupo 3/15/50; guardar como crea otra; borrar libera cupo de definición activa |
| `POST /reports/interpret` | texto + UUID -> DSL propuesta validada, advertencias y consulta; no ejecutar sin revisión |
| `POST /reports/transcribe` | audio temporal autorizado -> texto editable; operación de interpretación se cobra una vez, no por cada paso |
| `POST /analytics/jobs` | crear trabajo autorizado asíncrono, `202 {jobId,status}`; no entrenar bloqueando la petición |
| `GET /analytics/jobs/:id` | progreso/resultado/limitaciones, modelo, dataset, procedencia y métricas |
| `GET /analytics/results/:id` | resultado acotado descargable, mismo ámbito y marca demo |
| `POST /avatars/:id/regenerations` | medidas corregidas + UUID, versión nueva pendiente; cuota y propiedad revalidadas |

Las rutas de catálogo, inventario, staff, pedidos y comercio ya existentes se conservan. A publica las extensiones concretas de edición/archivo/roles dentro de A05/A14; B las consume tras el handoff. No interpretar este cuadro como evidencia de que los endpoints existen hoy.

Problemas estables: `AUTH_REQUIRED` 401; `FORBIDDEN` 403; `SUBSCRIPTION_REQUIRED` 402; `FEATURE_NOT_INCLUDED` 403; `CAPACITY_EXCEEDED` 409; `VERSION_CONFLICT` 409; `INSUFFICIENT_STOCK` 409; `DEPENDENCY_BLOCKED` por operación; `DATASET_COVERAGE_INSUFFICIENT` 422; `RESOURCE_INCOMPATIBLE` 422; `PROVIDER_NOT_CONFIGURED` 503; `MODEL_DATA_INSUFFICIENT` 422. En recuperación de comprobantes no convertir una lectura en cobro o consumo nuevo.

### 3.3 Persistencia privada y cierre de sesión

Decisión técnica de este plan: copia cifrada por **tienda, actor y dispositivo**. A publica en `bootstrap` un DEK AES-256 por esa identidad y conserva su copia cifrada en servidor con una clave maestra de entorno. Reutilizar `configuracion` para el registro interno versionado: clave `offline-device:` + SHA256 de identidad, 79 caracteres frente a varchar(100) actual; guardar solo material envuelto y metadata, no DEK en claro. Este namespace se excluye de las APIs comerciales de configuración/exportación y se recupera solo por bootstrap autorizado. No inventar una séptima tabla comercial sin actualizar el diseño.

Web usa Web Crypto y Android Expo Crypto; registrar formato del sobre AES-GCM, nonce aleatorio por cifrado, AAD que incluya identidad, clave de recurso y versión, y fixtures cruzados. Mientras la identidad local continúa autorizada, se conserva el material necesario para reinicio offline en el almacén protegido correspondiente. En logout explícito con «conservar pendientes», eliminar la clave local activa y bloquear la copia cifrada; recuperar clave solo mediante login online de esa misma persona/dispositivo. «Descartar» exige decisión visible y purga confirmada. B no manda ni guarda la clave maestra.

La revocación remota se aplica al reconectar; no prometer borrado instantáneo de un teléfono desconectado. No usar `restoreSession()` fallido por red como razón para borrar la copia o cola: distinguir fallo de transporte de credencial inválida.

### 3.4 Reportes y fixtures de paridad

`ReportDefinition` deriva del ejemplo rector: `schemaVersion, source, datasetId, timezone, currency, fact, metrics, dimensions, period, comparison?, filters, order, limit, chart, dashboard`. `source` solo `REAL | DEMOSTRACION_SINTETICA`; `currency=BOB`, `timezone=America/La_Paz`. `ReportDataset` contiene metadata `coverage` y hechos separados de ventas por línea, pedidos, pagos confirmados preagregados, devoluciones/reembolsos y stock al corte; no hacer un JOIN cartesiano.

Motor compartido: `validateReport(definition, dataset): ValidationResult`; `executeReport(definition, dataset): ReportResult`; `applyCrossFilter(definition, selection): ReportDefinition`; `exportReportCsv(result): string`. Estos cuatro tipos se exportan en los paquetes; `ValidationResult` es unión `ok:true` o `ok:false, problems:ApiProblem[]`. El resultado incluye grupos, KPIs, detalle paginable, cobertura, procedencia y asOf. Selección y definición se tratan como valores inmutables.

Golden obligatorio, publicado por A01 y cerrado por A10:

- O1: dos líneas, 2 unidades/10000 centavos y 1 unidad/5000; dos pagos confirmados que suman 15000. O2: 1 unidad/7000. O3 cancelado y O4 pendiente quedan fuera.
- Sin filtro: **22000 centavos, 4 unidades, 2 pedidos, ticket 11000 centavos**. El pago dividido de O1 no duplica líneas.
- Devolución aceptada de una unidad de O1, reembolso confirmado 5000: ventas brutas siguen 22000; unidades devueltas 1 y reembolso 5000 en métricas separadas.
- Un pedido con líneas en dos categorías se cuenta una vez en KPI global; no sumar conteos de grupos como si fueran disjuntos.
- Stock: físico 10, reservado 2, comprometido 1 -> disponible 7. No mezclar ese grano con líneas de venta.
- Fechas incluyen `2026-01-01T02:00:00Z`: fecha comercial **2025-12-31** en Bolivia. Probar semana ISO alrededor del cambio de año.
- Dataset parcial solo ubicación L1: pedir L2, una columna ausente o período fuera de cobertura devuelve limitación; no cero inventado.

No adaptar los resultados esperados al algoritmo que se implemente. A y B ejecutan la misma fixture en Node/navegador/Hermes.

### 3.5 Protocolo de jobs Python

Contrato compartido y fixture en `packages/contracts/fixtures/analytics-job-v1.json`; A define el DTO y B el ejecutable. Entrada `AnalyticsJobV1`: `schemaVersion:"1.0", jobId, tenantId, actorId, source, action, datasetId?, modelId?, horizonDays?, workDir, parameters, inventorySnapshot?`. Acciones: `GENERATE_DATASET`, `TRAIN_DEMAND`, `TRAIN_ANOMALY`, `FORECAST`, `SUGGEST_RESTOCK`. Horizonte, cuando aplica, 7 o 30.

Ejecutable de B, desde `workers/analytics`: `python -m lumina_analytics.cli --job <request.json>`. Stdout contiene **un solo JSON final** `{ok, jobId, resultPath?, sha256?, error?:{code,message}}`; progreso estructurado por stderr. `resultPath` es relativo a `workDir`. A valida tamaño, esquema, rutas, hash y ámbito antes de persistir. Exit 0 para éxito, no 0 para fallo; no descargar ni cargar modelos arbitrarios enviados por usuarios.

Los resultados incluyen `source, datasetId, modelId, modelVersion, asOf, horizonDays, coverage, metrics, limitations` y filas con namespace correspondiente. `forecast` no necesita DB; recibe solo archivos/inputs autorizados por A. Artefactos joblib solo de este pipeline, con versiones de dependencias y hash verificados. No deserializar uploads de terceros.

### 3.6 Decisiones de detalle que deben quedar cerradas en G0

- `OfflineIntentSchema` valida el payload completo de cada kind. A01 publica tipos reales de producto/variante compatibles con Prisma, campos editables, precios por canal y tipos de archivo. No usar Record<string,unknown> como permiso para enviar propiedades arbitrarias.
- Dependencias: una intención nueva sobre entidad recién creada declara dependsOn del alta y baseVersion=null; ese null solo se acepta en update/archive dependiente del alta aplicada del mismo dispositivo/actor. Servidor obtiene la versión confirmada del recibo padre y verifica que el agregado no cambió después. Si ya cambió, conflicto; nunca sustituir una versión vieja por la actual sin comprobar. Para el resto de updates/counts, versión explícita obligatoria.
- Recurso pendiente usa clientResourceId UUID y sha 256 estables definidos antes de encolar. POST/offline/resources acepta ese ID/hash, es idempotente y devuelve la misma referencia; el upload no altera payloadHash. Referencias de otro actor/tienda o con bytes distintos se rechazan.
- Sobre AES-GCM v 1: algoritmo A256GCM, keyVersion, nonce 12 bytes aleatorio, ciphertext/tag 16 bytes, codificación base 64 y AAD UTF-8 canónica con schemaVersion/tenantId/actorId/deviceId/resourceKey. ExpoCrypto SDK57 soporta additionalData; pasar Uint 8Array o base 64 real, no texto plano cuando la API espera string base 64. A01/B05 prueban paridad del sobre con WebCrypto/Node antes de cerrar G0b. No registrar DEK/ciphertext privado en logs de evidencia.
- Dataset de reporte v 1 define periodos [from, to), locationIds autorizados, campos presentes, complete/truncated, rowCount/totalKnownRows y asOf. Fechas de UI inclusivas se convierten una sola vez a intervalo comercial Bolivia. El hash final cubre manifest inmutable y páginas en orden documentado.
- Publicar catálogo cerrado de métricas/dimensiones/operadores y sus granos. MAE=mean(abs(y-yhat)), RMSE=sqrt(mean((y-yhat)^2)), WAPE=100*sum(abs(y-yhat))/sum(abs(y)); resultado N/A conserva valor null, motivo y conteo.
- Campos monetarios usan integer seguro en centavos; cocientes como ticket mantienen numerador/denominador y redondean únicamente al mostrar/exportar. JSON no transporta BigInt ni float de dinero.
- A01 añade ejemplos de operación, bloqueo, recibo, manifesto, definición/dataset de reporte y job exitoso/fallido. Todos se validan en ambos clientes antes de integración; un endpoint temporal/mocked queda identificado.

### 3.7 Primeras entregas y prevención de dependencias circulares

A01 se divide en **G0a** (esquemas, fixtures e interfaces compilables) y **G0b** (hash/cifrado/importación real Android). B puede iniciar navegación, Python y adaptadores con G0a; G0b se prueba con B04/B05 antes de cerrar sincronización. El motor de reporting tiene solo interfaz en A01 y implementación en A10: nunca devolver resultados falsos para pasar G0.

A15 primero integra un **candidato preliminar** de G0–G5 y publica su SHA; B16 prepara herramientas/variante y un primer APKQA, sin esperar aceptación final. Después A15 y B15 ejecutan aceptación sobre ese candidato en paralelo; B16 cierra su artefacto final solo tras B15. A16 publica después de ambas aceptaciones. Así ninguna tarea necesita que su propia prueba futura ya haya terminado para arrancar.

## 4. Calendario coordinado y puntos de integración

| Fecha | A entrega | B entrega | Puerta de integración |
|---|---|---|---|
| 31/10 | contratos, fixtures, mapa de migración y ramas | entorno Android, módulos base y generador sintético inicial | G0: importar contratos en API, web y Android; tipos/hashes coinciden |
| 01/11 | planes/cuotas, API de suscripción TEST, extensiones comerciales | dataset reproducible, primeras features y navegación modular | G1: dos tiendas aisladas, cuotas y prueba de cobro TEST |
| 02/11 | procesador offline/snapshot/bootstrap y web durable | SQLite, cifrado, cola, catálogo e inventario locales | G2: reinicio offline y mismo comprobante tras respuesta perdida |
| 03/11 | manifiestos y descargas web 3D, motor de reportes compartido | sincronización Android y diez prendas AR offline | G3: web y APK sincronizan contra la misma API; conflictos visibles |
| 04/11 | datasets/reportes/constructor web | dashboards/filtros/exportaciones Android | G4: golden exacto y dashboard interactivo sin red en ambas plataformas |
| 05/11 | IA por texto/voz y puente ML/API/web | modelos evaluados, voz Android y worker/regeneración | G5: jobs reales, marcas demo, cuotas y resultados verificables |
| 06/11 | integración de ramas, contenedor y ensayo de migración/rollback | candidato APK y pruebas en Android real/emulador | G6: compras web/APK/POS aparecen en los mismos reportes del admin |
| 07/11 | despliegue verificado y cierre documental con evidencia | candidato final, compatibilidad de actualización y handoff | G7: checklist de entrega, SHA publicado y evidencia de aceptación |

Son objetivos de secuencia, no resultados cumplidos. No saltar G0/G2/G4 por adelantar pantallas. Si un bloque se retrasa, el otro trabaja con fixtures en su ámbito y comunica la dependencia exacta.

## 5. Cierre de cada tarea

Una tarea solo se marca completa con cambios revisados, pruebas ejecutadas y evidencia. Distinguir `PENDIENTE`, `EN_CURSO`, `BLOQUEADO_POR_CONTRATO`, `VERIFICADO_LOCAL`, `INTEGRADO`, `PUBLICADO`. El dueño de integración asigna los dos últimos estados.

No actualizar el Word mientras otra persona lo edita ni sobrescribir cambios sin guardar. El coordinador recoge evidencias, actualiza la trazabilidad y regenera una copia revisada al final. Nunca registrar precisión ML, tests, uso offline o despliegue como aprobados sin ejecutarlos.


## 6. Orden de trabajo específico de B

| Bloque de jornada | Secuencia y entregable | Qué espera de A |
|---|---|---|
| Día 1, apertura | B00 baseline; B01 esquema/generador; B04 extracción de navegación/errores | G0a esquemas y ejemplos |
| Día 1, continuación | B01 corpus/manifiesto y primer handoffCLI; preparar variante/toolchain B16 | Nombre/forma de AnalyticsJobV1 |
| Día 2 | B02 features/baseline; B04 paquetes; B12/B13 pantallas según contratos; preparar B14 compatibilidad | planes, errores y DTO comerciales |
| Día 3 | B05 SQLite/cifrado y B06/B07 catálogo/stock; B08 sincronización | bootstrap/sync/staging y G0b |
| Día 4 | B09 AR/descargas y B10 constructor/dashboard offline | manifiestos y motor/datasets G3/G4 |
| Día 5 | B02 evaluación final, B03 anomalías/reposición/CLI; B11 texto/voz; B14 regeneración | supervisorML, proveedorIA y contratos avatar |
| Día 6 | B16 primerAPKQA sobre candidato A15; B15 aceptación cruzada/nativa y correcciones | SHA integrado y API QA |
| Día 7 | B16 APK final/metadata, handoff de métricas y evidencia | aceptación conjunta y firma oficial por A |

Los bloques Python no se abandonan mientras se espera API. Entrenamientos largos pueden ejecutarse controladamente mientras se implementa UI, registrando recursos y sin lanzar dos trabajos pesados simultáneos en la VM. No convertir esa concurrencia en dos procesos editando el mismo lock/archivo. B04/B05 y B02/B03 son entregables distintos revisables, no una reescritura masiva.

### Índice ejecutable de B


- [ ] [B00. Preparar entorno portátil, rama propia y baseline Android/Python](#b00)
- [ ] [B01. Generar corpus sintético femenino reproducible y claramente separado](#b01)
- [ ] [B02. Entrenar demanda, baseline y evaluación temporal sin fuga](#b02)
- [ ] [B03. Implementar anomalías, reposición y CLI asíncrono para A](#b03)
- [ ] [B04. Modularizar Android y corregir sesión, transporte y contratos](#b04)
- [ ] [B05. Implementar almacén SQLite privado, cifrado y cola durable](#b05)
- [ ] [B06. Crear catálogo administrativo offline con variantes y adjuntos](#b06)
- [ ] [B07. Implementar deltas y conteo físico offline sin perder stock](#b07)
- [ ] [B08. Sincronizar con recibos idempotentes y recuperación real](#b08)
- [ ] [B09. Descargar diez prendas y mantener AR corporal sin internet](#b09)
- [ ] [B10. Construir reportes, dashboards interactivos y exportación offline](#b10)
- [ ] [B11. Agregar asistencia de reportes por texto y voz con revisión](#b11)
- [ ] [B12. Implementar planes, consumos y suscripción TEST en Android](#b12)
- [ ] [B13. Completar módulos comerciales, perfil, equipo y ubicaciones](#b13)
- [ ] [B14. Pulir worker de avatar, regeneración y enlace con vestidor](#b14)
- [ ] [B15. Ejecutar aceptación Android nativa y pruebas cruzadas](#b15)
- [ ] [B16. Entregar APK candidato de QA, firma y handoff final](#b16)

<a id="b00"></a>
### B00. Preparar entorno portátil, rama propia y baseline Android/Python

**ICONIX:** RF01–RF54; G0. **Depende de:** ninguna.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Leer `apps/mobile/package.json`, `apps/mobile/app.json`, `apps/mobile/src/api.ts`, `apps/mobile/src/App.tsx`, `workers/avatar/requirements.txt` y los contratos recibidos de A.
- Crear `docs/evidencia/saas/equipo-b/B00-entorno.md` y `workers/analytics/README.md`; usar `.local/analytics-venv` para entorno local ignorado.
- B solo modifica `apps/mobile/**`, `workers/analytics/**`, `workers/avatar/**` y evidencia de equipo-b; raíz, Prisma, API y web pertenecen a A.

**Interfaces**

Produce rama desarrollo/android-ml, matriz de versiones Node/JDK/Android/Python y resultado de pruebas existentes. Todavía no produce APK final ni altera servicios publicados.

**Pruebas y resultados esperados**

- `baseline_mobile`: typecheck, Expo check, pruebas de pose y checkout actuales; registrar cualquier fallo anterior sin atribuirlo al nuevo trabajo.
- `native_toolchain`: adb detecta emulador/dispositivo y Gradle dispone de JDK compatible; registrar identidad de paquete y certificado actual antes de preparar builds.
- `python_isolation`: analytics se instala en su propio venv; no modificar los pines de avatar para satisfacer scikit-learn ni usar el Python global como evidencia reproducible.

**Secuencia de ejecución**

- [ ] Clonar o actualizar el repositorio según el arranque común. Revisar rama y cambios propios; crear desarrollo/android-ml desde integración o reutilizarla sin borrar trabajo.
- [ ] Leer este plan completo, la especificación JSON y estado vigente. Anotar SHA de base y qué endpoints faltan; no inventar su respuesta final.
- [ ] Instalar dependencias bloqueadas de raíz y móvil en el clon propio; npm ci no autoriza editar el lock raíz. Si un contrato local aún no llegó, comenzar Python/B01 en paralelo.
- [ ] Inspeccionar herramientas instaladas. Usar Python 3.11 para analytics, compatible con el contenedor Debian 12 actual, en venv propio; si falta, instalar runtime 3.11 antes. Resolver numpy/pandas/scikit-learn/joblib/pytest y fijar versiones exactas comprobadas en Linux/Windows.
- [ ] Ejecutar baseline y registrar salida resumida con fecha. Identificar dispositivo Android de QA y entorno local de API, sin pegar claves ni usar cuentas reales.
- [ ] Acordar con A el primer handoff G0 y avisar requisitos de JDK, Python, memoria y dependencias nativas. Mantener un solo proceso ML pesado por VM.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
git status --short
git log -1 --oneline
node --version
npm ci
npm --prefix apps/mobile ci
npm run mobile:typecheck
npm run mobile:check
npm run mobile:pose-test
npx tsx --test apps/mobile/test/checkout.test.ts apps/mobile/test/checkoutFlow.test.ts
py -0p
py -3.11 -m venv .local/analytics-venv
$taskMlPython = Join-Path (Get-Location) ".local/analytics-venv/Scripts/python.exe"
& $taskMlPython -m pip install --upgrade pip
# B01 crea requirements.txt y requirements.lock.txt; instalar desde lock una vez resuelto/verificado.
adb devices
```

**Criterio de cierre:** Entorno documentado, pruebas iniciales diferenciadas y rama aislada lista; si falta emulador, Python o contrato, la dependencia se informa y se avanza en tareas independientes.

**Commit sugerido:** `b00: preparar entorno portátil, rama propia y baseline android/python`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b01"></a>
### B01. Generar corpus sintético femenino reproducible y claramente separado

**ICONIX:** RF50, RF51; CU26. **Depende de:** B00; no requiere API.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `workers/analytics/lumina_analytics/__init__.py`, `synthetic.py`, `dataset_schema.py`, `manifests.py`, `requirements.txt` y `requirements.lock.txt`.
- Crear `workers/analytics/tests/test_synthetic.py`, `test_manifest.py` y fixtures pequeñas sin información real; corpus completo y modelos quedan en directorio privado de salida.
- Crear `docs/evidencia/saas/equipo-b/B01-dataset.md` con semilla, filas, hash, diccionario, procedencia y comandos.

**Interfaces**

Produce dataset demo-femenino-seed 42-v 1 con source=DEMOSTRACION_SINTETICA, claves de namespace demo y manifiesto versionado. Generación no se conecta a PostgreSQL; A lo registra mediante CU26, no lo importa como ventas reales.

**Pruebas y resultados esperados**

- `full_grid`: exactamente 365 fechas, 36 variantes, 5 ubicaciones, 3 canales y 197100 filas únicas por fecha/variante/ubicación/canal; cantidades enteras >=0, incluidos días de cero.
- `deterministic`: misma semilla/configuración produce mismo contenido normalizado/hash; el instante de generación se guarda fuera del hash reproducible de datos.
- `female_catalog`:12 prendas femeninas con 3 variantes cada una, nombres/categorías/tallas coherentes, catálogo demo explícito; no afirmar que fotos/recursos de marca fueron licenciados.
- `temporal_split`:255/55/55 fechas contiguas y disjuntas, cortes exactos y 28 días de calentamiento; ningún sort aleatorio reparte fechas de una misma serie entre train/test.
- `anomaly_copy`: corpus base permanece intacto; anomalías se inyectan en una copia identificada, con labels/intensidad guardadas para evaluación y nunca en features.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Definir diccionario mínimo: fecha comercial, producto/variante/categoría/talla, ubicación, canal, unidades, precio/importe exacto, procedencia y semilla. Alinear columnas con DTO de dataset A01/A13.
- [ ] Escribir tests de panel y determinismo con fixture pequeña antes de completar el generador. Construir calendario y producto cartesiano completo; no eliminar ceros por falta de ventas.
- [ ] Generar demanda no negativa con patrón semanal/estacional y diferencias por producto/ubicación/canal, ruido determinista y precios coherentes. Documentar que esos patrones fueron diseñados y no observados en el mercado.
- [ ] Separar manifest, datos tabulares, etiquetas de anomalía y README. El hash incluye bytes canónicos definidos; registrar tamaños y versiones del generador.
- [ ] Generar corpus completo, validar 197100 filas y fechas, y entregar a A una fixture pequeña y protocolo de generación. El corpus pesado no se agrega al historial Git por accidente.
- [ ] Si un dashboard demo requiere hechos comerciales adicionales, producir archivos sintéticos coherentes para ese grano y namespace; no tratar panel de demanda agregado como líneas/pagos reales.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
$taskMlPython = Join-Path (Get-Location) ".local/analytics-venv/Scripts/python.exe"
Push-Location workers/analytics
& $taskMlPython -m pytest tests/test_synthetic.py tests/test_manifest.py -q
# El CLI de generación completo se ejecuta cuando B03 publique el contrato.
Pop-Location
```

**Criterio de cierre:** Dataset reproducible con manifiesto y comprobación completa, separado de datos reales; A puede generarlo sin depender del directorio personal de B.

**Commit sugerido:** `b01: generar corpus sintético femenino reproducible y claramente separado`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b02"></a>
### B02. Entrenar demanda, baseline y evaluación temporal sin fuga

**ICONIX:** RF50–RF53; CU26–CU27. **Depende de:** B01; contrato de métricas A01.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `workers/analytics/lumina_analytics/features.py`, `demand.py`, `evaluation.py`, `baseline.py` y `artifacts.py`.
- Crear `workers/analytics/tests/test_features.py`, `test_temporal_evaluation.py`, `test_demand.py`, `test_artifacts.py` y casos de demanda cero/serie nueva.
- Crear `docs/evidencia/saas/equipo-b/B02-demanda.md` con métricas obtenidas, duraciones, memoria, hashes y limitaciones.

**Interfaces**

Produce build_features(panel: pandas.DataFrame) -> pandas.DataFrame con columnas date/sku/location_id/channel/units y features nombradas del documento; pipeline entrenado y resultados contra baseline semanal para horizontes 7/30. recursiveForecast se reutiliza en evaluación y producción. Artefactos contienen versión/hash/configuración y solo se cargan desde namespace autorizado.

**Pruebas y resultados esperados**

- `no_future_feature`: modificar targets futuros no cambia lag/rolling de un origen previo; medias usan shift(1), no incluyen el target actual.
- `recursive_horizon`: desde cada origen, días futuros se predicen usando historia disponible y predicciones previas; no insertar el y real del día anterior dentro del horizonte.
- `category_unknown`: Pipeline+ColumnTransformer+OneHotEncoder(handle_unknown="ignore") aprende categorías solo de train; serie sin historia suficiente devuelve limitación explícita.
- `split_freeze`: validación elige la configuración/umbral; prueba se consulta para evaluación final y no retoca hiperparámetros ni decide qué corrida mostrar.
- `metrics_zero`: MAE/RMSE/WAPE tienen fórmula y agregación documentadas; denominador WAPE0 -> valor null, estado N/A y motivo. No convertir N/A a 0.
- `baseline_honest`: seasonal-naive semanal recursivo sigue el mismo origen/ventana; se registran ambas métricas aunque RandomForest no lo mejore.

**Prueba ancla** — integrar en el archivo de test del bloque; no sustituye las demás assertions:

```python
# Firmar build_features(panel: pandas.DataFrame) -> pandas.DataFrame en features.py.
import pandas as pd
from lumina_analytics.features import build_features
panel = pd.DataFrame({
    'date': pd.date_range('2025-10-01', periods=40),
    'sku': ['demo-v1'] * 40, 'location_id': ['demo-l1'] * 40,
    'channel': ['APP'] * 40, 'units': range(1, 41),
})
features = build_features(panel).set_index('date')
t = pd.Timestamp('2025-10-29')  # día29; unidades actuales29
assert features.loc[t, 'lag_1'] == 28
assert features.loc[t, 'lag_7'] == 22
assert features.loc[t, 'lag_28'] == 1
assert features.loc[t, 'rolling_mean_past_7'] == 25
assert features.loc[t, 'rolling_mean_past_28'] == 14.5
```

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Escribir pruebas de lags 1/7/14/28, rolling 7/28 y calendario con series mínimas calculables a mano. Mantener identificación de serie separada del target.
- [ ] Construir Pipeline con transformadores categóricos y RandomForestRegressor(n_estimators=200, max_depth=12, min_samples_leaf=2, random_state=42, n_jobs=1 inicialmente). Declarar antes de prueba una cuadrícula pequeña de selección: max_depth=[8, 12], manteniendo otros valores; MAE principal. No ampliar por mirar test.
- [ ] Separar fechas exactamente como el documento, retirar calentamiento donde falte historia y registrar cuántas filas válidas quedan por split/serie.
- [ ] Evaluar validación con orígenes diarios: h 7 desde 2026-06-12 hasta 2026-07-30 y h 30 desde 2026-06-12 hasta 2026-07-07. Todas las ventanas objetivo caen dentro de validación; usar mismo origen/ventana para baseline.
- [ ] Congelar elección tras validación y reajustar pipeline sobre train+validation, sin consultar prueba. Modelo final congelado: test h 7 orígenes 2026-08-06..2026-09-23, h 30 orígenes 2026-08-06..2026-08-31, stride 1 día. Contexto puede incorporar observaciones anteriores al nuevo origen, nunca posteriores; no reentrenar con test. Registrar ventanas solapadas como dependientes, no muestras independientes.
- [ ] Ejecutar primero smoke pequeño y luego corrida completa. Registrar MAE/RMSE/WAPE por horizonte y agregado ponderado válido; publicar tiempos y comparación sin inventar mejoras.
- [ ] Guardar pipeline/joblib, metadata y hash con versiones exactas de Python/sklearn/numpy; probar recarga solo con archivo generado de confianza. No agregar pickle arbitrario ni descarga de modelos a demanda.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
$taskMlPython = Join-Path (Get-Location) ".local/analytics-venv/Scripts/python.exe"
Push-Location workers/analytics
& $taskMlPython -m pytest tests/test_features.py tests/test_temporal_evaluation.py tests/test_demand.py tests/test_artifacts.py -q
Pop-Location
# Ejecutar además la corrida completa con request JSON de B03 y registrar duración/métricas reales.
```

**Criterio de cierre:** Entrenamiento/evaluación reproducibles y baseline honesto con artefactos verificables; una prueba de fixture no se presenta como evaluación completa del dataset.

**Commit sugerido:** `b02: entrenar demanda, baseline y evaluación temporal sin fuga`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b03"></a>
### B03. Implementar anomalías, reposición y CLI asíncrono para A

**ICONIX:** RF50–RF54; CU26–CU27. **Depende de:** B01/B02 y contrato AnalyticsJobV1 de A01.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `workers/analytics/lumina_analytics/anomalies.py`, `restock.py`, `cli.py`, `job_schema.py` y `result_schema.py`.
- Crear `workers/analytics/tests/test_anomalies.py`, `test_restock.py`, `test_cli.py`, `test_job_scope.py` y requests de ejemplo sanitizados en `workers/analytics/examples/`.
- Crear `docs/evidencia/saas/equipo-b/B03-worker-handoff.md`; fijar requirements analíticos reproducibles y consumo esperado.

**Interfaces**

Implementa python -m lumina_analytics.cli --job request.json y las 5 acciones de sección 3.5. Exporta suggested_quantity(*, demand_during_lead: float, safety_stock: int, available: int, confirmed_inbound_not_in_available: int) -> int desde restock.py. No accede a DB, no decide plan/rol ni lanza HTTP; A autoriza y supervisa. Stdout único JSON, logs stderr, errores seguros, resultPath relativo y hashes comprobables.

**Pruebas y resultados esperados**

- `anomaly_no_label_leak`: labels, intensidad, flags y columnas derivadas de la inyección no son features; permutarlos no altera score a inputs iguales.
- `anomaly_threshold`: threshold y parámetros elegidos en train/validation, congelados antes de test; matriz TP/FP/TN/FN y precisión/recall/F1 con N/A definido cuando corresponde.
- `restock`: propuesta=max(0, ceil(demanda_del_plazo + seguridad - disponible - entrante_confirmado)); plazo/seguridad/entrante tienen origen y unidad visibles, sin doble descontar reservas ya en disponible. Nunca escribe stock automáticamente.
- `cli_protocol`: éxito exit 0 y unJSON; fallo no 0 y error.code seguro; rechazo de acción/horizonte/paths no autorizados, symlink hacia fuera y resultado de otro job.
- `scope_and_hash`: artefacto/resultado corresponden a tenantId/jobId/source y checksum; un modelo de otra tienda o hash alterado no se carga.
- `insufficient_real`: REAL sin historia válida devuelve MODEL_DATA_INSUFFICIENT o limitación; no sustituir por ventas sintéticas ni entregar falsa predicción real.

**Prueba ancla** — integrar en el archivo de test del bloque; no sustituye las demás assertions:

```python
# Contrato a exportar desde restock.py; todos los argumentos son unidades.
from lumina_analytics.restock import suggested_quantity
assert suggested_quantity(
    demand_during_lead=12, safety_stock=3, available=7,
    confirmed_inbound_not_in_available=2,
) == 6
assert suggested_quantity(
    demand_during_lead=0, safety_stock=0, available=7,
    confirmed_inbound_not_in_available=0,
) == 0
```

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Definir features de anomalías a partir de comportamiento e historia disponible y generar labels solo para medición; entrenar IsolationForest con random_state 42 y n_jobs acotado.
- [ ] Calibrar umbral en validación, congelar y evaluar test; registrar balance de anomalías e indicadores, incluyendo denominadores cero.
- [ ] Implementar reposición basada en forecast/snapshot y reglas explícitas de seguridad/plazo. Si no hay historia, devolver regla básica y limitación diferenciada, sin llamarla predicción ML.
- [ ] Implementar CLI de las 5 acciones con esquema estricto, rutas resueltas dentro de workDir privado y logs estructurados. No pasar argumentos del usuario a una shell.
- [ ] Probar requests completos y fallidos en subprocess; verificar un solo JSON final, códigos de salida, hashes, tamaño y cancelación por supervisor. El timeout/concurrencia es responsabilidad de A13.
- [ ] Entregar requirements.lock analítico y comando portable; acordar con A un venv ANALYTICS_PYTHON_PATH separado del worker avatar para evitar conflictos de NumPy/MediaPipe.
- [ ] Entregar a A un handoff con input/output reales, fixture pequeña, versiones, métricas y limitaciones. Ejecutar una llamada integrada cuando A13 esté disponible.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
$taskMlPython = Join-Path (Get-Location) ".local/analytics-venv/Scripts/python.exe"
Push-Location workers/analytics
& $taskMlPython -m pytest tests/test_anomalies.py tests/test_restock.py tests/test_cli.py tests/test_job_scope.py -q
& $taskMlPython -m lumina_analytics.cli --job examples/generate-demo.json
Pop-Location
# Los paths de examples se resuelven conforme al CLI; preparar workDir local existente antes de ejecutar.
```

**Criterio de cierre:** A puede invocar el worker real con protocolo estable; anomalías/reposición son evaluables, privadas y demo explícita, sin mutaciones comerciales ocultas.

**Commit sugerido:** `b03: implementar anomalías, reposición y cli asíncrono para a`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b04"></a>
### B04. Modularizar Android y corregir sesión, transporte y contratos

**ICONIX:** RF04–RF07, RF34, RF35–RF44; CU03/CU23. **Depende de:** B00; A01 para consumir packages.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Modificar `apps/mobile/src/api.ts`, `types.ts`, `App.tsx`, `AdminDashboard.tsx`, `apps/mobile/package.json`, su lock, `metro.config.js` y configuración TypeScript móvil cuando sea necesario.
- Crear `apps/mobile/src/modules/registry.ts`, `navigation/AdminNavigator.tsx`, `auth/sessionScope.ts`, `auth/offlineIdentity.ts`, `errors/ApiProblem.ts` y componentes comunes.
- Crear `apps/mobile/test/sessionScope.test.ts`, `apiProblems.test.ts`, `canonicalIntent.test.ts` y script móvil `test:unit` con tsx/node:test compatible con las pruebas actuales.

**Interfaces**

Conserva sessionEpoch actual y lo extiende a repositorios/descargas; exporta ScopeKey/TypedApiError. API distingue red, 401, 403, 402, 409 y 422. Módulos: Inicio, Catálogo, Inventario, Ventas/Pedidos, Equipo, Ubicaciones, Reportes/Análisis, Sincronización y Mi negocio, filtrados por permiso.

**Pruebas y resultados esperados**

- `late_response`: respuesta/refresh/evento de tienda anterior no actualiza token, UI, caché o cola de la nueva identidad.
- `offline_restore`: fallo de red restaura identidad local autorizada y deja cola intacta; credencial inválida produce bloqueo/login visible; no vaciar SecureStore por cualquier catch.
- `form_data`: body FormData no lleva Content-Type application/json impuesto; fetch construye boundary y servidor recibe fotos/audio.
- `problem_mapping`: API preserva code/status/retryable/correlationId; un timeout no se transforma en éxito y un 403 no entra en bucle de refresh.
- `shared_runtime`: import real de @lumina/contracts y @lumina/reporting en Metro/Hermes, hashes iguales a fixtures Node; no resolver el problema duplicando lógica privada en Android.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Agregar pruebas sobre sessionEpoch y wrappers antes de refactorizar. Preservar autenticación actual, checkout y módulo pose durante la extracción.
- [ ] Crear navegación modular basada en permisos/capacidades y separar estado de negocio por ScopeKey; administradora de negocio no equivale a operadora global.
- [ ] Consumir paquetes A01 mediante file:../../packages y actualizar solo lock móvil; configurar Metro/TS y validar bundle. Informar a A cualquier necesidad de raíz en vez de editarla.
- [ ] Corregir restauración de sesión offline, errores tipados, cancelación y respuestas tardías; toda petición/descarga captura scope+epoch al empezar y comprueba ambos al aplicar.
- [ ] Corregir transporte multipart y canal APP, conservar headers de tienda y compatibilidad de endpoints existentes.
- [ ] Agregar test:unit para los tests puros móviles y documentar qué pruebas nativas requieren dispositivo. No pretender probar SecureStore/SQLite real solo con mocks Node.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm run build:shared
npm --prefix apps/mobile install
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run check
npm --prefix apps/mobile run test:unit
# Crear el bundle Android de QA después de instalar dependencias nativas en B05/B16.
```

**Criterio de cierre:** Aplicación modular sin romper sesión/compras, paquetes compartidos compilados y aislamiento de respuestas comprobado; navegación vacía no acredita módulos terminados.

**Commit sugerido:** `b04: modularizar android y corregir sesión, transporte y contratos`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b05"></a>
### B05. Implementar almacén SQLite privado, cifrado y cola durable

**ICONIX:** RF35–RF44; CU20–CU23. **Depende de:** B04; bootstrap/sobre de cifrado A01/A07.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/mobile/src/offline/db.ts`, `migrations.ts`, `vault.ts`, `crypto.ts`, `scope.ts`, `intentRepository.ts`, `projection.ts` y `OfflineProvider.tsx`.
- Instalar con Expo las versiones compatibles SDK57 de expo-sqlite, expo-file-system, expo-crypto y expo-network; modificar solo manifests/lock móviles.
- Crear `apps/mobile/test/offlineQueue.test.ts`, `vaultEnvelope.test.ts`, `scopeIsolation.test.ts`; agregar pruebas de almacenamiento nativo en `apps/mobile/e2e/`.

**Interfaces**

Almacenes SQLite por identidad o claves compuestas obligatorias, payloads privados cifrados con AES-GCM, DEK por dispositivo/actor/tienda recuperado online. enqueueIntent inserta intención y proyección optimista en transacción exclusiva; no guardar saldo como verdad global.

**Pruebas y resultados esperados**

- `queue_atomicity`: corte entre encolar y proyectar produce ambas escrituras o ninguna; no operación sin efecto local ni efecto local sin intención.
- `restart_durable`: cerrar proceso y reabrir offline conserva pendientes/catálogos/dashboard con misma identidad; migración conserva cola previa o falla de modo recuperable.
- `aes_fixture`: sobre Node/WebCrypto/Expo compatible, nonce no repetido, AAD diferente o bit alterado rechazan descifrado; nada de claves maestras en app.
- `logout_keep`: conservar pendientes elimina DEK activa y bloquea datos; login online misma identidad/dispositivo recupera copia; otra cuenta no los abre ni sincroniza.
- `storage_failure`: disco lleno/escritura fallida deja estado consistente y error visible; no avanzar contador de éxito ni borrar recurso fuente.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Revisar esquema de caché: identidad, entidades/versiones, intents/recibos/dependencias, manifiestos/archivos y datasets/reportes. Índices por scope/estado y claves únicas por operationId.
- [ ] Implementar migraciones locales con versión, pruebas y recuperación; separar metadata mínima de payloads sensibles cifrados. Repositorios siempre exigen ScopeKey.
- [ ] Implementar adaptador criptográfico compatible con sobre A01 y SecureStore para material activo; primero ejecutar fixture cruzada, no improvisar un formato distinto.
- [ ] Usar transacción SQLite exclusiva para enqueue+projection y receipt+rebase. Si la criptografía requiere trabajo asíncrono fuera de transacción, preparar ciphertext antes y revalidar versión dentro.
- [ ] Implementar conservar/descartar pendientes al logout, purga de temporales y recuperación de DEK via bootstrap. No borrar por timeout ni enviar cola bajo la cuenta recién elegida.
- [ ] Ejecutar cierre forzado/reinicio y fallo de almacenamiento en Android real/emulador. Registrar qué fallos se simularon en repositorio y cuáles se observaron nativamente.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
Push-Location apps/mobile
npx expo install expo-sqlite expo-file-system expo-crypto expo-network
npm run typecheck
npm run check
npm run test:unit
Pop-Location
# En dispositivo QA: terminar y relanzar sin clearState, conservando datos; comprobar cola en modo avión.
```

**Criterio de cierre:** Datos y cola sobreviven reinicio sin red, aislados y protegidos; el usuario distingue pendientes conservados de descartados y puede recuperar su copia tras login autorizado.

**Commit sugerido:** `b05: implementar almacén sqlite privado, cifrado y cola durable`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b06"></a>
### B06. Crear catálogo administrativo offline con variantes y adjuntos

**ICONIX:** RF08–RF13, RF38–RF44; CU06/CU21/CU23. **Depende de:** B05; DTO/factories A01 y API catálogo A05/A08.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/mobile/src/modules/catalog/CatalogAdminScreen.tsx`, `ProductEditor.tsx`, `VariantEditor.tsx`, `offlineCatalog.ts`, `attachmentStaging.ts` y validaciones.
- Modificar `apps/mobile/src/CatalogScreen.tsx` para lectura local/estado de descarga sin cambiar el vestidor a productos genéricos.
- Crear `apps/mobile/test/offlineCatalog.test.ts`, `catalogDependencies.test.ts` y flujo nativo de crear/editar/archivar con conexión perdida.

**Interfaces**

Produce intenciones CATALOG_CREATE/UPDATE/ARCHIVE con UUID estables, baseVersion y dependsOn. Adjuntos se copian a almacenamiento privado, se suben a staging al reconectar y solo entonces se envía referencia validada; el payload firmado no se muta.

**Pruebas y resultados esperados**

- `create_edit_dependency`: alta offline seguida de edición usa relación/versión explícitas; sincroniza en orden sin inventar versión de servidor ni enviar patch al ID equivocado.
- `archive_not_hard_delete`: quitar producto usa archivo lógico, conserva historia y sigue contando capacidad; doble toque no crea dos intenciones.
- `variant_ids`: variantes y precios por canal conservan UUID/centavos; foto de catálogo no se marca como GLB o PNG AR compatible.
- `attachments`: recurso corrupto, MIME distinto, archivo inexistente o cuota fallida no aparece como subido; dependencia queda visible y recuperable.
- `conflict_patch`: versión vieja muestra diferencia servidor/local; resolver crea UUID nuevo con versión actual y deja traza del original, nunca reescribe payload firmado.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Crear formularios de producto/categoría/variantes/tallas/precios/estado usando catálogo real femenino y validadores compartidos; preservar DTOs existentes al adaptar.
- [ ] Escribir pruebas de factories de intención y dependencias. Definir cómo encadenar cambios sobre una entidad recién creada sin baseVersion de servidor: una creación completa antes de encolar o patch dependiente con resolución validada por A01.
- [ ] Implementar lecturas locales con indicadores pendiente/conflicto/bloqueado y proyección reversible; no usar la lista en memoria como persistencia.
- [ ] Agregar adjuntos offline y staging determinista. A01 debe fijar referencia estable de recurso por hash/UUID para que upload posterior no cambie el contenido firmado.
- [ ] Implementar archivo y recuperación de conflictos. Si una operación no puede salir por capacidad/plan, conservarla y explicar cómo resolverla sin borrar catálogo.
- [ ] Probar creación/edición/archivo en modo avión, cierre forzado y sincronización contra API real; registrar IDs en handoff A07.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm --prefix apps/mobile run test:unit
npm --prefix apps/mobile run typecheck
# Ejecutar flujo Android offlineCatalog.yaml con APK QA y API local integrada.
```

**Criterio de cierre:** Administradora puede crear/editar/archivar catálogo femenino sin red y sincronizar una sola vez, con variantes/adjuntos/versiones y errores visibles.

**Commit sugerido:** `b06: crear catálogo administrativo offline con variantes y adjuntos`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b07"></a>
### B07. Implementar deltas y conteo físico offline sin perder stock

**ICONIX:** RF14–RF16, RF39–RF44; CU09–CU11/CU22–CU23. **Depende de:** B05; reglas compartidas A01/A05/A07.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/mobile/src/modules/inventory/InventoryScreen.tsx`, `StockDeltaForm.tsx`, `StockCountForm.tsx`, `stockProjection.ts` y `StockConflictView.tsx`.
- Crear `apps/mobile/test/stockProjection.test.ts`, `stockIntent.test.ts` y casos de concurrencia contra servidor en evidencia equipo-b.

**Interfaces**

STOCK_DELTA expresa cambio entero de físico, no saldo absoluto. STOCK_COUNT expresa observación/baseVersion. Siempre mostrar físico/reservado/comprometido/disponible y estado local; transferencias solo online mediante operación atómica A05.

**Pruebas y resultados esperados**

- `delta_concurrent`: stock 10, móvil+3 y web-2 ->11 en servidor aunque ambos partieran de 10; la cola móvil no impone 13 como saldo final.
- `count_stale`: conteo físico desde versión antigua y venta concurrente ->CONFLICT, conserva observación y solicita resolver; no reintentar cambiando baseVersion silenciosamente.
- `lower_bound`: operación que deja físico<reservado+comprometido se bloquea o entra en conflicto; no mostrar disponible negativo como ajuste aceptado.
- `role_location`: ubicación no autorizada, variante ajena o permiso revocado no se puede sincronizar, aunque el formulario local hubiera estado abierto.
- `no_offline_transfer`: botón transferencia explica conexión requerida y no crea dos deltas sueltos para simular atomicidad.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Escribir pruebas de saldo y proyección con valores exactos; separar stock confirmado, cambios pendientes y disponible estimado.
- [ ] Construir módulo por ubicación/variante con búsqueda, filtros y detalle de movimientos/versiones; no esconder reservas/comprometidos.
- [ ] Implementar delta positivo/negativo con motivo, validación entera y UUID; conteo con observación y baseVersion guardadas en el momento de iniciar/confirmar.
- [ ] Agregar vista de conflictos con saldo confirmado actual, observación local y acciones recontar/descartar/crear nueva intención; mantener auditoría del original.
- [ ] Bloquear transferencia offline y conservar flujo online transaccional A05; probar que no se rebaja origen sin acreditar destino.
- [ ] Ejecutar con A dos clientes concurrentes, venta en web y sincronización APK; registrar ID de movimiento/recibo y saldo final persistido.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm --prefix apps/mobile run test:unit
npm --prefix apps/mobile run typecheck
# Integración: delta+delta, conteo+venta y doble envío con saldo consultado desde API/admin web.
```

**Criterio de cierre:** Inventario Android es útil sin red y coherente con ventas/reservas del servidor; los conflictos requieren decisión visible y no pérdida de trabajo.

**Commit sugerido:** `b07: implementar deltas y conteo físico offline sin perder stock`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b08"></a>
### B08. Sincronizar con recibos idempotentes y recuperación real

**ICONIX:** RF38–RF44; CU21–CU23. **Depende de:** B05–B07 y API A07/A08.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/mobile/src/offline/syncCoordinator.ts`, `syncTransport.ts`, `retryPolicy.ts`, `receiptReducer.ts`, `dependencyGraph.ts` y `SyncScreen.tsx`.
- Crear `apps/mobile/test/syncRecovery.test.ts`, `syncDependencies.test.ts`, `syncIdentity.test.ts` y `receiptReducer.test.ts`.
- Crear `docs/evidencia/saas/equipo-b/B08-sincronizacion.md` con casos de respuesta perdida, cierre forzado, plan vencido y rol revocado.

**Interfaces**

Un coordinador activo por identidad/dispositivo; lote<=100, orden de dependencias y estado por operación. Recupera recibo de UUID antes de repetir efecto tras resultado incierto. Transporte/estado no cambian el hash inmutable.

**Pruebas y resultados esperados**

- `lost_response`: servidor commit, respuesta se pierde, app se cierra; al volver consulta/reenvía mismoUUID y aplica el recibo sin segunda mutación.
- `same_id_new_payload`: UUID existente y contenido distinto ->409 IDEMPOTENCY_PAYLOAD_MISMATCH; detener error técnico, no cambiar UUID en bucle para forzar efecto.
- `terminal_mapping`: recibo APPLIED->APPLIED, CONFLICT->CONFLICT y REJECTED->CONFLICT con motivo terminal visible; conservar status servidor, sin inventar estado local REJECTED fuera del contrato.
- `transient_block`: auth/plan/permiso sin resultado terminal ->BLOCKED, mantiene intención; fallo de red/backoff deja PENDING. SENDING al reiniciar se reconcilia, no se pierde.
- `identity_switch`: respuesta tardía de sincronización anterior se guarda solo en su repositorio autorizado o se difiere; nunca se aplica a nueva cuenta/tienda.
- `dependencies`: si padre entra en conflicto, hija queda BLOCKED; no marcar lote entero exitoso ni descartar hija. Bucle de dependencias se rechaza localmente.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Escribir máquina de estados/recibos con tests antes de conectar red. Guardar el recibo y actualizar proyección en una única transacción local.
- [ ] Implementar disparadores foreground, retorno de red, reanudación y botón manual; no prometer sincronización continua con Android terminado por el SO.
- [ ] Implementar backoff exponencial acotado con jitter y cancelación por epoch; no reintentar automáticamente un conflicto como si fuera timeout.
- [ ] Preparar/validar adjuntos antes de enviar intención; enviar dependencias en orden y comprobar respuesta individual. Repetir lotes seguros sin regenerar UUID.
- [ ] Reconciliar estados inciertos consultando recibos bajo misma identidad. Conservar cola cuando vence suscripción o se pierde autenticación y explicar acción necesaria.
- [ ] Agregar panel con pendientes/enviando/aplicadas/conflictos/bloqueadas, fecha, motivo/correlationId y reintento autorizado. El descarte explícito no borra historia de un APPLIED.
- [ ] Probar contra API real pérdida de respuesta tras commit, dos dispositivos, cambio de tienda y cierre forzado. Entregar evidencia G2/G3 a A antes de considerar offline integrado.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm --prefix apps/mobile run test:unit
npm --prefix apps/mobile run typecheck
# Ejecutar los flujos nativos de recuperación contra API integrada y consultar recibos desde el servidor.
```

**Criterio de cierre:** La cola se recupera y converge sin duplicar efectos, con conflictos y bloqueos explicados; existe evidencia de red/proceso interrumpidos sobre SQLite y API reales.

**Commit sugerido:** `b08: sincronizar con recibos idempotentes y recuperación real`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b09"></a>
### B09. Descargar diez prendas y mantener AR corporal sin internet

**ICONIX:** RF21–RF24, RF35–RF37, RF44; CU15/CU20. **Depende de:** B05; manifiestos A08, contratos de pose existentes.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/mobile/src/modules/fitting/OfflineWardrobeScreen.tsx`, `downloadManager.ts`, `resourceManifest.ts`, `privateResources.ts` y `downloadSelection.ts`.
- Modificar `apps/mobile/src/CatalogScreen.tsx`, `pose.ts` y el módulo `apps/mobile/modules/pose-landmarker/**` solo si la verificación exige empaquetar/corregir recursos locales.
- Crear `apps/mobile/test/outfitDownloads.test.ts`, `resourceCompatibility.test.ts`, `downloadIdentity.test.ts` y evidencia nativa de cámara/pose sin red.

**Interfaces**

Consume manifiesto ANDROID_AR de A08, hasta 10 prendas elegidas según preferencias y selección de clienta; PNG transparente/hash/tamaño/anchor y modelo pose disponible localmente. Android no interpreta GLB como prenda AR ni ofrece reconstrucción 3D offline.

**Pruebas y resultados esperados**

- `ten_limit`: máximo 10 prendas completas por identidad; reemplazar una libera recursos sin borrar las que todavía se usan. Recuento distingue parcial/compatible/lista.
- `integrity`: pausa/red/disco lleno/hash incorrecto dejan descarga parcial recuperable; publicar recurso como listo solo tras verificación y escritura atómica del manifiesto.
- `real_offline_ar`: tras descargar, modo avión y arranque en frío permiten abrir cámara, detectar pose y cambiar prenda sin CDN, modelo remoto o fetch oculto.
- `private_switch`: cambio de cuenta/tienda/logout cancela descarga y limpia temporales; un PNG o avatar de la identidad anterior no aparece en la nueva.
- `compatibility`: prenda sin PNG AR válido se muestra incompatible y no ocupa cupo como lista; vestidor webGLB sigue su flujo separado.
- `permission_fallback`: cámara denegada, dispositivo sin capacidad o pose perdida muestran instrucciones y permiten gestionar descargas; no simular tracking exitoso.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Inspeccionar modelo pose y assets actuales: confirmar que build contiene modelo/metadata o que la descarga necesaria forma parte del paquete verificado; documentar tamaño/licencia.
- [ ] Implementar selección por gustos/categorías/tallas y selección manual, respetando hasta 10; A elige candidatos del catálogo autorizado y B verifica compatibilidad real.
- [ ] Implementar gestor con progreso, cancelación, reintento, staging, hashes y cuota de disco. Guardar archivos privados cifrados y manifiestos por scope.
- [ ] Cuando renderer nativo necesite archivo plano, descifrar a temporal privado de app, no galería/almacenamiento compartido; purgar en logout/cambio de identidad y al iniciar tras caída.
- [ ] Conectar renderer corporal existente al repositorio local. Mantener ajuste/escala/orientación y aviso de aproximación; no reemplazar seguimiento por imagen fija.
- [ ] Ejecutar cámara/pose con modo avión después de cerrar aplicación y registrar evidencia en dispositivo. Revisar que no hay llamadas fallidas obligatorias para abrir el vestidor.
- [ ] Probar cambio de tienda durante descarga y recurso corrupto; entregar G3 con IDs de manifiestos y hashes, sin copiar fotos privadas a evidencia.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm --prefix apps/mobile run test:unit
npm run mobile:pose-test
npm --prefix apps/mobile run typecheck
# Dispositivo QA: descargar prendas, cerrar app, activar modo avión y abrir cámara/vestidor desde cero.
```

**Criterio de cierre:** Una clienta puede probar hasta 10 prendas compatibles con tracking real sin red; identidad, integridad, capacidad y limpieza de recursos comprobadas.

**Commit sugerido:** `b09: descargar diez prendas y mantener ar corporal sin internet`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b10"></a>
### B10. Construir reportes, dashboards interactivos y exportación offline

**ICONIX:** RF45–RF48, RF52–RF54; CU24/CU27. **Depende de:** B05; motor A10 y conjuntos A11.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/mobile/src/modules/reports/ReportBuilderScreen.tsx`, `FilterEditor.tsx`, `DashboardScreen.tsx`, `ReportDetail.tsx`, `DatasetDownloads.tsx`, `reportRepository.ts` y `exportReport.ts`.
- Crear gráficos interactivos con `react-native-svg` ya instalado; instalar expo-print/expo-sharing compatibles SDK57 para PDF/CSV locales.
- Crear `apps/mobile/test/reportGolden.test.ts`, `reportCoverage.test.ts`, `reportExports.test.ts` y flujo nativo `reportsOffline.yaml`.

**Interfaces**

Consume @lumina/reporting, misma DSL/semántica de A10 y datasets privados A11; define filtros, agrupación, comparación, chart/layout y selección cruzada sin acceder a servidor cuando dataset cubre la consulta. Resultados ML descargados son demo rotulada, separados de REAL.

**Pruebas y resultados esperados**

- `golden_parity`: fixture común ->22000 centavos, 4 unidades, 2 pedidos, ticket 11000, devuelta 1/reembolso 5000 separados; mismo JSON significativo en Node/Hermes/navegador.
- `filters`: fecha/canal/ubicación/producto/categoría/talla/color/estado/método/tipo/otras dimensiones del catálogo permitido, operadores/tipos/orden validados; límites 10 métricas/5 dimensiones/20 filtros.
- `offline_interactive`: agrupar/filtrar/comparar/tocar gráfico recalcula KPIs/detalle offline; conservar selección, limpiar filtro y volver al estado anterior sin perder definición.
- `coverage`: consulta fuera de período/ubicación/columnas o conjunto truncado no devuelve falso 0; banner de cobertura/asOf/procedencia y acción descargar al reconectar.
- `exports`: CSV escapa comillas/separadores y fórmulas al abrir en hoja de cálculo; PDF sin fuentes/imágenes de red incluye filtros, fuente, fecha, cobertura y métricas N/A legibles.
- `guarded_ml`: Esencial no ejecuta jobsML; Pro demanda/reposición; Negocio anomalías/comparación; resultados demo visibles como demo, no dentro de ventas reales.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Agregar antes tests del golden común y fixtures de cobertura; cualquier diferencia se resuelve con A10 en el motor compartido, no duplicando reglas en una pantalla.
- [ ] Implementar constructor de métricas/dimensiones/filtros desde catálogo tipado, periodo/comparación, orden/límite y diseño guardado. UI valida pero servidor valida de nuevo al guardar.
- [ ] Descargar conjunto por páginas con corte/hash, hasta 50000 filas y cobertura explícita, guardado transaccional/cifrado. No publicar descarga parcialmente completada como dataset completo.
- [ ] Construir tarjetas KPI, gráfico apropiado y tabla de detalle con paginación/virtualización, interacción accesible, selección cruzada y reset. No traer librería webDOM a ReactNative.
- [ ] Implementar guardar/duplicar/eliminar definición y borrador offline, sincronización de definición vía API online dedicada; no inventar sexto kind de cola comercial. Conflictos de definición conservan copia y versión.
- [ ] Agregar CSV/PDF local y compartir con acción explícita; limpiar temporales y ocultar exportación sin permiso. Incluir marca DEMOSTRACION_SINTETICA cuando corresponda.
- [ ] Probar rendimiento con conjunto máximo y valores exactos; medir memoria/duración y añadir límite visible si dispositivo no alcanza, sin silenciosamente truncar resultados.
- [ ] Ejecutar en modo avión después de reiniciar: abrir dashboard descargado, cambiar filtros, seleccionar gráfico y exportar. Grabar evidencia G4 junto al resultado del mismo golden en API/web.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
Push-Location apps/mobile
npx expo install expo-print expo-sharing
npm run test:unit
npm run typecheck
npm run check
Pop-Location
# Ejecutar reportsOffline.yaml en Hermes/Android con dataset descargado y sin red.
```

**Criterio de cierre:** Reportes configurables y dashboard interactivo funcionan sin red con exactitud y cobertura demostradas; exportaciones y restricciones de plan no dependen de una maqueta.

**Commit sugerido:** `b10: construir reportes, dashboards interactivos y exportación offline`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b11"></a>
### B11. Agregar asistencia de reportes por texto y voz con revisión

**ICONIX:** RF49; CU25. **Depende de:** B10; interpret/transcribe A12.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/mobile/src/modules/reports/ReportAssistant.tsx`, `VoiceRecorder.tsx`, `assistantFlow.ts` y estados de consumo/error.
- Instalar expo-audio compatible SDK57 y revisar permiso RECORD_AUDIO en app config/Android; no usar claves de proveedor en EXPO_PUBLIC_*.
- Crear `apps/mobile/test/reportAssistant.test.ts`, `voiceLifecycle.test.ts` y evidencia de texto/voz contra proveedor TEST/configurado.

**Interfaces**

Audio temporal -> /reports/transcribe -> texto editable -> /reports/interpret con UUID -> DSL propuesta -> revisión/ejecución manual. Un mismo pedido de interpretación consume una cuota, no cada reintento/transcripción; filtros siguen disponibles offline.

**Pruebas y resultados esperados**

- `review_first`: propuesta visible con filtros/métricas interpretadas antes de ejecutar/guardar; texto ambiguo muestra advertencia y se puede corregir.
- `single_quota`: doble toque/reintento conserva operationId y no descuenta 2; cancelación/fracaso definitivo sigue política de reserva A12.
- `offline_fallback`: sin conexión, límite agotado, Esencial o proveedor ausente muestran motivo y abren filtros manuales; no inventar respuesta IA con regex y llamarla proveedor real.
- `audio_cleanup`: cancelar/salir/logout/denegar permiso detiene grabación y purga temporal; tamaño/duración/MIME limitados por contrato.
- `multipart`: upload real funciona sin Content-Type JSON forzado; errores tipados y correlación quedan visibles sin filtrar audio ni claves a logs.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Consumir contratos publicados de audio/texto y catálogo de DSL, incluidos límites. Si A12 no está listo, probar estados con fixtures y marcar integración pendiente.
- [ ] Agregar grabación/permiso/medidor/fin/cancelar con API de ExpoAudio resuelta para SDK57; no introducir paquete obsoleto por copiar ejemplo latest.
- [ ] Enviar audio temporal autorizado, mostrar transcripción editable y luego propuesta validada. Mantener UUID de interacción y texto original para revisión local autorizada.
- [ ] Agregar estado de cuota y disponibilidad online, confirmación de ejecución y ruta directa a filtros manuales.
- [ ] Probar con voz real breve y proveedor configurado; si solo hay mock, registrar verificado contra fixtures y no cerrar CU25 integrado.
- [ ] Verificar abandono de pantalla/app, llamada fallida y cambio de identidad con grabación activa; limpiar todos los temporales.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
Push-Location apps/mobile
npx expo install expo-audio
npm run test:unit
npm run typecheck
npm run check
Pop-Location
# Prueba integrada: voz -> texto editable -> propuesta -> aprobación -> dashboard; repetir sin red con filtros manuales.
```

**Criterio de cierre:** Texto/voz online terminan en reporte revisable y cuota correcta; offline conserva constructor completo, sin secretos de proveedor ni audio persistente innecesario.

**Commit sugerido:** `b11: agregar asistencia de reportes por texto y voz con revisión`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b12"></a>
### B12. Implementar planes, consumos y suscripción TEST en Android

**ICONIX:** RF01–RF03, RF20, RF34; CU01–CU02. **Depende de:** B04; suscripción/capacidades A03/A04.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/mobile/src/modules/business/MyBusinessScreen.tsx`, `PlansScreen.tsx`, `UsagePanel.tsx`, `SubscriptionCheckout.tsx` y `subscriptionState.ts`.
- Instalar expo-web-browser compatible SDK57 para Checkout Stripe alojado; no agregar formulario que capture tarjetas ni Stripe secret key en cliente.
- Crear `apps/mobile/test/subscriptionUi.test.ts`, `subscriptionReturn.test.ts`, `entitlementRoutes.test.ts` y evidencia de QR simulado/Stripe TEST.

**Interfaces**

Lee Entitlements del servidor, abre Checkout HTTPS y al volver consulta estado confiable. QR_SIMULATED confirma intención autorizada, nunca intenta cobro real. Cancelar renovación conserva acceso hasta periodTo; cambio de plan muestra precio/ciclo/límites antes de confirmar.

**Pruebas y resultados esperados**

- `plans_exact`: Bs 149/299/599 y límites/capacidades correctos; staff no incluye compradoras y productos archivados siguen contados.
- `return_not_payment`: redirect o cierre de navegador no activa plan; mostrar pendiente hasta consultar intención/evento confirmado por API.
- `cycle_visibility`: confirma que cambio inmediato abre ciclo completo sin prorrateo; consumo y fechas reflejan respuesta del servidor, no calendario calculado por móvil.
- `downgrade_block`: plan menor incompatible muestra detalle y no borra ubicaciones/productos/equipo; cancelación no suspende acceso pagado anticipadamente.
- `expired_readonly`: conserva lectura/exportación de datos propios descargados y pendientes bloqueados; mutaciones online fallan claramente y pueden recuperarse tras renovar.
- `roles`: solo propietaria/permiso autorizado puede contratar/cancelar; operadora global no aparece como rol comercial automático.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Construir Mi negocio/planes/consumo con datos API y mensajes TEST/QRsimulado inequívocos; no codificar autorización solo ocultando botones.
- [ ] Implementar alta/provisión mediante flujo ofrecido por A03: selección de tienda pública autorizada y alta de negocio según contrato; no inventar credenciales de superadministración.
- [ ] Agregar intención de Checkout con UUID, apertura de navegador y reconsulta idempotente al retornar/foreground; estado pending no se traduce a activo por tiempo transcurrido.
- [ ] Agregar confirmación QR simulada, detalle de plan/ciclo/cupo y cancelación de renovación con regla explícita. UI reutiliza status/capabilities del servidor.
- [ ] Integrar vencimiento/cambio plan con cola y módulos: lectura útil offline, nuevas escrituras locales marcadas condicionadas y servidor decide al sincronizar.
- [ ] Ejecutar Stripe TEST y QR_SIMULATED con A; guardar solo IDs y evidencia sanitizada. Si faltan credenciales TEST, registrar bloqueo de prueba específica sin falsear confirmación.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
Push-Location apps/mobile
npx expo install expo-web-browser
npm run test:unit
npm run typecheck
npm run check
Pop-Location
# Integración: confirmar QR simulado, Checkout TEST, retorno sin pago, descenso bloqueado y cancelación con fecha fin visible.
```

**Criterio de cierre:** Android expone suscripción SaaS coherente con API/planes, sin activar por redirect ni mezclar dos negocios; cuotas/vigencia tienen evidencia de integración.

**Commit sugerido:** `b12: implementar planes, consumos y suscripción test en android`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b13"></a>
### B13. Completar módulos comerciales, perfil, equipo y ubicaciones

**ICONIX:** RF04–RF16, RF25–RF34; CU04–CU11/CU16–CU19. **Depende de:** B04/B12; API A05/A14.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Modificar `apps/mobile/src/MobileCommerceSheet.tsx`, `checkoutFlow.ts`, `checkoutBlocker.ts`, `AccountSheet.tsx` y pantallas existentes conservando regresiones.
- Crear `apps/mobile/src/modules/orders/OrdersScreen.tsx`, `OrderDetail.tsx`, `ReturnsScreen.tsx`, `modules/sales/SalesScreen.tsx`, `modules/team/TeamScreen.tsx`, `modules/locations/LocationsScreen.tsx` y formularios necesarios.
- Crear `apps/mobile/test/commercialRegression.test.ts`, `roleModules.test.ts`, `profilePreferences.test.ts` y evidencia cruzada con admin web.

**Interfaces**

Consume rutas existentes y extensiones publicadas por A05/A14; compra APP, venta TIENDA, pedidos/devoluciones/perfil/direcciones/ubicaciones/equipo se corresponden con estado persistido. Cero operaciones comerciales offline encubiertas como intents de inventario.

**Pruebas y resultados esperados**

- `checkout_complete`: confirma compra con dirección/ubicación válidas, muestra estado/ID y bloqueo concreto si falta dato; reintento incierto consulta operación/pedido antes de crear duplicado.
- `sales_visible`: compraAPK, compraWEB y ventaTIENDA se reflejan una vez en pedidos, inventario, registros admin y reportes autorizados.
- `returns_refunds`: devolución parcial no supera cantidad elegible ni reembolso confirmado; compra/pago/cancelación offline no se presentan como completados.
- `staff_location`: crear/editar/suspender personal y ubicaciones sigue permiso/cupo/dependencias; último administrador no se quita y ubicación con existencias no se elimina.
- `preferences`: guardar gustos/tallas/categorías/dirección mejora selección de prendas descargables sin cambiar identidad ni exponer perfil a otra tienda.
- `assigned_scope`: vendedora/analista solo ve y opera ámbitos permitidos, tanto en UI como por rechazos del servidor.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Crear inventario de pantallas reales y compararlo con CU04–11/CU16–19; marcar brechas concretas, no considerar presente un caso por existir menú.
- [ ] Mantener tests de checkout y agregar flujo completo hasta confirmación/registro. Mostrar errores del servidor que antes dejaban botón sin avance.
- [ ] Implementar historial/detalle/seguimiento, cancelaciones y devoluciones/reembolsos según rol; mantener estado de pago separado de estado de pedido.
- [ ] Implementar mostrador si autorizado para el rol móvil y verificar canal TIENDA, cliente opcional según API y descuento consistente; no sustituirlo por compra de clienta.
- [ ] Completar equipo/ubicaciones/perfil/direcciones/preferencias con contratos de A14; si falta endpoint, entregar reproducción a A y continuar otra pantalla, sin editar API.
- [ ] Ejecutar con A ventas desde ambas plataformas y comprobar IDs/tablas/reportes, incluido pedido con varios pagos y devolución parcial. Mantener evidencia de saldo final y canal.
- [ ] Revisar estados vacío/carga/error, accesibilidad/tamaño de controles y navegación atrás; ningún botón queda solo decorativo.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm --prefix apps/mobile run test:unit
npm --prefix apps/mobile run typecheck
npx tsx --test apps/mobile/test/checkout.test.ts apps/mobile/test/checkoutFlow.test.ts
# Pruebas integradas de compraAPP/ventaTIENDA y verificación de registros en admin web/API.
```

**Criterio de cierre:** Módulos móviles cubren los casos comerciales y de gestión documentados; ventas y devoluciones están conciliadas con servidor/reportes, sin éxito visual ficticio.

**Commit sugerido:** `b13: completar módulos comerciales, perfil, equipo y ubicaciones`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b14"></a>
### B14. Pulir worker de avatar, regeneración y enlace con vestidor

**ICONIX:** RF17–RF24; CU12–CU15. **Depende de:** B00; contrato de jobs con A06, UI móvil B09.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Modificar `workers/avatar/process.py`, `geometry.py`, `tests/test_process.py`, `tests/test_geometry.py` y helpers estrictamente necesarios; preservar entrada CLI actual.
- Crear fixtures de medidas/regeneración y `docs/evidencia/saas/equipo-b/B14-avatar-worker.md` con protocolo compatible para A06.
- Completar en Android estados de avatar/recursos y acceso al flujo web 3D autenticado cuando corresponda; no prometer malla 3D corporal AR en el APK.

**Interfaces**

Worker mantiene --check, --demo y --job request.json, fotos FRENTE/PERFIL/ESPALDA y salida ok/avatar_file/medidas/parametros_malla/version_proceso. Agrega regeneración a partir de parámetros/medidas corregidas, sin pedir fotos ya purgadas; API A controla propiedad/cuota/versión/purga.

**Pruebas y resultados esperados**

- `backward_compatibility`: job actual y --check/--demo siguen funcionando; falta de Blender/modelos retorna error seguro, no avatar de demo como resultado de fotos reales.
- `regenerate_no_photos`: parámetros válidos generan nueva versión GLB sin archivos originales; input inválido no sobreescribe avatar aprobado ni consume cuota como éxito.
- `mesh_measures`: rango 100–230 cm, unidades y proporciones coherentes, malla legible/compatible con visor; corregir medida no produce escala arbitraria ni textura corporal identificable.
- `private_files`: paths se resuelven dentro de job privado; fallo no imprime fotos/secretos. A purga originales al completar o antes de 24 h incluso con error.
- `web_mobile_boundary`: revisión 360/zoom/aprobación corresponde al visor 3D web; Android conserva PNG+pose. El acceso web HTTPS exige su propia autenticación y no pasa JWT/DEK por URL.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Leer proceso actual y crear pruebas de compatibilidad/regeneración antes de cambiarlo. Revisar schema de request con A06 y conservar nombres de campos existentes.
- [ ] Separar fase de inferencia desde fotos y construcción desde parámetros validados; regeneración reutiliza segunda fase sin depender de fotos purgadas.
- [ ] Agregar validación de medidas, rutas y errores; guardar versión de proceso y parámetros técnicos mínimos para trazabilidad, sin retener fotos innecesarias.
- [ ] Generar GLB de prueba, comprobar dimensiones/escala y revisión en Viewer web con A. Cuota/reserva/commit/liberación se verifica por A06; B no implementa otro contador.
- [ ] En Android mostrar estado/generación disponible y explicar acceso al vestidor 3D web cuando se requiere revisión. Abrir sitio HTTPS con tienda/ruta pública permitidas y login web propio, nunca tokens en query. Al volver refrescar estado bajo mismo scope.
- [ ] Entregar handoff con requests de fotos/regeneración, outputs y fallos reales; comunicar requirements/Blender/recursos sin mezclar venv analítico y avatar.
- [ ] Ejecutar regresiones de pose/vestidorAR B09 para comprobar que el trabajo del avatar no cambia esa tecnología ni rompe prendas descargadas.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
# PYTHON_PATH es la variable actual del avatar; si no está exportada, usar el venv local existente.
$taskAvatarPython = Join-Path (Get-Location) "workers/avatar/.venv/Scripts/python.exe"
if ($env:PYTHON_PATH) { $taskAvatarPython = (Resolve-Path -LiteralPath $env:PYTHON_PATH).Path }
if (-not (Test-Path -LiteralPath $taskAvatarPython)) { throw "Preparar el venv avatar3.11 con sus requirements y Blender antes de ejecutar." }
& $taskAvatarPython -m pytest workers/avatar/tests/test_process.py workers/avatar/tests/test_geometry.py -q
& $taskAvatarPython workers/avatar/process.py --check
npm run mobile:pose-test
```

**Criterio de cierre:** Worker real compatible permite regenerar sin conservar fotos; web 3D y AndroidAR mantienen límites claros y A tiene contrato/evidencia para integrar el ciclo completo.

**Commit sugerido:** `b14: pulir worker de avatar, regeneración y enlace con vestidor`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b15"></a>
### B15. Ejecutar aceptación Android nativa y pruebas cruzadas

**ICONIX:** RF01–RF54; G2–G6. **Depende de:** B04–B14, endpoints integrados A y candidato acordado.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/mobile/e2e/offlineCatalog.yaml`, `stockConflict.yaml`, `lostResponse.yaml`, `reportsOffline.yaml`, `tenantIsolation.yaml`, `outfitsOffline.yaml` y `checkoutRecord.yaml`.
- Crear `apps/mobile/e2e/README.md` con instalación Maestro, variables de entorno públicas/locales y preparación de datos QA sin credenciales versionadas.
- Crear `docs/evidencia/saas/equipo-b/B15-aceptacion.md` con dispositivo/Android/ABI/Hermes, SHA, casos/resultado y reproducciones pendientes.

**Interfaces**

Entrega evidencia real de SQLite/ExpoCrypto/SecureStore/cámara/Metro, no solo unitarios Node. Maestro usa paqueteQA, setAirplaneMode y relanzar sin clearState cuando se mide persistencia; A compara contra estado de API/web.

**Pruebas y resultados esperados**

- `native_restart`: con cola y dashboard descargados, cerrar proceso, modo avión, relanzar sin borrar datos, editar stock/catalogo e interactuar con dashboard.
- `server_recovery`: perder respuesta tras commit y recuperar el mismo recibo; dependencia bloqueada visible; stock cumple invariantes al reconectar.
- `two_stores`: cambio de negocio/cuenta con descargas/respuestas en curso no mezcla tokens, archivos, dataset, cola ni eventos.
- `commercial_e2e`: compraAPP/WEB/TIENDA y devolución parcial visibles una vez en administrador y reporte; comparar centavos exactos y stock final.
- `real_pose`: cámara y tracking disponibles sin red con prendas descargadas; permiso negado recuperable y recursos incompatibles explicados.
- `plan_and_demo`: Esencial manualoffline, Pro demanda/reposición, Negocio anomalías; cada pantalla ML rotula fuente sintética y cobertura, sin contaminar REAL.

**Secuencia de ejecución**

- [ ] Preparar APKQA y API local/depruebas del mismo candidato con A; crear datos de dos tiendas y roles autorizados solo para aceptación.
- [ ] Agregar testID/labels accesibles a controles relevantes y escribir flows sobre acciones del usuario, sin depender de coordenadas frágiles.
- [ ] Ejecutar tests puros primero y luego flows nativos. Conservar datos al reiniciar; separar pruebas que sí necesitan instalación limpia de las de durabilidad.
- [ ] Hacer prueba manual de cámara/pose, permiso, audio, exportaciónPDF y comportamiento al volver del navegador; automatizar donde el entorno lo permita sin fingir cámara física.
- [ ] Registrar IDs de operaciones/pedidos, hashes de conjuntos y resultados de golden; A verifica persistencia/reportes desde web/API. No incluir rostros/fotos/cuentas de personas en evidencia.
- [ ] Corregir fallos B en su rama y reenviar handoff. Cambios de API/shared los aplica A; repetir escenario afectado sobre candidato integrado.
- [ ] Publicar matriz de aceptación con aprobado/fallido/noejecutado y motivo. Un dispositivo no disponible impide reclamar prueba nativa realizada.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm --prefix apps/mobile run test:unit
npm run mobile:typecheck
npm run mobile:check
npm run mobile:pose-test
adb devices
maestro test apps/mobile/e2e
# Ejecutar solo flows configurados para API/paquete QA; conservar datos en las pruebas de reinicio.
```

**Criterio de cierre:** Android tiene evidencia nativa y cruzada contra web/API del candidato; no hay caso obligatorio pendiente escondido detrás de mocks o una captura de pantalla.

**Commit sugerido:** `b15: ejecutar aceptación android nativa y pruebas cruzadas`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="b16"></a>
### B16. Entregar APK candidato de QA, firma y handoff final

**ICONIX:** RF34 y requisitos no funcionales; G6/G7. **Depende de:** preparar build/variante antes de B15; cerrar artefacto después de B15 y SHA integrado A.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Modificar `apps/mobile/app.json` o introducir `app.config.ts` para variante QA; ajustar `apps/mobile/android/app/build.gradle` solo si está versionado o generar configuración reproducible desde config plugin.
- Crear `docs/evidencia/saas/equipo-b/B16-apk.md`, `apps/mobile/BUILD.md` y manifiesto público de versión/hash/certificado/endpoint.
- Entregar a A APKQA y código/configuración para build oficial; no agregar keystores, contraseñas, APKs pesados o modelos privados a Git.

**Interfaces**

QA usa applicationIdSuffix .qa y nombre Lúmina QA, para coexistir con bo.edu.grupo 18.vestidorar instalado. Release oficial conserva package y certificado original; actualmente build.gradle firma release con debug, por lo que no se declara producción lista sin corregir/verificar con A.

**Pruebas y resultados esperados**

- `build_from_clone`: instalación limpia del candidato reproduce shared+bundle+native sin rutasC:/Users/HP ni carpeta.local imprescindible.
- `api_target`: EXPO_PUBLIC_API_URL termina en /api y apunta a HTTPS correcto para candidato; ninguna URLlocalhost queda en build oficial y no hay secretos EXPO_PUBLIC.
- `qa_identity`: paqueteQA separado; certificado/fingerprint y versionCode registrados, sin sustituir silenciosamente app existente firmada por otra máquina.
- `official_update`: A compara certificado del APK anterior y versionCode observado; nuevo versionCode>maxinstalado y>3. Si falta clave original, declarar límite de actualización antes de distribuir.
- `fresh_install`: instalar APKQA y abrir login/catálogo, compra test, descarga/offline y dashboard; candidato final proviene del mismoSHA que API/web.

**Secuencia de ejecución**

- [ ] Recibir SHA integrado y crear checkout limpio de ese commit; confirmar que no quedan dependencias locales sin publicar ni código de fixture como fuente de producción.
- [ ] Preparar variante QA con identidad separada y endpoint configurable; mantener package oficial como constante de producción. Conservar permisos cámara/audio mínimos.
- [ ] Construir packages, instalar deps móviles y generar proyecto nativo reproducible según Expo; documentar prebuild si android no está versionado. No ejecutar prebuild --clean sobre cambios nativos sin revisar su impacto.
- [ ] Construir assembleRelease de QA con configuración de firma explícita para QA; no llamar oficial al APK firmado con debug. Verificar apksigner/apkanalyzer del SDK instalado.
- [ ] Instalar solamente en dispositivo/emulador QA autorizado para B15/B16. No reemplazar APK personal del usuario ni ejecutar la app en su teléfono automáticamente.
- [ ] Registrar SHA256, bytes, applicationId/versionName/versionCode/certificado y URL API pública. Entregar APK por canal de artefactos/local explícito y handoff a A.
- [ ] A firma/publica oficial en entorno con clave compatible. B entrega código y comandos, no solicita copiar claves privadas por chat y no despliega contenedores/VM.
- [ ] Cerrar matriz RF/CU móvil/ML con enlaces a código/pruebas/métricas reales y pendientes; guardar todo en equipo-b para que A17 actualice documento final.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm ci
npm run build:shared
npm --prefix apps/mobile ci
npm run mobile:typecheck
npm run mobile:check
# Definir previamente EXPO_PUBLIC_API_URL con la API de QA acordada con A.
if (-not $env:EXPO_PUBLIC_API_URL) { throw "Falta la URL API de QA; no usar el default productivo." }
Push-Location apps/mobile
$env:APP_VARIANT = "qa"
npx expo prebuild --platform android --no-install
Push-Location android
./gradlew.bat assembleRelease
Pop-Location
Pop-Location
# APP_VARIANT debe estar implementado antes; comprobar APK resultante con herramientas del Android SDK.
# A calcula/aplica versionCode y firma oficial compatible al integrar.
```

**Criterio de cierre:** APKQA verificable y reproducible entregado a A con metadatos completos; firma/publicación oficial quedan coordinadas y no hay divergencia entre APK y servidor.

**Commit sugerido:** `b16: entregar apk candidato de qa, firma y handoff final`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.


## Matriz completa de cobertura entre ambos planes

A y B son responsables de sus capas del mismo caso; una marca local no cierra el caso extremo a extremo.

| Caso ICONIX | Objetivo | Tareas A | Tareas B | RF |
|---|---|---|---|---|
| CU01 | Preparar tienda | A03 | B12 | RF01, RF02, RF06, RF34 |
| CU02 | Suscribir renovar y cambiar plan | A04 | B12 | RF02, RF03, RF20, RF27, RF34 |
| CU03 | Autenticar sesión en tienda | A03 | B04 | RF04, RF06, RF34 |
| CU04 | Gestionar equipo y permisos | A14 | B13 | RF05, RF06, RF34 |
| CU05 | Gestionar sucursales y almacenes | A14 | B13 | RF06, RF07, RF13, RF34 |
| CU06 | Gestionar prendas variantes precios y recursos | A05/A09 | B06 | RF08, RF09, RF10, RF11, RF34 |
| CU07 | Consultar colección | A05 | B09/B13 | RF09, RF10, RF11, RF13 |
| CU08 | Gestionar perfil y direcciones | A05 | B13 | RF12, RF34 |
| CU09 | Ajustar existencias | A05/A07 | B07 | RF06, RF13, RF14, RF34 |
| CU10 | Realizar conteo físico | A05/A07 | B07 | RF06, RF13, RF15, RF34 |
| CU11 | Transferir stock | A05 | B13 | RF06, RF13, RF16, RF34 |
| CU12 | Generar avatar desde fotos | A06 | B14 | RF17, RF18, RF19, RF20, RF22, RF34 |
| CU13 | Revisar aprobar y eliminar avatar | A06 | B14 | RF20, RF21, RF22, RF34 |
| CU14 | Probar prenda 3D web | A06/A09 | B14 | RF10, RF21, RF23, RF25 |
| CU15 | Probar prenda AR Android | A08 | B09/B14 | RF10, RF24, RF25 |
| CU16 | Comprar desde web o APK | A05 | B13 | RF12, RF13, RF25, RF26, RF27, RF34 |
| CU17 | Registrar venta de mostrador | A05 | B13 | RF06, RF09, RF13, RF27, RF28, RF34 |
| CU18 | Preparar entregar y consultar pedidos | A05 | B13 | RF06, RF29, RF30, RF34 |
| CU19 | Cancelar compra o gestionar devolución/reembolso | A05 | B13 | RF31, RF32, RF33, RF34 |
| CU20 | Descargar y usar paquete offline | A08/A09 | B09 | RF35, RF36, RF37, RF44 |
| CU21 | Crear editar y archivar catálogo offline | A07/A09 | B06/B08 | RF38, RF41, RF43, RF44 |
| CU22 | Ajustar y contar inventario offline | A07/A09 | B07/B08 | RF39, RF40, RF41, RF43 |
| CU23 | Sincronizar y resolver conflictos | A07/A09 | B08 | RF41, RF42, RF43, RF44 |
| CU24 | Construir y explorar reportes/dashboards | A10/A11/A12 | B10 | RF45, RF46, RF47, RF48, RF44 |
| CU25 | Solicitar reporte por texto o voz | A12 | B11 | RF45, RF46, RF48, RF49 |
| CU26 | Generar dataset y entrenar/evaluar modelos ML | A13 | B01/B02/B03 | RF50, RF51, RF52, RF53 |
| CU27 | Consultar predicción anomalías y reposición | A13 | B03/B10 | RF52, RF53, RF54, RF47, RF50 |

La matriz cubre los **54 RF** mediante los **27 CU**. A15/B15 verifican la integración de las columnas y A17 registra el resultado final.


## Catálogo de reportes copiado de la especificación

Los identificadores son literales del contrato; las etiquetas visibles se traducen a español legible. Una métrica monetaria con sufijo `_bob` se calcula en centavos y se presenta en BOB; no confundir el entero 22000 con Bs 22000.

**Métricas:** `ventas_confirmadas_bob`, `unidades_vendidas`, `pedidos_distintos`, `ticket_promedio_bob`, `unidades_devueltas`, `reembolsos_confirmados_bob`, `fisico_al_corte`, `reservado_al_corte`, `comprometido_al_corte`, `disponible_al_corte`.

**Dimensiones:** `dia`, `semana`, `mes`, `ubicacion`, `canal`, `vendedor`, `categoria`, `marca`, `producto`, `variante`, `talla`, `color`, `estado_pedido`, `estado_pago`, `metodo_pago`.

**Operadores:** `eq`, `neq`, `in`, `not_in`, `gte`, `lte`, `between`, `is_null`.

**Filtros:** `periodo`, `periodo_comparacion`, `ubicacion`, `canal`, `vendedor`, `categoria`, `marca`, `producto`, `variante`, `talla`, `color`, `estado_pedido`, `estado_pago`, `metodo_pago`, `con_devolucion`, `precio_unitario`, `disponible_al_corte`.

La UI lista solo combinaciones compatibles con el grano y columnas de su dataset. Cinco dimensiones es el máximo seleccionado, no el tamaño del catálogo. Ventas/stock no se mezclan en un agregado imposible; cada widget usa un hecho válido. El stock histórico sin movimientos/snapshot suficiente se informa no disponible.

**Ejemplo DSL del ICONIX para alinear formulario, API, IA y motor local:**

```json
{
  "schemaVersion": "1.0",
  "id": "reporte-demo-categorias-septiembre",
  "title": "Ventas femeninas por categoría y canal — DEMOSTRACIÓN",
  "source": "DEMOSTRACION_SINTETICA",
  "datasetId": "demo-femenino-seed42-v1",
  "timezone": "America/La_Paz",
  "currency": "BOB",
  "fact": "ventas_confirmadas",
  "metrics": [
    "ventas_confirmadas_bob",
    "unidades_vendidas",
    "pedidos_distintos",
    "ticket_promedio_bob"
  ],
  "dimensions": [
    "categoria",
    "canal"
  ],
  "period": {
    "from": "2026-09-01",
    "to": "2026-09-30",
    "inclusive": true
  },
  "comparison": {
    "from": "2026-08-01",
    "to": "2026-08-31",
    "mode": "previous_period",
    "requiresCoverage": true
  },
  "filters": [
    {
      "field": "ubicacion",
      "operator": "in",
      "value": [
        "demo-ubicacion-01"
      ]
    },
    {
      "field": "canal",
      "operator": "in",
      "value": [
        "WEB",
        "APP",
        "TIENDA"
      ]
    }
  ],
  "order": [
    {
      "metric": "ventas_confirmadas_bob",
      "direction": "desc"
    }
  ],
  "limit": 20,
  "chart": "bar",
  "dashboard": {
    "widgets": [
      {
        "id": "categorias",
        "chart": "bar",
        "dimension": "categoria",
        "metric": "ventas_confirmadas_bob"
      },
      {
        "id": "canales",
        "chart": "donut",
        "dimension": "canal",
        "metric": "unidades_vendidas"
      }
    ],
    "crossFilter": true,
    "detailAvailableColumns": [
      "dia",
      "producto",
      "variante",
      "talla",
      "color",
      "canal",
      "ubicacion",
      "unidades",
      "importe_bob"
    ]
  }
}
```

Este JSON es ejemplo de definición, no resultados medidos. Los IDs demo se resuelven solo en su namespace; el rowset de demanda no permite tickets/pagos sin hechos sintéticos auxiliares consistentes.


## Escenarios de aceptación y correspondencia de numeración

El Word vigente presenta 12 pruebas comunes PA01–PA12 y 22 específicas PA13–PA34. En el JSON las 22 específicas conservan IDs PA35–PA56. La siguiente equivalencia evita que ambos Codex reporten pruebas distintas con el mismo número. A17 podrá normalizar trazabilidad al cerrar, sin cambiar el contenido de aceptación. Estas son pruebas previstas, no resultados aprobados.

| Word | JSON | Caso | Escenario | Resultado exigido |
|---|---|---|---|---|
| PA01 | criterios de CU | CU01–CU03 | Dos tiendas con mismos UUID/correo | Tokens, SQL, archivos, sesión y eventos no cruzan de negocio. |
| PA02 | criterios de CU | CU02 | Webhook repetido/fuera de orden | Un solo efecto; no revive ciclo anterior. |
| PA03 | criterios de CU | CU02 | QR de demostración | Importe/tienda/plan correctos y simulación visible. |
| PA04 | criterios de CU | CU02–CU06 | Altas concurrentes cerca de límite | No supera personal, productos o ubicaciones. |
| PA05 | criterios de CU | CU09–CU11 | Inventario concurrente con reservas | Saldo válido, bloqueo y movimiento no duplicado. |
| PA06 | criterios de CU | CU12–CU15 | Fotos inválidas/recurso incompatible | Error explicable, purga y sin promesa de ajuste falso. |
| PA07 | criterios de CU | CU16–CU17 | Doble confirmación/respuesta perdida | Un pedido/pago/movimiento por intención. |
| PA08 | criterios de CU | CU18–CU19 | Devolución/cancelación repetida | Estado/reintegro/reembolso consistentes e idempotentes. |
| PA09 | criterios de CU | CU20–CU23 | Cerrar/reabrir sin red | Copia/paquetes/pendientes durables dentro de ámbito. |
| PA10 | criterios de CU | CU21–CU23 | Conteo viejo, permiso o plan vencido | Conflicto/bloqueo visible sin sobrescribir ni perder intención. |
| PA11 | criterios de CU | CU24–CU25 | Mismos filtros online y copia completa | Mismos agregados; parcialidad y cobertura declaradas. |
| PA12 | criterios de CU | CU26–CU27 | Entrenamiento/evaluación sintéticos | Semilla/hash, separación temporal y demo visible. |
| PA13 | PA35 | CU20 | Descargar diez prendas compatibles, desconectar, cerrar y reabrir web y APK. | Web carga sus GLB reales y avatar propio aprobado consentido; APK carga PNG AR compatibles. El paquete completo identifica diez prendas, plataforma, tienda y propietaria. |
| PA14 | PA36 | CU20 | Interrumpir descarga y corromper un recurso antes de abrir sin red. | Estado PARCIAL con recurso faltante o hash inválido; reintento selectivo al reconectar; no se anuncia descarga completa. |
| PA15 | PA37 | CU20 | Intentar usar el paquete o avatar desde otra cuenta o tienda y solicitar generar avatar sin red. | Acceso privado bloqueado; generación informa requisito online sin enviar ni mostrar recursos ajenos. |
| PA16 | PA38 | CU21 | Crear, editar y archivar prendas sin red en web y APK, cerrar y reabrir. | Datos y UUID permanecen como proyección pendiente durable; no se presenta publicación confirmada. |
| PA17 | PA39 | CU21 | Dos dispositivos editan una misma versión y una tienda alcanza el cupo de productos antes de sincronizar otra alta. | Edición incompatible devuelve conflicto de versión; alta fuera de capacidad queda rechazada sin publicación ni aplicación de dependencias. |
| PA18 | PA40 | CU22 | Dos dispositivos descargan físico=10 sin reservas; registran deltas +3 y -2 y sincronizan. | Físico final=11 con exactamente dos movimientos; ningún saldo local reemplaza el global. Prueba propuesta con valores de ensayo, no ejecutada. |
| PA19 | PA41 | CU22 | Descargar conteo en versión v, confirmar una venta online y enviar conteo con baseVersion v. | Conflicto con versión y saldo actuales; venta y conteo original se conservan y no hay sobrescritura automática. |
| PA20 | PA42 | CU22 | Reducir físico por debajo de reservado+comprometido o intentar transferencia mediante modo offline. | Se rechaza la disminución inválida y la transferencia exige flujo online autorizado. |
| PA21 | PA43 | CU23 | Aplicar operación, perder respuesta tras commit y reenviar el mismo UUID y contenido desde el mismo actor autorizado. | Mismo comprobante y un solo efecto; el cliente persiste recibo antes de marcar APPLIED. |
| PA22 | PA44 | CU23 | Reutilizar UUID aplicado con un payload diferente o disparar dos envíos concurrentes idénticos. | Payload distinto obtiene 409 sin cambios; envíos idénticos convergen al mismo resultado único. |
| PA23 | PA45 | CU23 | Revocar permisos, vencer suscripción o cambiar de usuario/tienda antes de sincronizar. | Escrituras bloqueadas según motivo, sin fuga de datos ni reasignación de cola; reautenticación no restaura permisos revocados. |
| PA24 | PA46 | CU23 | Crear variante y ajuste dependiente; fallar creación y cerrar durante SENDING. | La dependiente queda bloqueada; SENDING sin recibo vuelve a PENDING al reabrir y el reintento no duplica efectos. |
| PA25 | PA47 | CU24 | Ejecutar una DSL con mismo rowset/corte online y offline; variar filtros y cruce de gráficos en web y APK. | Conteos e importes en centavos coinciden; ticket se redondea igual; filtros y detalle respetan la misma cobertura. |
| PA26 | PA48 | CU24 | Descargar un conjunto limitado a una ubicación y período y pedir otra ubicación o comparación fuera de período. | La interfaz informa cobertura insuficiente y no presenta agregados como globales; solicita restringir o descargar. |
| PA27 | PA49 | CU24 | Inyectar SQL en DSL, combinar hechos incompatibles y exportar un reporte sintético. | Consulta inválida rechazada; no hay multiplicación de pagos por detalle; exportación y widgets muestran DEMOSTRACIÓN, origen y corte. |
| PA28 | PA50 | CU25 | Pedir el mismo reporte por texto y voz, revisar interpretación y contrastar contra su definición manual. | DSL admitida y cifras idénticas al motor manual; reintento del mismo identificador no duplica cuota. |
| PA29 | PA51 | CU25 | Usar texto/voz offline, con Esencial o con cuota IA agotada, o solicitar datos ajenos. | Se informa limitación y quedan filtros manuales disponibles; ninguna solicitud revela otra tienda ni ejecuta SQL. |
| PA30 | PA52 | CU26 | Generar dos veces el dataset con semilla, versión y dependencias fijadas y revisar integración de fuentes. | Mismo contenido/hash reproducible y panel previsto de 197100 filas; cero filas sintéticas en pedido y analítica REAL; toda pantalla/exportación demo marcada. |
| PA31 | PA53 | CU26 | Auditar features y orígenes de horizontes 7/30; ejecutar evaluación congelada y baseline. | Sin acceso a unidades posteriores al origen; métricas reales por horizonte y baseline, con WAPE=N/A si suma real=0. Hasta ejecutar, métricas PENDIENTES. |
| PA32 | PA54 | CU26 | Evaluar anomalías inyectadas y comprobar que labels y magnitud no son features. | Umbral fijado antes de prueba, matriz TP/FP/TN/FN y precisión/recall/F1 calculados con política de denominador cero; sin afirmar exactitud real. |
| PA33 | PA55 | CU27 | Consultar resultados con cada plan y con una fuente sin historial suficiente. | Esencial sin ML; Profesional demanda/reposición; Negocio añade anomalías/multiubicación. Historial insuficiente muestra limitación y reglas separadas. |
| PA34 | PA56 | CU27 | Revisar sugerencia demo, descargarla y explorar offline con inventario de corte anterior. | No se crea transferencia ni movimiento REAL; cobertura, fuente, modelo y antigüedad permanecen visibles en web, APK y exportación. |

A15 y B15 ejecutan estos escenarios junto con las pruebas de cada bloque; cada evidencia indica ambos IDs cuando corresponde.


## Qué entregar al coordinador al terminar

1. Rama `desarrollo/android-ml` publicada y SHA de cada bloque; A integra a `desarrollo/saas-offline`.
2. Handoffs B00–B16 con RF/CU, comandos y resultados, estado fixtures/integrado y defectos reproducibles.
3. CLI/requirements/requests/responses analíticos, hash de dataset/modelos, métricas reales y limitaciones. No mandar corpus como ventas reales.
4. Evidencia Android de cierre forzado, offline real, conflictos, reportes interactivos, AR y compras visibles en admin.
5. APKQA del candidato integrado con hash/tamaño/package/versionCode/certificado/URL y pasos de build; A firma/publica oficial.

Un bloque que solo pasó unitarios no se marca publicado. Una dependencia externa ausente se registra con su nombre y pasos de reproducción, mientras continúan tareas independientes del equipo B.


## Referencias técnicas verificadas para ejecutar el plan

La versión instalada manda sobre páginas `latest`. Usar documentación SDK57 y resolver dependencias con `expo install`; no copiar versiones SDK58.

- [Expo SQLite SDK57](https://docs.expo.dev/versions/v57.0.0/sdk/sqlite/): persistencia y transacciones; preferir transacción exclusiva para los grupos de escrituras que deban permanecer juntos.
- [Expo Crypto SDK57](https://docs.expo.dev/versions/v57.0.0/sdk/crypto/): SHA256, AES y claves importables; validar el formato real del sobre con la fixture de A01.
- [Expo Audio](https://docs.expo.dev/versions/latest/sdk/audio/): grabación y permiso de micrófono; comprobar la API de la versión resuelta para SDK57.
- [Expo monorepos](https://docs.expo.dev/guides/monorepos/): resolución de paquetes locales y módulos nativos sin duplicar React/RN.
- [Vite y dependencias enlazadas](https://vite.dev/guide/dep-pre-bundling.html): un paquete enlazado CommonJS necesita configuración explícita de prebundling; comprobar también producción.
- [scikit-learn y persistencia](https://scikit-learn.org/stable/model_persistence.html): joblib exige artefactos de confianza y entorno de dependencias compatible.
- [Maestro Android offline](https://docs.maestro.dev/reference/commands-available/setairplanemode.md) y [reinicio de aplicación](https://docs.maestro.dev/reference/commands-available/launchapp.md): pruebas reales, conservando datos al comprobar persistencia.

Las reglas numéricas, casos y alcance provienen de `especificacion.json`; las fuentes externas confirman herramientas, no resultados del proyecto.
