# B09 — Vestidor AR offline

Estado: descarga y apertura offline comprobadas en TECNO KL4, Android 14 (09/11/2026).

## Alcance integrado

- La clienta puede preparar desde el catálogo hasta diez recursos AR publicados.
- La selección excluye borradores, variantes repetidas, recursos ya guardados, rutas de otro
  origen y manifiestos sin SHA-256 válido.
- Cada PNG se descarga al almacenamiento privado de la aplicación y se publica en SQLite solo
  después de comprobar su SHA-256.
- Las descargas parciales se conservan; un recurso fallido queda disponible para reintentar sin
  eliminar los que sí terminaron.
- El catálogo de cliente se cifra por tienda, usuaria y dispositivo para permitir arranque en frío
  y selección de prendas sin red.
- El vestidor busca primero el URI local verificado; solo usa la URL pública si la prenda todavía
  no está descargada.
- El modelo nativo de pose forma parte de la APK y no depende de una CDN.
- Un inicio sin red reutiliza el DEK ligado al dispositivo mientras no se haya cerrado sesión.

## Verificación ejecutada

| Verificación | Resultado |
| --- | --- |
| Límite total de diez prendas, incluida caché previa | Correcto |
| Rechazo de origen/ruta no autorizados | Correcto |
| No repetir variante ni recurso en caché | Correcto |
| TypeScript móvil | Correcto |
| Pruebas unitarias móviles | 50/50 |
| Compilación del módulo nativo de pose en APK ARM64 | Correcto |
| Apertura de la APK en teléfono sin excepción nativa | Correcto |

## Aceptación física final

El teléfono mostró «10 prendas AR listas para usar sin conexión». Se quitó el túnel USB del API,
se activó el modo avión, se deshabilitó el wifi y se cerró el proceso. Después del arranque en
frío, el catálogo indicó que estaba sin conexión. El vestidor abrió el vestido mini rib Nike
con el indicador «Prenda guardada en este dispositivo» y Android confirmó la cámara activa.
Se restauraron conectividad y túnel. Esta prueba cubre la carga local y la cámara. No se midió
la precisión del seguimiento sobre una persona.
