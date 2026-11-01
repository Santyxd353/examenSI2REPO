# B00 — Entorno portátil y baseline Android/Python

Fecha: 2026-11-01 (`America/La_Paz`)

## Rama y base

- Rama de trabajo: `desarrollo/android-ml`
- Base de integración: `origin/desarrollo/saas-offline`
- SHA inicial: `14ffcc92e8a7f8da2bbcf04d3450d90152782fe2`
- Commit: `docs: planes paralelos detallados para servidor web y Android ML`
- Checkout separado: `examenSI2REPO-android-ml`
- El checkout que ejecuta `main` permanece separado y no fue modificado.

## Versiones observadas

| Componente | Versión o estado |
| --- | --- |
| Node.js | 24.21.0 |
| npm | 11.19.0 |
| Java | OpenJDK 21.0.12 LTS |
| Python analítico | 3.11.6 en `.local/analytics-venv` |
| pip analítico | 26.2.2 |
| Python de avatar previsto | entorno independiente, requisitos actuales con NumPy 1.26.4 |
| Expo | 57.0.30 instalado; el verificador espera `~57.0.31` |
| React Native | 0.86.3 |
| Android SDK/adb | no encontrado en `PATH` ni rutas habituales |
| Dispositivo/emulador QA | no comprobable hasta disponer de `adb` |

## Instalación reproducible

Se ejecutaron `npm ci` en raíz y en `apps/mobile` sin modificar los lockfiles.

- Raíz: 547 paquetes; auditoría informa 30 vulnerabilidades (4 bajas, 19
  moderadas, 6 altas y 1 crítica).
- Móvil: 505 paquetes; auditoría informa 14 vulnerabilidades (2 bajas, 9
  moderadas y 3 altas).
- No se ejecutó `npm audit fix --force`, porque B00 no autoriza una migración
  incompatible de Expo o dependencias compartidas.

## Baseline ejecutado

| Comando | Resultado |
| --- | --- |
| `npm run mobile:typecheck` | APROBADO, exit 0 |
| `npm run mobile:pose-test` | APROBADO, 7/7 pruebas |
| `npx tsx --test apps/mobile/test/checkout.test.ts apps/mobile/test/checkoutFlow.test.ts` | APROBADO, 4/4 pruebas |
| `npm run mobile:check` | FALLÓ, exit 1: parches Expo desactualizados |
| `adb devices` | NO EJECUTADO: `adb` no está instalado/disponible |

`mobile:check` solicita actualizar:

- `expo` de 57.0.30 a `~57.0.31`.
- `expo-modules-core` de 57.0.23 a `~57.0.24`.

El fallo se registra como baseline previo. No se atribuye a cambios del equipo B
ni se modifica el lock móvil sin revisar la compatibilidad y el ámbito del
cambio.

## Contratos y dependencias

En el SHA inicial todavía no existen:

- `packages/contracts`;
- `packages/reporting`;
- `workers/analytics` antes de este baseline;
- los scripts raíz `build:shared` y `test:shared`;
- la rama remota `desarrollo/android-ml`.

Esto bloquea la integración real de contratos, hash/cifrado cruzado, offline,
reportes y jobs. B01 puede avanzar independientemente con el dataset sintético;
B04 solo puede avanzar parcialmente hasta recibir G0a del equipo A.

## Handoff B00

- **Bloque:** B00.
- **Contrato consumido/producido:** todavía ninguno; se espera G0a
  `schemaVersion: "1.0"` de A.
- **Archivos modificados:** este informe y `workers/analytics/README.md`.
- **RF/CU cubiertos:** baseline transversal RF01–RF54; no acredita
  implementación funcional nueva.
- **Evidencia nativa:** pendiente por ausencia de Android SDK/adb y dispositivo
  o emulador QA.
- **Toca esquema, raíz, firma o despliegue:** no.
- **Siguiente acción B:** iniciar B01 con pruebas del esquema, manifiesto y
  generador sintético reproducible.
- **Siguiente acción A requerida:** publicar G0a (contratos, fixtures,
  `AnalyticsJobV1` y catálogo de errores) y coordinar la actualización de
  parches Expo si corresponde.
