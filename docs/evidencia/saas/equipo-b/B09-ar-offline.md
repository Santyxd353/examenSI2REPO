# B09 — Vestidor AR offline

Estado: `VERIFICADO_LOCAL_CON_PRUEBA_FISICA_PENDIENTE` (09/11/2026).

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

B15 debe registrar: descarga real, cierre de la app, modo avión, arranque en frío, permiso de
cámara, seguimiento de hombros/cadera y cambio entre dos prendas locales. Hasta completar ese
recorrido no se afirma que la cámara offline fue aceptada en el dispositivo final.
