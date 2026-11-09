# B08 — Sincronización y recuperación idempotente

Estado: `VERIFICADO_LOCAL` (09/11/2026).

## Garantías implementadas

- Cada operación conserva el mismo UUID, contenido cifrado y ámbito de tienda, usuario y
  dispositivo durante todos sus reintentos.
- Antes de enviar, la fila pasa de `PENDING` a `SENDING`. Si el proceso se cierra, el siguiente
  arranque recupera `SENDING` y reenvía el mismo UUID.
- Un fallo de red devuelve las filas a `PENDING`; autenticación, suscripción o permiso las deja
  `BLOCKED` sin borrar el trabajo.
- El botón manual libera únicamente bloqueos cuyas dependencias ya están aplicadas. Los hijos de
  un conflicto continúan bloqueados.
- El servidor guarda el recibo en la misma transacción que catálogo o inventario y permite
  consultarlo mediante `GET /api/offline/receipts/:operationId`.
- El servidor guarda SHA-256 de tipo, versión y contenido. Reusar un UUID con otro contenido o
  desde otra identidad/dispositivo responde `409` y no repite el efecto.

## Casos ejecutados

| Caso | Resultado |
| --- | --- |
| Reenvío tras respuesta incierta | Devuelve el recibo original, sin segundo movimiento |
| Consulta del recibo por UUID y dispositivo | Devuelve `APPLIED` y versión del servidor |
| Mismo UUID con contenido diferente | HTTP 409, saldo sin cambios |
| Ajuste concurrente y doble envío | Saldo final exacto, un efecto |
| Conteo obsoleto | `CONFLICT`; el trabajo local se conserva |
| Dependencia padre/hija | Hija espera `APPLIED`; conflicto la bloquea |
| Cambio de identidad | Claves de ámbito y validación del servidor impiden aplicar respuesta ajena |

## Verificación ejecutada

```text
npm run build:api                              correcto
npm --prefix apps/mobile run typecheck         correcto
npm --prefix apps/mobile run test:unit         50/50
npx jest apps/api/test/offline-catalog.test.ts --runInBand
                                                 1/1
```

La prueba de cierre forzado durante el intervalo exacto entre commit y respuesta se registra en
B15. El protocolo y la recuperación durable necesarios para repetirla ya están integrados.
