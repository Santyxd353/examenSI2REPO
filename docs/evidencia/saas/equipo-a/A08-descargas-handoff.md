# A08 · Copia de catálogo, prendas y archivos para uso offline

El servidor entrega descargas autorizadas a partir de una copia estable del catálogo y del inventario. El cliente conserva esa copia en su almacén cifrado y registra el progreso de cada archivo. A09 y B09 cubren la apertura sin red y la verificación en los dispositivos.

## Contratos para web y Android

| Operación | Entrada y resultado |
|---|---|
| `GET /api/offline/snapshot?deviceId=UUID&pageSize=200` | Inicia un corte de 24 horas. Valida la respuesta con `SnapshotPageSchema`. |
| `GET /api/offline/snapshot?deviceId=UUID&cursor=…` | Continúa el mismo corte con cursor opaco. El servidor fija el tamaño inicial de página y vuelve a comprobar permisos y ubicaciones. |
| `PATCH /api/profile` | El campo `preferences` acepta `brands`, `sizes`, `colors`, `categoryIds` y `favoriteProductIds`. Guardar la selección completa en cada edición. El perfil devuelve la selección en `preferencias.vestidor`. |
| `POST /api/offline/outfits` | Enviar `{deviceId, platform, includeOwnAvatar}`. Los valores de plataforma son `WEB_3D` y `ANDROID_AR`. La elección de guardar el avatar debe ser explícita. |
| `GET /api/offline/outfits/:packageId?deviceId=UUID` | Consulta el manifiesto durante su vigencia. Si el avatar anterior se eliminó o se sustituyó, devuelve `optionalOwnAvatar: null`. |
| `GET /api/offline/outfits/:packageId/files/:resourceId?deviceId=UUID` | Descarga binaria privada. Usar exactamente `privateDownloadUrl`, la sesión de origen y `X-Tenant-Slug`. |
| `POST /api/offline/resources` | Formulario multipart con `file` y un único campo `metadata` que contiene JSON `{deviceId,reference}`. Validar con `ResourceStageRequestSchema` y `ResourceStageResponseSchema`. |

Todas estas rutas requieren sesión vigente y la tienda de origen. Las descargas y cargas offline requieren un dispositivo registrado por A07. Android envía `X-Client-Channel: APP` para obtener el catálogo con los precios de su canal. Una compradora recibe categorías activas, productos publicados y variantes activas sin saldos internos. El personal con permiso de inventario recibe las ubicaciones autorizadas y sus saldos con versión. Las entidades del snapshot son `CATEGORY`, `LOCATION`, `PRODUCT`, `VARIANT` y `STOCK`.

Para consolidar un snapshot, validar `pageHash = SHA256(UTF8(canonicalJson(entities)))` en cada página. Comprobar continuidad de `offset`, `snapshotId`, `asOf`, `scope`, `coverage` y `sha256`. Al final reconstruir `SnapshotDocument` con todas las entidades en el orden recibido y comprobar el hash del documento. Si cambia la autorización, se altera el archivo o vence el cursor, iniciar un corte nuevo. La copia descargada conserva su fecha y sus límites de cobertura. Con `coverage.complete: false`, los registros ausentes no representan saldos cero.

## Paquete de vestidor

El manifiesto fija hasta diez productos distintos. La elección prioriza talla declarada, favoritos, marca, categoría, color y las últimas pruebas de la misma cuenta. Cuando faltan gustos e historial se identifica la selección por reglas. Un catálogo con siete prendas verificadas puede entregar siete prendas completas y explicar la cobertura. Un manifiesto vacío tiene estado `PARCIAL`. La aplicación marca la copia local lista después de verificar los archivos requeridos.

1. Usar `OutfitManifestSchema` y comprobar `tenantId`, `ownerId` y plataforma antes de guardar.
2. Descargar cada binario autenticado y comparar longitud y SHA-256. Guardar su estado por recurso y reintentar los que falten. Un hash incorrecto o disco lleno debe dejar un estado parcial.
3. Usar `productId`, `variantId`, `catalogVersion` y `resourceVersion` para asociar cada recurso a su variante. Hay también nombre, talla, color y, cuando existe, código de color.
4. En Android usar `placement: {algorithm: 'torso-v1',kind}` con `garmentImageFrame(torso, kind)`. En web usar las siluetas GLB g18-1 y sus colores por variante. Los GLB son siluetas aproximadas del Grupo 18 en tallas S, M y L.
5. Guardar el avatar solo con consentimiento. En reconexión comprobar el avatar vigente o la consulta del paquete. El servidor permite descargar el avatar únicamente mientras siga aprobado para la misma cuenta. Si cambió, retirar la copia local anterior. El plazo de 24 horas corresponde a la recuperación de archivos desde el servidor.

## Carga pendiente de catálogo

Formar la referencia con el UUID de archivo estable, SHA-256, longitud, MIME, licencia y propósito. Para AR añadir `variantId` y `placement: {algorithm:'torso-v1',kind:'dress'|'skirt'|'top'}`. GLB requiere `variantId` y malla g18-1 estática con dependencias embebidas. Galería acepta JPEG, PNG y WebP de hasta 10 MiB. AR acepta PNG de hasta 5 MiB con prenda visible y fondo transparente. GLB admite hasta 50 MiB y 100 000 triángulos.

Esperar `VERIFIED` antes de enviar la intención que menciona la misma referencia. Si se pierde la respuesta, volver a cargar los mismos bytes y metadatos con el mismo UUID. Cambiar contenido, licencia o colocación exige una nueva referencia. `RESOURCE_NOT_STAGED` es un bloqueo reintentable que conserva el UUID original de la intención. Los archivos sin asociar se conservan hasta siete días. La limpieza respeta recursos referenciados por el catálogo y su historial.

## Reproducción

```powershell
npm run offline:prepare-resources
npm run offline:prepare-resources -- --regenerate
npm test -- --cacheDirectory .local/jest --runTestsByPath apps/api/test/offline-snapshot.test.ts apps/api/test/offline-outfits.test.ts apps/api/test/offline-resources.test.ts
```

El primer comando verifica los seis GLB originales versionados y los doce PNG AR. La variante `--regenerate` usa el exportador Blender existente y las rutas de Python y Blender de la configuración local. La semilla prepara los recursos antes de registrar la colección. Las referencias de marca e imágenes del catálogo conservan su procedencia académica en `catalog-assets/women/catalog.json`.

Las pruebas HTTP descargaron los veinte archivos en una tienda aislada, verificaron talla L, prioridad de marca, selección estable, catálogo reducido a siete y vacío, corrupción, reintento de staging y aislamiento de cuenta, tienda y dispositivo. El caso del avatar usa una malla de prueba y verifica consentimiento y borrado. La aceptación de fotos reales, reapertura web sin red y Android físico pertenece a los bloques de cliente e integración.

La ejecución del 06/11/2026 aprobó las 214 pruebas en 41 suites, las 14 pruebas de contratos y la compilación de API y web. Blender regeneró los seis modelos con los mismos SHA-256 que los binarios versionados. La primera suite general detectó que la validación añadida a vestidor se aplicaba a modelos históricos. La consulta se acotó a los recursos de staging y se repitió la suite completa.

La validación binaria usa [glTF Validator de Khronos](https://github.com/KhronosGroup/glTF-Validator) y [Sharp](https://sharp.pixelplumbing.com/api-constructor/) con límites de decodificación.
