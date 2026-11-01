# Lúmina SaaS: servidor, web e integración — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Ejecución nativa por el Codex coordinador; no crear agentes adicionales ni iniciar despliegue por el mero hecho de leer este archivo.

**Goal:** Implementar la capa servidor/web del ICONIX de Lúmina y coordinar Android/ML hasta una entrega única, probada y documentada.

**Architecture:** A mantiene API/Prisma/control SaaS, protocolo offline, paquetes compartidos, motor de reportes, web e infraestructura. B implementa Android y workers Python sobre contratos publicados por A; cada uno edita archivos asignados en su clon y se integra por puertas verificables.

**Tech Stack:** Node 22.12+, TypeScript, NestJS11, Prisma 6/PostgreSQL, React 19/Vite/Three.js, IndexedDB/WebCrypto/ServiceWorker, paquetes CommonJS locales; integración con Expo 57/ReactNative 0.86.3 y Python 3.11/scikit-learn/Blender.

**Spec:** `docs/saas/iconix/especificacion.json` v 2.0 y `docs/Lumina_SaaS_ICONIX_Grupo18.docx`. Léanse junto a este plan.

**Responsable:** Codex coordinador (A). **Plan complementario:** `2026-10-31-plan-b-android-machine-learning.md`, en esta misma carpeta.

**Estado de este archivo:** planificación de desarrollo; ninguna casilla marcada ni comando descrito significa que el sistema objetivo ya esté implementado. Este encargo crea planes, no ejecuta los bloques de desarrollo.

## Cómo usar este plan

Leer primero los contratos y restricciones comunes; ejecutar cada bloque con pruebas y commit propio. El orden numérico identifica entregables, no obliga a esperar A13 para hacer A14: equipo/ubicaciones se cierra temprano. Mantener `docs/evidencia/saas/equipo-a/` como registro y el SHA publicado en integración como única referencia compartida.


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


## 6. Orden de trabajo específico de A

| Bloque de jornada | Secuencia y entregable | Dependencia que desbloquea |
|---|---|---|
| Día 1, apertura | A00 baseline y A01 G0a; publicar esquemas/fixtures y primer SHA | B04/B05 y CLI B03 |
| Día 1, continuación | A02 migraciones en local; iniciar A10 interfaz/golden | Provisión/cuotas y consumidor de reportes |
| Día 2 | A03/A04 planes TEST; A05 reglas comerciales; A14 equipo/ubicaciones temprano | B12/B13 y handlers offline |
| Día 3 | A07 bootstrap/sync, A08 snapshot/staging/manifiestos; prueba G0b con B | B05/B08/B09 y web offline |
| Día 4 | A09 offlineweb; cerrar A10 y A11 datasets privados/reportes | B10 y paridad G4 |
| Día 5 | A12 dashboard/IA; A13 workerML; cerrar A06 regeneración con B14 | B11 y resultadosML descargables |
| Día 6 | A15 candidato preliminar -> pruebas junto a B15; A16 contenedor/restore/firma en ensayo | G6 y candidato listo para publicación |
| Día 7 | A16 publicación verificada y A17 evidencia/documento | G7 y entrega coherente |

Publicar entregables parciales completos por contrato, no acumular todos los commits hasta el día 6. Hacer el build de contenedor en ensayo antes del último día para detectar dependencias Python/paquetes compartidos. Si un requisito obligatorio no supera aceptación, informarlo con reproducción y priorizar su cierre; no retirarlo del documento ni declararlo listo para cumplir una fecha.

### Índice ejecutable de A


- [ ] [A00. Preparar baseline, entorno aislado y registro de trabajo](#a00)
- [ ] [A01. Publicar contratos ejecutables, fixtures y paquetes compartidos](#a01)
- [ ] [A02. Migrar datos de negocio y control sin romper tiendas existentes](#a02)
- [ ] [A03. Cerrar planes, provisión, permisos y cuotas mensuales](#a03)
- [ ] [A04. Integrar Stripe TEST y QR simulado con ciclo idempotente](#a04)
- [ ] [A05. Pulir catálogo y cerrar ventas, pedidos e inventario transaccionales](#a05)
- [ ] [A06. Completar avatar y vestidor web con cuotas y regeneración](#a06)
- [ ] [A07. Implementar servidor de sincronización y bootstrap privado](#a07)
- [ ] [A08. Entregar snapshots estables y manifiestos de prendas compatibles](#a08)
- [ ] [A09. Construir offline web durable y módulo de sincronización](#a09)
- [ ] [A10. Implementar motor compartido de reportes y semántica exacta](#a10)
- [ ] [A11. Implementar datasets privados y API de reportes guardados](#a11)
- [ ] [A12. Pulir dashboards web y asistencia online de texto y voz](#a12)
- [ ] [A13. Integrar jobs ML, almacenamiento y paneles web](#a13)
- [ ] [A14. Completar administración modular, equipo y ubicaciones](#a14)
- [ ] [A15. Integrar ramas y probar escenarios entre web y APK](#a15)
- [ ] [A16. Preparar despliegue, firma oficial y recuperación](#a16)
- [ ] [A17. Cerrar trazabilidad y documento con resultados reales](#a17)

<a id="a00"></a>
### A00. Preparar baseline, entorno aislado y registro de trabajo

**ICONIX:** RF01–RF54; todas las puertas. **Depende de:** ninguna.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Leer `package.json`, `jest.config.cjs`, `scripts/test-env.cjs`, `.env.example` y `docs/saas/ESTADO.md`.
- Crear `docs/evidencia/saas/equipo-a/A00-baseline.md`; no editar `apps/mobile` ni workers.
- Rama propia `desarrollo/servidor-web` desde la integración que contiene estos planes.

**Interfaces**

Produce SHA de base, comandos disponibles, incidencias reproducibles y URL local de integración. B recibe el SHA, nunca una copia de la base productiva.

**Pruebas y resultados esperados**

- `baseline_tenant_isolation`: dos negocios con UUID/correo iguales no comparten catálogo, cookie, sesión, archivo ni evento.
- Registrar resultados actuales de tests/build. Un fallo previo no se oculta ni se atribuye automáticamente al trabajo nuevo.

**Secuencia de ejecución**

- [ ] Crear o seleccionar la rama propia con checkout limpio; registrar el SHA del plan y de la especificación.
- [ ] Instalar desde lock con `npm ci`; configurar PostgreSQL exclusivamente local. El setup de tests redirige a vestidor 18_test, pero comprobar también el host antes de ejecutarlo.
- [ ] Ejecutar `npm run db:generate` y `npm run db:prepare-test`; comprobar que no apuntan a la VM.
- [ ] Ejecutar baseline y capturar salida, duración y fallos en A00-baseline.md.
- [ ] Anunciar a B la base elegida y la hora objetivo de G0 mediante el handoff del repo; no activar cobros ni migrar producción.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm run db:generate
npm run db:prepare-test
npm test
npm run build
npm run test:admin-ui
```

**Criterio de cierre:** Entorno de pruebas reproducible y diferencia conocida respecto al baseline; ninguna escritura productiva.

**Commit sugerido:** `a00: preparar baseline, entorno aislado y registro de trabajo`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a01"></a>
### A01. Publicar contratos ejecutables, fixtures y paquetes compartidos

**ICONIX:** RF02, RF34, RF35–RF54; CU20–CU27. **Depende de:** A00.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `packages/contracts/package.json`, `tsconfig.json`, `src/index.ts`, `src/offline.ts`, `src/reports.ts`, `src/billing.ts`, `src/analytics.ts`, `src/problems.ts`, `src/canonical.ts`.
- Crear `packages/contracts/fixtures/offline-intent-v1.json`, `report-golden-v1.json`, `analytics-job-v1.json` y `packages/contracts/test/contracts.test.ts`.
- Crear `packages/reporting/package.json`, `tsconfig.json`, `src/index.ts`, `src/types.ts`; publicar interfaces sin fingir un motor ya terminado.
- Modificar `package.json`, `package-lock.json`, `apps/web/vite.config.ts` y crear `scripts/test-shared.cjs` para `build:shared` y `test:shared`.
- Crear `docs/evidencia/saas/equipo-a/A01-contratos.md` con ejemplos completos de request/respuesta y errores.

**Interfaces**

Produce las exportaciones de §3, paquetes CommonJS con tipos y fixtures sin secretos. `test:shared` compila y ejecuta `node --test` sobre los tests compilados de ambos paquetes; B consume solo la API pública y el fixture commit, no copia el motor.

**Pruebas y resultados esperados**

- `intent_rejects_unknown_kind`: SALE_OFFLINE y TRANSFER producen error de esquema.
- `canonical_hash_cross_platform`: mismo fixture tiene bytes/hash iguales con claves reordenadas; cambiar delta cambia el hash; rechazar NaN y campo extra.
- `money_exact`: moneyToMinor("149.00")=14900, "0.10"=10, minorToDecimal(29900)="299.00"; rechazar tres decimales y enteros fuera de rango seguro.
- `contract_package_build`: API no emite código fuera de dist/api ni importa fuente ajena a rootDir; web dev y build consumen paquetes enlazados.

**Prueba ancla** — integrar en el archivo de test del bloque; no sustituye las demás assertions:

```typescript
import assert from 'node:assert/strict';
import { moneyToMinor, minorToDecimal } from '@lumina/contracts';
assert.equal(moneyToMinor('149.00'), 14900);
assert.equal(moneyToMinor('0.10'), 10);
assert.equal(minorToDecimal(29900), '299.00');
assert.throws(() => moneyToMinor('149.001'));
```

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Escribir primero fixtures con UUID reales constantes y esquemas/pruebas que fallen por módulos/exportaciones ausentes.
- [ ] Definir tipos discriminados, payloads estrictos, problemas de API y versiones de contrato. Identificar concretamente todas las propiedades del manifiesto y los hechos de reporte.
- [ ] Implementar canonicalIntentJson y conversiones monetarias; limitar listas/tamaños y decidir las normalizaciones antes de calcular hash.
- [ ] Crear build de paquetes y consumo local sin cambiar el SDK móvil ni el rootDir de la API. Documentar el orden de instalación de los paquetes.
- [ ] Ejecutar tests de contrato y bundles API/web. Enviar a B JSON completo de fixtures, tipos, semántica y SHA; B confirma importación en Android.
- [ ] Integrar este bloque a desarrollo/saas-offline como **G0** antes de que ambos dependan de campos distintos.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm run build:shared
npm run test:shared
npm run build
```

**Criterio de cierre:** Esquemas, errores, nombres y golden versionados; B puede iniciar adaptadores sin inventar API. Interfaces pendientes del motor tienen estado explícito, nunca resultados falsos.

**Commit sugerido:** `a01: publicar contratos ejecutables, fixtures y paquetes compartidos`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a02"></a>
### A02. Migrar datos de negocio y control sin romper tiendas existentes

**ICONIX:** RF01–RF03, RF08, RF20, RF34, RF41–RF54. **Depende de:** A01.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Modificar `prisma/schema.prisma`; crear `prisma/migrations/202611010001_saas_offline_analytics/migration.sql`.
- Crear `prisma/platform/migrations/202611010001_billing.sql` y adaptar `prisma/platform/schema.sql` y `scripts/migrate-tenants.ts` para migraciones de control versionadas.
- Crear `apps/api/test/saas-schema.test.ts`; ampliar `tenant-database.test.ts` y `tenant-provision.test.ts`.

**Interfaces**

Produce seis tablas y columnas de `data.new_tables`/`data.changes` del JSON rector, clientes Prisma regenerados y un migrador repetible por base. No añadir tenant_id a las 49 tablas de cada base ni inventar FK interbase.

**Pruebas y resultados esperados**

- `migration_populated_tenants`: aplicar sobre dos bases pobladas conserva pedidos, stock, avatares, roles y claves existentes; repetir no recrea filas.
- `quota_exact_period`: consumo_cuota usa timestamptz(6), desde<hasta, idempotencia única y referencia de trabajo/consulta coherente.
- `metric_not_applicable`: NO_APLICA admite valor NULL con motivo; EVALUABLE exige valor; denominador cero no se persiste como WAPE0.
- `receipt_constraints`: id único, actor FK real y entidad polimórfica sin FK inventada; índices para recuperación/fecha y filas de versiones iniciales 1.
- `legacy_analytics`: columnas nuevas nullable/default permiten reglas anteriores sin presentarlas como modelo entrenado.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Contrastar campo por campo las seis tablas: operacion_sincronizacion, definicion_reporte, conjunto_reporte, conjunto_entrenamiento, metrica_modelo y consumo_cuota.
- [ ] Escribir tests de constraints y migración con datos anteriores; ejecutar y conservar el fallo esperado antes de crear SQL.
- [ ] Crear migración aditiva, backfill de versiones y timestamps, índices/unique/CHECK. Mantener todas las restricciones de stock existentes.
- [ ] Versionar cambios de platform.billing_event y subscription; planificar orden control→negocios y no mezclar sus conexiones en una supuesta transacción distribuida.
- [ ] Aplicar a base local de pruebas y dos tiendas, incluidas suspendidas; verificar rollback de ensayo restaurando un respaldo local, no borrando bases reales.
- [ ] Regenerar Prisma, ejecutar tests afectados y entregar a B el diccionario y cambios de DTO; B no necesita ni edita migraciones.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm run db:generate
npm run db:prepare-test
npm test -- --runTestsByPath apps/api/test/saas-schema.test.ts apps/api/test/tenant-database.test.ts apps/api/test/tenant-provision.test.ts
```

**Criterio de cierre:** Esquema objetivo completo, upgrade repetible y comprobación con datos anteriores; script falla de forma visible si una tienda no migra.

**Commit sugerido:** `a02: migrar datos de negocio y control sin romper tiendas existentes`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a03"></a>
### A03. Cerrar planes, provisión, permisos y cuotas mensuales

**ICONIX:** RF01–RF07, RF20, RF34; CU01–CU05. **Depende de:** A02.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/api/src/billing/entitlements.service.ts`, `quota.service.ts`, `periods.ts` y `apps/api/src/tenancy/operator.ts`.
- Modificar `tenancy/platform.ts`, `capacity.ts`, `defaults.ts`, `provision.ts`, `scripts/create-tenant.ts` y `apps/api/src/app.ts`.
- Crear `apps/api/test/entitlements.test.ts`, `quota.test.ts`, `operator.test.ts` y `apps/web/src/admin/PlatformProvision.tsx`.

**Interfaces**

Exportar `EntitlementsService.forTenant(tenantId): Promise<Entitlements>` y `QuotaService.reserve/commit/release(tx, resource, referenceId, period)`. Entitlements incluye planCode, período, capacidades y consumo. Operadora global usa autenticación de control separada y sin privilegios comerciales implícitos.

**Pruebas y resultados esperados**

- `plan_values`: cantidades/precios exactamente como §Global Constraints; piloto solo compatibilidad interna.
- `capacity_race`: dos altas cuando queda un cupo permiten una sola; archivar producto no libera registro; Cliente no consume personal.
- `period_anniversary`: 31/01→último día de febrero y siguiente aniversario conservado; guardar ancla en contexto de facturación, no sumar 30 d; límites [desde, hasta) precisos.
- `avatar_quota_once`: 29 exitosos+una reserva en Esencial impiden otra; fallo libera; mismo UUID no vuelve a consumir.
- `operator_separation`: admin de tienda no crea bases ni consulta control; alta fallida queda FAILED, sin eliminar bases automáticamente.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Crear fixtures de los tres planes y tests de concurrencia, períodos y reserva/liberación antes de implementar.
- [ ] Publicar precios y capacidades mediante seed idempotente del control; no cambiar precios de intentos ya confirmados retroactivamente.
- [ ] Implementar validación central de capacidades y servicios de cuotas; tomar bloqueo por tienda y referencia en el mismo orden que los cambios de suscripción.
- [ ] Serializar decisión de vigencia entre control y negocio mediante protocolo común y snapshot/versionado; documentar sin prometer atomicidad entre bases.
- [ ] Completar alta autorizada de operadora y panel web de provisión, conservando el CLI como herramienta de operación.
- [ ] Exponer lecturas de plan/suscripción para B. Ampliar los permisos necesarios de analítica/suscripción sin conceder provisión global a roles comerciales.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test -- --runTestsByPath apps/api/test/entitlements.test.ts apps/api/test/quota.test.ts apps/api/test/operator.test.ts apps/api/test/tenancy.test.ts
npm run build
```

**Criterio de cierre:** Dos tiendas con capacidades independientes; cuotas comprobadas en servidor y API de lectura estable para Android.

**Commit sugerido:** `a03: cerrar planes, provisión, permisos y cuotas mensuales`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a04"></a>
### A04. Integrar Stripe TEST y QR simulado con ciclo idempotente

**ICONIX:** RF02, RF03, RF27, RF34; CU02. **Depende de:** A03.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/api/src/billing/subscription.controller.ts`, `subscription.service.ts`, `stripe.adapter.ts`, `qr-simulation.ts`, `webhook.controller.ts`.
- Modificar `apps/api/src/app.ts`, `tenancy/platform.ts`, `.env.example` y dependencias/lock raíz para SDK Stripe compatible verificado.
- Crear `apps/web/src/admin/Subscription.tsx`, `apps/api/test/subscriptions.test.ts` y `billing-webhook.test.ts`.

**Interfaces**

Produce las rutas de suscripción de §3.2. `createCheckout(user, {planCode,provider,operationId})` fija importe. `applyBillingEvent(event)` deduplica y guarda evento+efecto en una transacción del control; devuelve comprobante y período exactos.

**Pruebas y resultados esperados**

- `raw_signature`: firma válida sobre bytes originales aceptada; payload reserializado, firma inválida, modo LIVE o moneda/importe distintos rechazados.
- `webhook_without_tenant_header`: identifica tienda por relación confiable de suscripción/evento, no por slug del cliente. Un evento viejo no reactiva vigencia antigua.
- `renewal_replay`: mismo evento dos veces extiende una vez; dos eventos concurrentes del mismo intento no abren ciclos duplicados.
- `plan_change`: cobrar 299.00 TEST y reiniciar ciclo/100 IA tras aceptar condiciones; bajar a pro con 6 ubicaciones falla sin borrar ninguna.
- `cancel_at_end`: acceso hasta fin; después lectura/renovación; QR muestra simulación y requiere decisión autorizada.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Escribir tests de webhook y reglas de plan usando firma/SDK de pruebas y reloj controlado.
- [ ] Habilitar conservación de raw body en Nest y excepción **exacta** de ruta de proveedor en el middleware; no eximir prefijos enteros de autorización de negocio.
- [ ] Implementar intenciones, Checkout TEST, eventos firmados y deduplicación; comparar plan/BOB/importe/entorno/tienda/versión antes del efecto.
- [ ] Implementar QR_SIMULATED con identificador e importe visibles y confirmación autorizada; no simular respuesta bancaria.
- [ ] Crear pantalla web completa de plan/consumo/resumen, error y estado; return URL no confirma el pago y B usa consulta de estado al volver.
- [ ] Probar expiración, reintentos, renovación anticipada y plan insuficiente. Entregar a B URLs/DTO/errores; registrar credenciales como requisito de entorno, nunca en Git.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test -- --runTestsByPath apps/api/test/subscriptions.test.ts apps/api/test/billing-webhook.test.ts
npm run build
npm run test:admin-ui
```

**Criterio de cierre:** Suscripción académica funcional en entorno TEST, con evidencia de evento válido e idempotencia; falta de proveedor configurado se informa, no se anuncia cobro exitoso.

**Commit sugerido:** `a04: integrar stripe test y qr simulado con ciclo idempotente`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a05"></a>
### A05. Pulir catálogo y cerrar ventas, pedidos e inventario transaccionales

**ICONIX:** RF08–RF16, RF25–RF34; CU06–CU11, CU16–CU19. **Depende de:** A02/A03; no esperar a la UI móvil.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/api/src/inventory/inventory.service.ts`, `catalog/catalog.service.ts`, `commerce/idempotency.ts` para reglas reutilizables.
- Modificar `catalog.ts`, `locations.ts`, `commerce.ts`, `sales.ts`, `orders.ts`, `profile.ts` y sus consumidores web `Admin.tsx`, `Commerce.tsx`, `Sales.tsx`, `OrdersAdmin.tsx`.
- Crear `apps/api/test/commerce-idempotency.test.ts`, `returns-concurrency.test.ts`; ampliar tests existentes de catálogo, locations, sales y orders.

**Interfaces**

Producir servicios de dominio que A07 reutiliza con la transacción existente: `applyStockDelta(tx, context, input)`, `applyStockCount(tx, context, input)`, `transferStock(tx, context, input)` y `mutateCatalog(tx, context, input)`. Publicar DTO concretos en contracts antes de que B13 los consuma.

**Pruebas y resultados esperados**

- `web_app_pos_sales_registered`: una compra por cada canal genera pedido/pago/detalle/movimiento y aparece una vez en los agregados admin.
- `last_unit_race`: dos compradoras no reservan ambas la última unidad; uuid repetido mantiene un pedido y reserva.
- `transfer_atomic`: origen 10/destino 2/cantidad 3 ->7/5; fallo en destino revierte ambos; reenvío no crea otro par.
- `return_eligibility`: compra 3, devolución aceptada 2 y cerrada ->solo 1 elegible; reservas activas de otras solicitudes también descuentan.
- `dispatch_once`: pagar/preparar/despachar no descuenta físico dos veces; pago 150/reembolso previo 50 nunca devuelve más de 100 adicionales.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Reproducir cada caso con tests de concurrencia y eventos perdidos; conservar rutas actuales de checkout web/APK.
- [ ] Extraer reglas comerciales de controladores sin reescribir toda la aplicación ni romper permisos actuales.
- [ ] Completar edición/archivo/versiones de productos y variantes, precios por canal, recursos y direcciones históricas según CU06–CU08.
- [ ] Implementar idempotencia de transferencias ONLINE_TRANSFER en comprobantes, accesible solo desde su ruta online; no incorporarla a los cinco tipos de cola offline.
- [ ] Cerrar estados de pedidos, reservas vencidas, cancelación/devolución e importes elegibles con bloqueo por línea y revisión concurrente.
- [ ] Actualizar web y publicar a B la tabla de rutas/inputs exactos con fixtures de venta y error. Verificar registro comercial y reporte, no solo notificación visual.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test -- --runTestsByPath apps/api/test/commerce.test.ts apps/api/test/sales-report.test.ts apps/api/test/commerce-idempotency.test.ts apps/api/test/returns-concurrency.test.ts apps/api/test/orders.test.ts apps/api/test/locations.test.ts
npm run test:admin-ui
```

**Criterio de cierre:** Catálogo e inventario reutilizables por offline; ventas web/APK/POS conciliables con admin; reintentos y devoluciones no duplican stock/dinero.

**Commit sugerido:** `a05: pulir catálogo y cerrar ventas, pedidos e inventario transaccionales`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a06"></a>
### A06. Completar avatar y vestidor web con cuotas y regeneración

**ICONIX:** RF17–RF24, RF34; CU12–CU15. **Depende de:** A03; contrato del worker con B14.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Modificar `apps/api/src/avatars.ts`, `avatar-jobs.ts`, `fitting.ts`, `storage.ts` y `apps/web/src/Viewer.tsx`, `App.tsx`.
- Crear `apps/api/src/avatars/regeneration.ts`, `apps/api/test/avatar-quota.test.ts`, `avatar-regeneration.test.ts` y `scripts/check-fitting-web.cjs`.

**Interfaces**

A conserva controller/cola/almacenamiento; B modifica Python. Publicar a B14 request de fotos/regeneración y respuesta GLB existente. Nueva versión permanece PENDIENTE_REVISION hasta aprobación propia; `privateModel` podrá resolver una referencia local verificada sin pedir API al abrir offline.

**Pruebas y resultados esperados**

- `photo_contract`: tres vistas distintas, 10MiB máximo y altura 100..230; rechazar foto incompleta o ajena sin generar un avatar genérico exitoso.
- `quota_lifecycle`: reserva antes de aceptar, commit al éxito una vez, release a fallo definitivo; reinicio de proceso no cobra otra vez.
- `regeneration_without_original_photos`: medidas corregidas autorizadas generan versión nueva tras purga; versión aprobada anterior sigue vigente hasta aprobar otra.
- `private_delete`: borrar revoca inmediatamente nuevas descargas, purga activa/capturas y permite invalidación local al reconectar incluso con plan vencido.
- `web_try_exact_variant`: GLB compatible con plantilla/avatar, zoom/rotación y M/negro terminan en ese variantId del carrito.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Escribir tests del ciclo de cuotas, propiedad, purga y regeneración; coordinar la fixture de salida con B14.
- [ ] Integrar servicios de cuota y recuperación de jobs, idempotencia y estados, sin dejar un error de worker como éxito.
- [ ] Añadir ruta de regeneración con medidas tipadas, sin recuperar fotos ya purgadas; validar rangos y versión de plantilla.
- [ ] Completar revisión/aprobación/eliminación web y compatibilidad de recursos GLB por variante.
- [ ] Separar resolución de archivos del render Three.js para que A09 pueda proporcionar blobs locales sin duplicar el visor.
- [ ] Ejecutar pruebas con worker real disponible y pruebas de fallo. Si faltan Blender/modelos, dejar el caso pendiente con causa; nunca aprobarlo solo con un mock.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test -- --runTestsByPath apps/api/test/avatar.test.ts apps/api/test/avatar-quota.test.ts apps/api/test/avatar-regeneration.test.ts
npm run build
node scripts/check-fitting-web.cjs
```

**Criterio de cierre:** Flujo de fotos→GLB→revisión→prueba trazable y cuota correcta; regeneración respeta purga y versiones. B recibe evidencia del contrato real.

**Commit sugerido:** `a06: completar avatar y vestidor web con cuotas y regeneración`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a07"></a>
### A07. Implementar servidor de sincronización y bootstrap privado

**ICONIX:** RF14, RF15, RF34, RF38–RF44; CU21–CU23. **Depende de:** A02/A03/A05 y contratos A01.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/api/src/offline/offline.controller.ts`, `sync.service.ts`, `receipts.repository.ts`, `device-keys.service.ts`, `catalog-handler.ts`, `inventory-handler.ts`.
- Modificar `apps/api/src/app.ts`, `tenancy` para rutas de recuperación/lectura y `.env.example` para clave maestra de envoltura.
- Crear `apps/api/test/offline-sync.test.ts`, `offline-isolation.test.ts`, `offline-receipts.test.ts` y `offline-keys.test.ts`.

**Interfaces**

Produce POST bootstrap/sync y GET operation de §3.2. `SyncService.applyBatch(context, operations): Promise<{results:SyncOperationResult[]}>`; una transacción por intención incluye dominio+auditoría+comprobante. Máximo 100 y dependencias topológicas verificadas.

**Pruebas y resultados esperados**

- `lost_response`: commit, perder respuesta y repetir ->un movimiento y mismo receipt; dos envíos simultáneos convergen.
- `different_hash`: mismoUUID otrodelta ->409 sin cambiar resultado original; otroactor/dispositivo no consulta ni secuestra ese UUID.
- `delta_vs_count`: físico 10, dos deltas+3/-2 ->11; conteo con versión vieja conflictúa sin anular venta concurrente.
- `auth_block`: 401/403/402 bloquean transitoriamente; reautenticar no restaura permisos revocados ni reescribe como otro usuario.
- `crypto_scope`: bootstrap recupera DEK solo para actor/dispositivo autenticados, clave servidor nunca sale; cifrado alterado/AAD ajena no descifra.
- `forbidden_kinds`: ni transferencia, venta ni pago se aceptan como tipo de cola; ciclos/dependencias de otra tienda rechazados.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Escribir tests de HTTP/DB concurrentes y fixtures de criptografía compartida antes del procesador.
- [ ] Implementar bootstrap y envoltura de DEK en el registro interno existente; rotación/versionado y recuperación requieren identidad autenticada.
- [ ] Implementar hash/identidad/idempotencia bajo bloqueo, recuperación de comprobantes, límite de lote y parsing estricto.
- [ ] Aplicar servicios A05 en la misma transacción que el recibo; rollback técnico permite reintentar sin congelar rechazo.
- [ ] Distinguir conflicto definitivo de bloqueo temporal por permiso/plan/red; devolver resultados individuales y dependencias bloqueadas.
- [ ] Verificar que el middleware permite recuperar recibos como lectura autorizada tras vencimiento y no abre escrituras arbitrarias.
- [ ] Publicar a B fixtures reales de respuesta perdida/CONFLICT/BLOCKED y cerrar G2 con dos clientes contra la misma API.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test -- --runTestsByPath apps/api/test/offline-sync.test.ts apps/api/test/offline-isolation.test.ts apps/api/test/offline-receipts.test.ts apps/api/test/offline-keys.test.ts
npm run build:api
```

**Criterio de cierre:** Protocolo durable y aislado con reintento seguro; B puede integrar sincronización real y no reconstruir reglas del servidor.

**Commit sugerido:** `a07: implementar servidor de sincronización y bootstrap privado`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a08"></a>
### A08. Entregar snapshots estables y manifiestos de prendas compatibles

**ICONIX:** RF10, RF11, RF13, RF35–RF37, RF44; CU20. **Depende de:** A07 y contrato/almacenamiento avatar existente de A06; no esperar regeneración B14.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/api/src/offline/snapshot.service.ts`, `outfits.service.ts`, `resources.controller.ts` y `resource-integrity.ts`.
- Modificar `catalog.ts`, `profile.ts`, `storage.ts`, `fitting.ts` para preferencias y recursos autorizados sin romper rutas antiguas.
- Crear `apps/api/test/offline-snapshot.test.ts`, `offline-outfits.test.ts` y `offline-resources.test.ts`.
- Revisar `scripts/seed-women.ts`, `catalog-assets/women/catalog.json` y `catalog-assets/women/ar/`; completar empaquetado/generación reproducible de recursos aprobados mediante `scripts/prepare-offline-resources.ts` si faltan archivos reales.

**Interfaces**

Produce snapshot con id/cursor/asOf/cobertura estables y manifiesto WEB_3D/ANDROID_AR. Registrar preferencias en usuario.preferencias según RF35. Archivos privados se sirven autenticados; no cambiar avatar a /assets público.

**Pruebas y resultados esperados**

- `snapshot_race`: editar stock entre páginas no mezcla dos cortes; cursor pertenece a identidad y ámbito y caduca de forma explicable.
- `ten_garments`: 12 compatibles -><=10; solo7 compatibles ->7 y razón; ninguna ->no paquete listo ficticio.
- `format`: WEB_3D exige GLB y dependencias embebidas o incluidas; ANDROID_AR exige PNG transparente con colocación; no usar imagen como GLB.
- `private_ownership`: no se obtiene avatar/rowset ajeno cambiando ID, slug, URL o cursor; consentimiento local de avatar explícito.
- `resource_upload`: comprobar hash/MIME/tamaño/licencia, referencia de propietario y staging antes de intención dependiente.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Crear fixtures de catálogos con compatibilidad parcial, preferencias vacías y hash de recurso incorrecto.
- [ ] Implementar snapshot consistente por identidad y cursor, con rango/cobertura explícitos y sin campos personales innecesarios.
- [ ] Implementar selección determinista basada en gustos/talla/interacciones existentes; si no hay historial, declararla por reglas.
- [ ] Construir manifiesto completo con sha 256/tamaño/versión/licencia; solo archivos que el usuario puede descargar y usar.
- [ ] Auditar las 12 referencias femeninas existentes y preparar al menos 10 compatibles en la tienda de aceptación para cada plataforma: GLB real aprobado por plantilla/talla en web y PNG transparente con metadata en Android. Si el storage local no contiene dress/skirt GLB usados por seed-women, crear/registrar esos recursos mediante pipeline reproducible; una semilla que omite archivos ausentes no cierra CU20.
- [ ] Implementar staging de medios y limpieza de huérfanos sin borrar archivos referenciados por historial; comprobar rutas dentro del storage de tienda.
- [ ] Entregar manifiestos y binarios de prueba legales a B09, con al menos un fallo recuperable y menos de 10 recursos. Documentar los recursos que aún necesiten modelado real.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test -- --runTestsByPath apps/api/test/offline-snapshot.test.ts apps/api/test/offline-outfits.test.ts apps/api/test/offline-resources.test.ts
```

**Criterio de cierre:** Descarga autorizada verificable por plataforma, sin diez modelos anunciados a partir de diez miniaturas.

**Commit sugerido:** `a08: entregar snapshots estables y manifiestos de prendas compatibles`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a09"></a>
### A09. Construir offline web durable y módulo de sincronización

**ICONIX:** RF35–RF44; CU20–CU23. **Depende de:** A07/A08; puede iniciar shell antes con fixtures A01.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/web/src/offline/database.ts`, `vault.ts`, `queue.ts`, `sync.ts`, `downloads.ts`, `scope.ts` y `apps/web/public/sw.js`.
- Crear `apps/web/src/admin/SyncWorkspace.tsx`, `apps/web/src/Downloads.tsx`; modificar `App.tsx`, `api.ts`, `tenant.ts`, `Admin.tsx`, `Viewer.tsx`, módulos y CSS.
- Crear `scripts/check-offline-web.cjs`; ampliar `scripts/check-admin-ui.cjs`.

**Interfaces**

Almacenes IndexedDB versionados por identidad; `enqueueIntent(scope,input): Promise<OfflineIntent>`, `syncPending(scope): Promise<SyncSummary>`, `downloadPackage(manifest): Promise<DownloadStatus>`. SW solo shell/estáticos públicos; datos/avatares privados en vault.

**Pruebas y resultados esperados**

- `reload_offline`: guardar edición/delta, desconectar y recargar/cerrar pestaña ->misma intención/proyección; SENDING sin recibo vuelve a PENDING.
- `late_response_scope`: cambiar tienda/cuenta durante fetch/sync/download no cambia el nuevo estado, ni captura el slug global tarde.
- `web_conflict`: conteo viejo conserva intención, muestra saldo/versiones y crea UUIDnuevo al conciliar.
- `logout_keep`: pendientes conservados cifrados no se abren desde siguiente cuenta; misma propietaria recupera tras autenticar.
- `private_cache`: CacheStorage no contiene avatar/rowset/respuesta autenticada; disco lleno/hash incorrecto deja PARCIAL.
- `web_3d_offline`: abrir avatar/prenda realmente descargados sin solicitudes API obligatorias; indicar variantes sin recurso.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Escribir escenarios Playwright de cierre/reapertura con contexto persistente, red offline real y dos tiendas.
- [ ] Implementar migraciones IDB, cifrado y transacción cola+proyección; no guardar tokens persistentes en localStorage.
- [ ] Añadir formularios de catálogo/stock que produzcan intenciones inmutables con dependencias, incluso online si reutilizan el procesador.
- [ ] Implementar un solo sincronizador por ámbito/pestaña, exclusión de envíos concurrentes y recuperación de recibos antes de marcar APPLIED.
- [ ] Registrar SW con actualización compatible: no activar una versión que rompa la copia local sin migración; conservar datos pendientes.
- [ ] Integrar descargas y visor Three.js con recursos locales, progreso y verificación; limpiar objectURLs al salir.
- [ ] Completar UI de pendientes/conflictos/bloqueos/reintentos y diálogo de logout; ejecutar pruebas G3, no solo navegador marcado offline sobre una página aún en memoria.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm run build
node scripts/check-offline-web.cjs
npm run test:admin-ui
```

**Criterio de cierre:** Web se reabre sin servidor accesible, conserva cola y prueba recursos completos; otra identidad no ve su copia.

**Commit sugerido:** `a09: construir offline web durable y módulo de sincronización`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a10"></a>
### A10. Implementar motor compartido de reportes y semántica exacta

**ICONIX:** RF45–RF48; CU24. **Depende de:** A01; coordinar rowsets con A11.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `packages/reporting/src/validate.ts`, `filters.ts`, `aggregate.ts`, `coverage.ts`, `money.ts`, `calendar.ts`, `csv.ts` y exportar desde `index.ts`.
- Crear `packages/reporting/test/golden.test.ts`, `coverage.test.ts`, `calendar.test.ts`, `aggregation.test.ts`; completar fixtures de A01.

**Interfaces**

Implementa `validateReport`, `executeReport`, `applyCrossFilter`, `exportReportCsv` y todos sus tipos. `ReportDataset` es entrada; no consultar API/DB. Los números exactos del golden son el contrato de B10.

**Pruebas y resultados esperados**

- `golden_exact`:22000/4/2/11000 y devoluciones separadas; múltiples pagos no multiplican líneas; KPI global no suma pedidos distintos de categorías superpuestas.
- `filter_semantics`: eq/neq/in/not_in/gte/lte/between/is_null con valores tipados, null explícito, listas vacías según esquema y filtros combinados por intersección.
- `coverage_not_zero`: fuera de período/ubicación/columna ->problema estructurado, no resultado cero.
- `iso_week_bolivia`: fechas UTC próximas a medianoche se agrupan por Bolivia y semana ISO; no depender de zona del equipo.
- `csv_export`: filtros/fuente/corte presentes; celdas de texto potencialmente interpretables como fórmula se escapan sin alterar importes.
- `limit_visibility`: topN solo limita grupos mostrados y lo declara; totales del conjunto cubierto se mantienen.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Definir fixture completa, grano y métricas permitidas para ventas y stock; escribir assertions exactas antes del algoritmo.
- [ ] Implementar validación de combinaciones y cobertura y límites 10/5/20/50000; rechazar consultas imposibles de responder localmente.
- [ ] Implementar agregación por claves compuestas/deduplicación de pedidos y aritmética exacta, con redondeo de ticket solo al presentar.
- [ ] Implementar selección cruzada inmutable, detalle paginable y CSV con metadata; no agregar SQL ni un parser de expresiones libres.
- [ ] Ejecutar mismo resultado en Node y navegador; entregar paquete/fixtures a B para Hermes y corregir cualquier dependencia de Node/DOM.
- [ ] Congelar semántica 1.0 como G4; un cambio de significado requiere versión y revalidación de ambos clientes.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm run test:shared
npm run build:shared
npm run build
```

**Criterio de cierre:** Motor único con golden estable, apto para servidor, web y Android; B no necesita portar fórmulas ni redondeos.

**Commit sugerido:** `a10: implementar motor compartido de reportes y semántica exacta`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a11"></a>
### A11. Implementar datasets privados y API de reportes guardados

**ICONIX:** RF34, RF45–RF48; CU24. **Depende de:** A02/A03/A10.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/api/src/reporting/report.controller.ts`, `dataset.service.ts`, `definitions.service.ts`, `facts.repository.ts` y `exports.ts`.
- Modificar `reports.ts` para compatibilidad; crear `apps/api/test/report-datasets.test.ts`, `report-definitions.test.ts`, `report-parity.test.ts`.

**Interfaces**

Produce las rutas de reporte de §3.2, metadata, paginación y descarga. Selección SQL parametrizada autorizada produce el rowset; motor A10 calcula el mismo resultado que offline. Cupo 3/15/50 solo al crear definición activa.

**Pruebas y resultados esperados**

- `no_join_explosion`: order con 2 pagos+2 devoluciones conserva ventas/unidades exactas; método de pago se filtra por existencia sin duplicar.
- `dataset_scope`: analista L1 no descarga L2 ni columnas personales innecesarias; UUID de otra tienda no expone metadata.
- `stable_export`:50 k límite se declara parcial si existe más cobertura; todas las páginas conservan snapshot/hash.
- `save_race`: dos definiciones cuando queda 1 cupo ->una; editar misma no consume nueva; Guardar como sí.
- `online_offline_parity`: API y motor local sobre el mismo corte producen centavos/conteos iguales.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Escribir tests con datos de detalle/pagos/devoluciones conocidos y dos tiendas.
- [ ] Crear repositorio de hechos con filtros autorizados/fechas correctas; preagregar pagos y reembolsos por clave adecuada.
- [ ] Persistir definición/diseño versionados y conjunto privado con metadata/hashes; separar REAL y demo y sus namespaces.
- [ ] Añadir ejecución/exportación reutilizando motor A10; datasets demasiado grandes conservan cobertura parcial y motivo.
- [ ] Mantener /reports/summary y rutas anteriores para clientes instalados; nuevas respuestas llevan versiones, asOf y cobertura.
- [ ] Entregar a B10 un dataset descargable real de integración y fixtures de parcialidad/errores, no solo documentación de endpoints.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test -- --runTestsByPath apps/api/test/report-datasets.test.ts apps/api/test/report-definitions.test.ts apps/api/test/report-parity.test.ts apps/api/test/sales-report.test.ts
npm run test:shared
```

**Criterio de cierre:** Reportes auditables y descargables con aislamiento; datos numéricos coinciden entre servidor y cliente.

**Commit sugerido:** `a11: implementar datasets privados y api de reportes guardados`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a12"></a>
### A12. Pulir dashboards web y asistencia online de texto y voz

**ICONIX:** RF45–RF49; CU24–CU25. **Depende de:** A10/A11/A03.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/web/src/reporting/ReportBuilder.tsx`, `Dashboard.tsx`, `Filters.tsx`, `Chart.tsx`, `ReportDetail.tsx`, `VoiceRequest.tsx`.
- Crear `apps/api/src/reporting/assistant.controller.ts`, `assistant.service.ts`, `ai-provider.ts`; modificar `Reports.tsx`, módulos, estilos y `.env.example`.
- Crear `apps/api/test/report-assistant.test.ts` y `scripts/check-reporting-web.cjs`.

**Interfaces**

Proveedor configurable `interpret(text,allowedCatalog): Promise<ReportDefinition>` y `transcribe(audio): Promise<string>`; servidor valida resultado, cuota y ámbito. UI revisa texto/DSL antes de ejecutar. La ausencia de proveedor no deshabilita filtros manuales.

**Pruebas y resultados esperados**

- `manual_full_filters`: período/comparación, lugar/canal/vendedora/categoría/marca/producto/talla/color/estados/método/devolución/precio/stock funcionan según columnas.
- `cross_filter_offline`: cambiar gráfico/filtro en dataset descargado recalcula sin red y conserva fuente/corte.
- `ai_injection`: pedir SQL u otra tienda no produce acceso ni ejecución; proveedor solo propone DSL permitida.
- `ai_quota_once`: voz→texto→interpretación de una intención cuenta una consulta exitosa, no tres; repetirUUID no cobra otra.
- `no_provider`:503 explicable, sin cifras inventadas y filtros manuales disponibles; micrófono denegado permite escribir.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Diseñar estados de carga, vacío, parcial, error, permisos y selección; usar componentes de gráficos locales, sin CDN que impida uso offline.
- [ ] Implementar constructor y gráficos de barras/serie/donut/tabla con leyendas, teclado y detalle; no convertir cada métrica en otra consulta incompatible.
- [ ] Conectar guardado de diseño, copias locales y exportación CSV/PDF con filtros y marca demo; PDF puede usar impresión local con estilos completos.
- [ ] Implementar adaptador de proveedor en servidor, límites de texto/audio y eliminación temporal; configurar solo credenciales de prueba autorizadas.
- [ ] Reservar/confirmar cuota y validar DSL estricta antes de ejecutar consultas propias; no introducir eval/SQL generado.
- [ ] Ejecutar recorridos web online/offline y entregar a B11 contrato y ejemplos reales de texto/transcripción/errores.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test -- --runTestsByPath apps/api/test/report-assistant.test.ts
npm run build
node scripts/check-reporting-web.cjs
```

**Criterio de cierre:** Dashboard web interactivo completo offline, asistencia real online cuando está configurada y degradación honesta cuando no.

**Commit sugerido:** `a12: pulir dashboards web y asistencia online de texto y voz`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a13"></a>
### A13. Integrar jobs ML, almacenamiento y paneles web

**ICONIX:** RF50–RF54; CU26–CU27. **Depende de:** A02/A03; B01–B03 producen CLI y artefactos.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `apps/api/src/analytics/jobs.controller.ts`, `jobs.service.ts`, `worker-bridge.ts`, `artifacts.ts`, `results.service.ts`.
- Crear `apps/web/src/analytics/AnalyticsLab.tsx`, `ModelResults.tsx`, `RestockReview.tsx` y `apps/api/test/analytics-worker.test.ts`, `analytics-isolation.test.ts`.

**Interfaces**

Consume AnalyticsJobV1 y stdout JSON de B03. Ejecutar Python con spawn y argumentos como lista, cwd controlado y sin shell. Persistir dataset/modelo/métricas/ejecución y JSON tipado demo, nunca IDs sintéticos en FK comerciales.

**Pruebas y resultados esperados**

- `async_work`:HTTP202 inmediato, cola durable, reinicio deja estado recuperable/fallo explicado; límite de concurrencia 1.
- `artifact_scope`: rutas relativas, hash alterado, job de otro actor/tienda o namespace incorrecto se rechazan antes de cargar artefacto.
- `plan_gates`: Esencial sin ML; Pro demanda/reposición; Negocio anomalías/multiubicación; API directa no evade.
- `insufficient_history`: REAL sin contexto suficiente muestra limitación/regla; no reutiliza demo como pronóstico propio.
- `metrics_na`:WAPE N/A, modelo peor que baseline y ausencia de positivos se muestran sin fabricar precisión.
- `suggestion_no_write`: revisar sugerencia no cambia pedido/stock; antigüedad de inventario y fuente siempre visibles.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Crear tests con CLI fixture controlada y luego con el worker real de B; separar comprobación del adaptador y del entrenamiento.
- [ ] Implementar cola/ejecución recuperable en ejecución_analitica, timeout, estado, stderr sin datos privados y recursos acotados.
- [ ] Validar contrato, hash y rutas de artefactos; almacenar en namespace privado por tienda/dataset/ejecución.
- [ ] Persistir métricas y procedencia; no considerar existentes reglas legadas como modelos entrenados.
- [ ] Crear panel web de dataset, progreso, MAE/RMSE/WAPE/baseline, curva de demanda, alertas y revisión de reposición.
- [ ] Cerrar G5 contra entrenamiento real sintético; entregar resultado descargable a B10 y registrar limitaciones y métricas observadas.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test -- --runTestsByPath apps/api/test/analytics-worker.test.ts apps/api/test/analytics-isolation.test.ts
npm run build
npm run test:shared
```

**Criterio de cierre:** Proceso ML real conectado con UI/API, aislado y trazable; no solo una ejecución Python que el sistema nunca utiliza.

**Commit sugerido:** `a13: integrar jobs ml, almacenamiento y paneles web`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a14"></a>
### A14. Completar administración modular, equipo y ubicaciones

**ICONIX:** RF01–RF16, RF34; CU01–CU11. **Depende de:** A03/A05; hacer temprano para desbloquear B13.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Modificar `apps/api/src/locations.ts`, `tenancy/defaults.ts`, `apps/web/src/admin/modules.ts`, `AdminWorkspace.tsx`, `BusinessOverview.tsx`, `workspace.css`.
- Crear `apps/web/src/admin/Team.tsx`, `Locations.tsx` y `apps/api/test/team-lifecycle.test.ts`, `location-lifecycle.test.ts`.

**Interfaces**

Publica CRUD de equipo/edición-suspensión-reactivación, roles/ubicaciones y sucursales/almacenes con DTO versionado. La lista de módulos se deriva de permisos/capacidades, y cada endpoint revalida todo.

**Pruebas y resultados esperados**

- `last_admin`:impedir suspender/quitar último acceso administrador; compradora no consume plaza.
- `deactivate_location`:ubicación con stock/reservas/dependencias no se desactiva; jerarquía circular rechazada.
- `role_modules`:vendedora ve solo inventario/ventas y ubicaciones asignadas; analista reportes, sin mutaciones comerciales no autorizadas.
- `responsive`:navegación usable en móvil/escritorio, foco/errores/estado vacío y módulo Sincronización accesible cuando está offline.

**Secuencia de ejecución**

- [ ] Preparar el test del primer comportamiento indicado, ejecutar su comando enfocado y comprobar fallo por la función/regla ausente; no por un entorno roto. Registrar el fallo esperado.
- [ ] Escribir pruebas del ciclo de integrante/ubicación y revisar rutas existentes que solo admiten alta.
- [ ] Completar PATCH/suspensión/reactivación y asignación de permisos/ubicación sin borrar historia.
- [ ] Implementar módulos web funcionales de Inicio, Catálogo/vestidor, Inventario, Ubicaciones, Ventas, Pedidos/devoluciones, Equipo, Reportes/análisis, Sincronización y Mi negocio.
- [ ] Probar capacidades de plan y permisos en API y UI; no usar ocultar menú como control de acceso.
- [ ] Publicar contrato y handoff temprano para B13; las correcciones de API permanecen del lado A para evitar conflictos.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test -- --runTestsByPath apps/api/test/team-lifecycle.test.ts apps/api/test/location-lifecycle.test.ts apps/api/test/access.test.ts
npm run test:admin-ui
```

**Criterio de cierre:** Módulos completos y roles consistentes, disponibles para equivalentes Android; ningún botón representa una función sin endpoint.

**Commit sugerido:** `a14: completar administración modular, equipo y ubicaciones`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a15"></a>
### A15. Integrar ramas y probar escenarios entre web y APK

**ICONIX:** RF01–RF54; CU01–CU27. **Depende de:** G0–G5 para iniciar; B15 corre sobre candidato preliminar de esta tarea.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Crear `scripts/check-saas-integrated.cjs`, `apps/api/test/saas-acceptance.test.ts` y `docs/evidencia/saas/equipo-a/A15-integracion.md`.
- Integrar las ramas con merge revisado; modificar solo archivos A salvo acuerdo explícito sobre un conflicto.

**Interfaces**

Produce SHA de candidato integrado, fixtures de dos tiendas y pruebas PA01–PA34 del Word. B aporta evidencia Android real; A verifica estado persistido y reportes desde API/web.

**Pruebas y resultados esperados**

- CompraWEB, compraAPP y ventaTIENDA: cada una visible una vez en admin y en dashboard descargado al actualizar corte.
- Delta móvil+3 y web-2 desde 10 ->11; conteo móvil de versión vieja contra venta web ->CONFLICT visible.
- Logout/cambio tienda con descarga o respuesta tardía: no se filtran datos; modificación por rol revocado sigue bloqueada.
- Pro/Negocio muestran ML autorizado y Esencial conserva manual/offline. Demo no cambia indicadores REAL.

**Secuencia de ejecución**

- [ ] Revisar handoffs y diffs B; ejecutar unitarios/contratos antes de integrar, sin resolver lockfiles con sobrescritura ciega.
- [ ] Integrar A y B en desarrollo/saas-offline, construir shared/API/web y APK candidato desde el mismo SHA.
- [ ] Preparar dos tiendas de QA con cuentas/roles/ubicaciones generadas para prueba y catálogo compatible; no reutilizar credenciales reales.
- [ ] Ejecutar matriz completa del documento, incluyendo cierre forzado, pérdida de respuesta, conflictos y ventas cruzadas.
- [ ] Registrar consultas de verificación y evidencia UI, fallos y correcciones. Todo fix de móvil/worker lo aplica B y se vuelve a integrar.
- [ ] Congelar candidato G6; cualquier cambio posterior relevante repite su prueba y la integración afectada.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test
npm run build
npm run test:shared
npm run test:admin-ui
node scripts/check-offline-web.cjs
node scripts/check-reporting-web.cjs
node scripts/check-saas-integrated.cjs
npm run mobile:typecheck
npm run mobile:check
npm run mobile:pose-test
```

**Criterio de cierre:** Existe una sola versión candidata con evidencia de ambas plataformas y estado comercial conciliado, no dos ramas que solo funcionan aisladas.

**Commit sugerido:** `a15: integrar ramas y probar escenarios entre web y apk`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a16"></a>
### A16. Preparar despliegue, firma oficial y recuperación

**ICONIX:** RF34 y requisitos no funcionales; G7. **Depende de:** A15 y B16.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Modificar `Dockerfile.azure`, `docker/azure-entrypoint.sh`, `infra/vm/compose.yml`, `.env.example` y documentación de despliegue.
- Crear `scripts/verify-saas-release.cjs`, `docs/evidencia/saas/equipo-a/A16-despliegue.md` y manifiesto de distribución de APK.

**Interfaces**

Consume worker/requirements de B y APK candidato. A incorpora packages compilados en imagen y destino de enlaces file, configura runtime Python, secretos TEST/IA/DEK y bases; publica solo SHA probado. Firma oficial conserva identidad/certificado compatible con instalación previa.

**Pruebas y resultados esperados**

- `container_cold_start`:imagen desde cero contiene packages y workers, migra control+todas las tiendas y respondehealth; no depende de .local del desarrollador.
- `backup_scope`:respaldo cubre control, negocios y archivos/claves de recuperación; ensayo local restaura más de la tienda inicial.
- `release_identity`:packageAndroid bo.edu.grupo 18.vestidorar, versionCode mayor a máximo observado, certificado compatible o cambio de firma expresamente gestionado; no etiquetar debug como release final.
- `production_smoke`:dos tiendas, compra test controlada, reportes, offline tras descarga y health sobre HTTPS; no insertar corpus demo como ventas.

**Secuencia de ejecución**

- [ ] Construir contenedor con paquetes compartidos y dos venvs: avatar actual y analytics con requirements.lock fijados; usar ANALYTICS_PYTHON_PATH para el segundo. Concurrencia ML1 y consumo observado en recursos de VM.
- [ ] Preparar respaldo/restauración y plan de reversión de código; una migración de esquema no se revierte fingiendo que basta bajar la imagen.
- [ ] Comprobar variables de control, proveedor, firmas y clave de cifrado; nunca imprimir ni versionar valores secretos.
- [ ] Usar el entorno de firma oficial para el APK final desde el mismo SHA y datos de build entregados por B; comparar fingerprint y versionCode con APK anterior.
- [ ] Promover el candidato a main según el flujo oficial y desplegar una sola vez; B no ejecuta despliegues en paralelo.
- [ ] Verificar endpoints/UI y actualización Android; guardar SHA, hash APK, certificado público, fecha y resultado. Si falla, recuperar y registrar el estado real.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
docker compose -f infra/vm/compose.yml config --quiet
docker build -f Dockerfile.azure -t lumina-saas:candidate .
node scripts/verify-saas-release.cjs
```

**Criterio de cierre:** Despliegue y APK verificables con ruta de recuperación; las órdenes mutantes de VM se ejecutan en la fase autorizada y sobre el candidato acordado.

**Commit sugerido:** `a16: preparar despliegue, firma oficial y recuperación`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.

<a id="a17"></a>
### A17. Cerrar trazabilidad y documento con resultados reales

**ICONIX:** RF01–RF54; documento ICONIX. **Depende de:** A15/A16 y evidencia final de B.

**Archivos a crear o modificar** — las rutas nuevas se crean durante esta tarea:

- Actualizar `docs/saas/ESTADO.md`, `docs/saas/iconix/especificacion.json` solo si cambió alcance/diseño, y `docs/saas/iconix/VERIFICACION.md`.
- Actualizar generador/documento `scripts/build_iconix_document.py`, `docs/Lumina_SaaS_ICONIX_Grupo18.docx` y sus diagramas cuando corresponda.
- Crear `docs/evidencia/saas/equipo-a/A17-cierre.md` con matriz RF/CU/código/prueba/SHA/resultado.

**Interfaces**

Produce documento coherente con el sistema final y evidencia verificable de cada caso. Se mantienen carátulas/índice/QR; no reemplazar hechos por capturas decorativas.

**Pruebas y resultados esperados**

- 54RF/27CU tienen ubicación de implementación y aceptación ejecutada o pendiente explícita; no queda requisito huérfano.
- Resultados ML provienen de ejecuciones versionadas; capturas demo rotuladas; resultados fallidos no se cambian a aprobado.
- Word renderizado y revisado, enlaces vigentes y QR al repositorio/despliegue correcto.

**Secuencia de ejecución**

- [ ] Recoger handoffs/evidencia de ambos equipos y comparar funciones reales con cada RF/CU.
- [ ] Corregir simultáneamente documento y código cuando falte correspondencia; no agregar funcionalidades silenciosas para cerrar números.
- [ ] Registrar comandos, entornos, fechas, métricas y limitaciones reales; distinguir pruebas de fixtures, dispositivo e instancia publicada.
- [ ] Guardar/cerrar Word si está abierto antes de regenerar; preservar referencia anterior y verificar visualmente el nuevo render.
- [ ] Publicar cierre y lista de pendientes reales; no afirmar que todo está terminado si queda un caso obligatorio sin aceptación.
- [ ] Ejecutar las verificaciones siguientes y revisar su salida completa; éxito requiere exit 0, assertions aprobadas y ninguna dependencia obligatoria omitida.
- [ ] Revisar diff y archivos asignados; hacer commit del bloque verificado y entregar handoff con SHA, resultados y dependencias reales.

**Verificación**

```powershell
npm test
npm run build
# Ejecutar también verificaciones documentales y móviles correspondientes al candidato final.
```

**Criterio de cierre:** Entrega técnica y documental coherente, con trazabilidad completa y sin resultados inventados.

**Commit sugerido:** `a17: cerrar trazabilidad y documento con resultados reales`. Guardar evidencia en la carpeta del equipo, con SHA y comandos reales.


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


## Handoff final de A

- [ ] B tiene contratos, endpoints y candidato integrados; los fallos de integración no quedan escondidos en ramas separadas.
- [ ] Esquema control/todas las tiendas, pruebas de ventas, cola/conflictos, dashboard y cuotas verificados.
- [ ] ML corre mediante jobs reales, con métricas/split/hash/procedencia y datos demo aislados.
- [ ] APK y servidor comparten SHA/contratos; certificado, versionCode y HTTPS comprobados.
- [ ] Restore probado antes de publicación y documento final actualizado con evidencias obtenidas.

La ejecución empieza por A00/A01 cuando se retome el desarrollo. Este plan conserva alcance y límites aprobados; no requiere volver a preguntar precios, plataformas, proveedor de suscripciones o tipo de datosML.


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
