# A06 — cuotas, privacidad y vestidor; contrato pendiente B14

Fecha: 04/11/2026. Rama: `desarrollo/servidor-web`. RF17–24/RF34, CU12–15.
Estado: incremento servidor/web verificado localmente. **A06 completo sigue pendiente** de la regeneración B14 y de una aceptación fotos reales → avatar personal. No se ha desplegado este incremento.

## Implementado

- POST `/api/avatars` conserva multipart frente/perfil/espalda, altura100–230, adulto/consentimiento true, idempotencia UUID. JPEG/PNG hasta10MiB por vista. Tres vistas iguales se rechazan por el worker existente; ese caso nunca produce un avatar.
- La aceptación reserva cuota de la tienda y período dentro de la misma transacción que el trabajo. Huella de actor, altura, consentimiento y bytes ordenados por vista; reenvío idéntico recupera el trabajo; otro contenido con el UUID recibe409 `IDEMPOTENCY_CONFLICT`.
- Finalizar exportación válida confirma una unidad una vez. Fallo, captura vencida o tres intentos agotados libera reserva. Reinicio conserva el trabajo y consumo, con carpeta separada por intento. Los trabajos ya aceptados se terminan aunque venza el plan.
- GLB: contenedor y buffers completos, sin URI externas, malla propia g18-1 marcada reference=false, geometría finita, altura real de vértices acorde a la declarada. Valida medidas/parámetros antes de publicar. Un maniquí de referencia, bytes corruptos o escala incoherente falla y libera cuota.
- Nueva versión queda **EN_REVISION** (estado real del esquema); el aprobado anterior sigue activo hasta aprobación explícita. Repetir aprobación es idempotente.
- DELETE propio funciona con suscripción vencida, bloquea nuevas descargas inmediatamente, cancela jobs relacionados y libera reservas; mantenimiento purga GLB/fotos/medidas. Otra persona recibe404. Auditoría con IDs/estados/códigos seguros, sin fotos ni medidas detalladas.
- Web mantiene UUID en reintento tras respuesta perdida. Three.js consume Blob privado; CSP permite `connect-src 'self' blob:` sin hacer público el avatar. El visor ya recibe URL desacoplada del transporte; A09 añadirá el resolvedor de copia cifrada.

## Evidencia y límites

- Regresión final04/11: `npm test -- --cacheDirectory .local/jest --testPathIgnorePatterns offline-sync.test.ts` → **34 suites/181 pruebas aprobadas**,212.313s. Se excluyó exclusivamente la nueva prueba A07 todavía RED y fuera de este commit. `npm run build` y `npm run test:shared` → aprobado,13 contratos. Advertencia de bundle web893.53kB pendiente de división A09, no error de build.
- Pruebas `avatar-quota`6, `avatar-privacy`1, `avatar-output`5 y legado `avatar`6. RED observable de cuota, borrado vencido, salida inválida, aprobación repetida y cola agotada; GREEN después de corregir.
- `avatar-output.test.ts` usa **exportación real de Blender desde parámetros QA declarados**, con sustitución exclusiva del transporte del worker para probar aceptación del servidor. No acredita inferencia de fotos ni regeneración.
- `node scripts/check-fitting-web.cjs`: Chromium real, respuesta de subida perdida tras commit, reintento sin duplicado, revisión/aprobación de GLB exportado, rotación/zoom y variante **M/Negro** exacta en carrito. Resultado `ok:true`, errores JS0; captura local `.local/fitting-web.png` revisada. Usa avatar y vestido de prueba, no fotos de personas. Los recursos QA se generan con Blender; no dependen de que un catálogo de pruebas tenga una variante negra.
- Corregido bloqueo CSP reproducido por consola real. También se corrigió la fixture que elegía un modelo histórico sin archivo; el test ahora prepara su archivo verificable.
- No se ha ejecutado APK ni modificado `apps/mobile` o `workers/avatar`. Rama B inspeccionada `aa8d8e9`: falta B14.

## Contrato B14 a implementar por B

Mantener `python workers/avatar/process.py --job <input.json>` y stdout con un solo JSON; error no0 y `error_code` mayúsculas/guiones bajos (3–60), sin fotos/medidas en logs. Sin modificar Prisma/API.

Entrada GENERAR actual, compatible sin campo action:

```json
{"job_id":"UUID","height_cm":170,"photos":{"FRENTE":"ruta privada","PERFIL":"ruta privada","ESPALDA":"ruta privada"},"output_dir":"directorio privado del intento"}
```

Nueva entrada propuesta para **REGENERAR**, que A conectará después de validar el worker:

```json
{"schemaVersion":"1.0","action":"REGENERAR","job_id":"UUID","source_avatar_id":"UUID","template":"g18-1","height_cm":170,"corrected_measurements_cm":{"pecho":92,"cintura":74,"cadera":98},"source_parameters":{"height":1.7,"chest_width":0.4,"chest_depth":0.25,"waist_width":0.32,"hip_width":0.4,"plantilla":"g18-1"},"source_measurements":{"altura":{"valor_cm":170,"origen":"DECLARADA","confianza":1},"pecho":{"valor_cm":90,"origen":"ESTIMADA","confianza":0.5},"cintura":{"valor_cm":72,"origen":"ESTIMADA","confianza":0.5},"cadera":{"valor_cm":96,"origen":"ESTIMADA","confianza":0.5}},"output_dir":"directorio privado del intento"}
```

No pedir ni reutilizar fotos purgadas. Campos corregibles iniciales: altura100–230cm, pecho/cintura/cadera35–200cm, al menos una corrección. Estos rangos de perímetro conservan los límites actuales de `geometry.py`; son validación de esta aproximación, no recomendación médica. Brazos/piernas informativos hasta que el modelo pueda corregirlos realmente. Recalcular geometría preservando proporciones relativas del avatar fuente; no cambiar solo JSON. Devolver `origen:CORREGIDA` en medidas modificadas, fuente conservada para otras.

Salida común:

```json
{"ok":true,"avatar_file":"<output_dir>/avatar.glb","medidas":{"altura":{"valor_cm":170,"origen":"DECLARADA","confianza":1},"pecho":{"valor_cm":92,"origen":"CORREGIDA","confianza":1},"cintura":{"valor_cm":74,"origen":"CORREGIDA","confianza":1},"cadera":{"valor_cm":98,"origen":"CORREGIDA","confianza":1}},"parametros_malla":{"height":1.7,"chest_width":0.4,"chest_depth":0.25,"waist_width":0.32,"hip_width":0.4,"plantilla":"g18-1"},"version_proceso":"g18-1.1"}
```

Los números ilustran la forma, no certifican geometría calculada. Ajustar realmente la malla. GLB estático con `Cuerpo_G18`, extras plantilla=g18-1/reference=false, transformaciones aplicadas, metros/Yarriba, buffers embebidos, límite50MiB; ninguna descarga de recursos externos. Mantener generación anterior. Entregar pruebas de cambio visible de malla, límites, source inválido, fotos ausentes, error de Blender y GLB real exportado.

A no habilita un botón de regeneración que devuelva éxito ficticio. A integrará reserva/commit, propiedad, versionado, estados y purga al recibir ese worker y su evidencia. La ruta y UI nuevas aún no se anuncian como disponibles.

## Preparación antes del despliegue A16

Configurar PYTHON_PATH/BLENDER_PATH/POSE_MODEL_PATH reales. Drenar o revisar trabajos legacy sin consumo_cuota/hash: el nuevo worker no procesa sin reserva y no puede demostrar igualdad de payload legacy. No inventar cobros históricos ni reaprovechar esos UUID como solicitudes nuevas. A16 debe registrar esta transición. El resto del esquema no cambia en A06.
