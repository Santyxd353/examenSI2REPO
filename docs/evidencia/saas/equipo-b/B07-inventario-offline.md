# B07 — Ajustes y conteos de inventario offline

Estado: `VERIFICADO_LOCAL` (09/11/2026).

## Alcance integrado

- Inventario por ubicación con físico, reservado, comprometido, disponible y versión visibles.
- Copia local cifrada para consultar existencias cuando no hay conexión.
- Ajustes offline expresados como delta entero, nunca como reemplazo del saldo absoluto.
- Conteo físico con la versión confirmada al momento de iniciar la operación.
- Validación local y de servidor para impedir disponible negativo.
- Cola SQLite durable, UUID por operación y recibos idempotentes.
- Los conteos obsoletos quedan en conflicto para revisión; no se cambia su versión en silencio.
- Las transferencias se presentan como una operación exclusivamente online y atómica; la app
  no genera dos ajustes independientes para simularlas.

## Casos verificados

| Caso | Resultado |
| --- | --- |
| Stock 10, venta web −2 y ajuste móvil +3 | Servidor termina en 11 |
| Reenvío del mismo ajuste móvil | Conserva 11 y un único recibo |
| Conteo basado en versión anterior tras otra venta | Recibo `CONFLICT`, conserva observación local |
| Delta inferior a reservado + comprometido | Rechazado; no queda disponible negativo |
| Usuario sin permiso o fuera de ubicación | El servidor vuelve a verificar autorización |

## Verificación ejecutada

```text
npm --prefix apps/mobile run typecheck        correcto
npm --prefix apps/mobile run test:unit        50/50
npx jest apps/api/test/offline-catalog.test.ts --runInBand
                                                1/1 (incluye concurrencia de inventario)
npm run build                                  correcto
```

La aceptación de modo avión, cierre forzado y resolución manual en teléfono se consolida en
`B15-aceptacion.md`; esta evidencia no sustituye esa prueba física final.
