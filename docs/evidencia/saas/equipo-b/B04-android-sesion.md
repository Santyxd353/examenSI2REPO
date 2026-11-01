# B04 — Sesión, transporte y navegación Android

Fecha: 2026-11-01 (`America/La_Paz`)

## Implementado localmente

- `ScopeKey` combina tienda y `epoch`. Cada solicitud y sus efectos posteriores
  se verifican antes de actualizar tokens, UI o eventos de inventario.
- La restauración conserva una identidad offline autorizada solo para la misma
  tienda ante una falla de red; 401/credencial inválida limpia la sesión. Un
  `catch` genérico ya no vacía SecureStore.
- `ApiProblem` preserva `status`, `code`, `retryable` y `correlationId` para
  red, 401, 402, 403, 409 y 422. Un 403 no activa renovación de token.
- El transporte identifica el canal `APP` y no fuerza `Content-Type` JSON si
  el cuerpo es `FormData`, preservando el boundary de fotos/audio.
- WebSocket captura el ámbito al conectarse e ignora eventos de una tienda o
  época anterior.
- El registro de módulos administrativos filtra Inicio, Catálogo, Inventario,
  Ventas/Pedidos, Equipo, Ubicaciones, Reportes/Análisis, Sincronización y Mi
  negocio por permiso. Los flujos comerciales restantes se desarrollan en B05+
  y B13; no se declaran implementados por existir la navegación.

## Verificación ejecutada

```powershell
npm --prefix apps/mobile run check
npm --prefix apps/mobile run typecheck
npm --prefix apps/mobile run test:unit
```

Resultados: dependencias Expo compatibles; TypeScript aprobado; 19 pruebas
unitarias aprobadas. Las pruebas incluyen cambio de tienda/época, identidad
offline, mapeo de problemas HTTP/red, FormData y permisos, además de pose y
checkout existentes.

## Dependencia abierta

No existe aún `packages/contracts` ni `packages/reporting` en esta rama. Por
eso no se añade una implementación privada de hash/intenciones que pueda
divergir: falta G0a/A01 para importar los paquetes reales desde Metro/Hermes y
ejecutar `canonicalIntent.test`. El estado del bloque es
`VERIFICADO_LOCAL_PARCIAL`; no se declara la paridad de runtime compartido ni
un APK nativo como completados.
