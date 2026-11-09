# B06 — Catálogo administrativo offline

Estado: `VERIFICADO_LOCAL` (09/11/2026).

## Alcance integrado

- La aplicación Android descarga y cifra una copia del catálogo administrativo por tienda,
  usuario y dispositivo.
- El administrador puede crear, editar y retirar prendas sin conexión, con una o más
  variantes estables de talla, color, SKU y precio.
- Las operaciones se guardan en SQLite cifrado y conservan el orden de dependencia. Una
  edición o un adjunto espera a que el alta de la prenda haya sido aplicada.
- La sincronización usa identificadores UUID estables, versiones optimistas y recibos
  idempotentes. Un conflicto se conserva como historial y puede reintentarse sobre la
  versión actual del servidor.
- Las imágenes JPEG, PNG y WebP se copian al almacenamiento privado de la aplicación,
  se limitan a 5 MB y se verifican por SHA-256 antes de subirlas.
- El API administrativo lista borradores, publicaciones y prendas retiradas, y el endpoint
  de adjuntos rechaza archivos cuyo contenido, tipo o hash no coincidan.

## Verificación ejecutada

| Verificación | Resultado |
| --- | --- |
| `npm --prefix apps/mobile run typecheck` | Correcto |
| `npm --prefix apps/mobile run test:unit` | 50 pruebas correctas |
| `npx jest apps/api/test/offline-catalog.test.ts --runInBand` | Correcto |
| `npm run build:api` | Correcto |
| Compilación Android QA x86_64 con Hermes | Correcto |
| Compilación e instalación Android QA ARM64 | Correcto |
| Vinculación nativa de `expo-image-picker` | Correcto |
| Inicio y navegación al catálogo en teléfono Android | Correcto, sin excepción nativa |

La prueba de integración del API cubre alta, edición, segunda variante, reenvío de la
misma operación, carga idempotente de imagen, consulta administrativa y retiro lógico.

## Evidencia Android pendiente de aceptación final

La compilación ARM64 se instala y valida como parte de B15. B06 no se declara como
`PUBLICADO` ni como aceptación física final hasta registrar dispositivo, versión de Android,
flujo sin red, reconexión y resultado visual en `B15-aceptacion.md`.
