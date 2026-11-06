# A12 · Asistencia para reportes

La asistencia funciona con conexión en planes Profesional y Negocio. Usa el corte privado ya descargado y propone una definición que el personal revisa en el formulario. El motor compartido calcula el resultado después de que el personal aplica la definición. Los filtros manuales siguen disponibles cuando el proveedor está deshabilitado.

| Ruta | Solicitud y resultado |
| --- | --- |
| `POST /api/reports/transcribe` | Enviar multipart con un archivo `audio` de hasta 6 MiB en WebM, Ogg, WAV o M4A. Devuelve `{text}` editable. |
| `POST /api/reports/interpret` | Enviar `{operationId,datasetId,text,channel}`. El canal es `TEXTO` o `VOZ`. Devuelve `{consultationId,explanation,definition}`. Si la pregunta necesita aclaración, `definition` es `null`. |

Ambas rutas requieren token, `X-Tenant-Slug`, permiso `reportes:consultar` y suscripción habilitada. El texto se limita a 1.200 caracteres. El navegador limita la grabación a 30 segundos. El audio se procesa en memoria. El adaptador envía la pregunta, el período y un catálogo acotado de campos al proveedor. La propuesta queda limitada a la definición tipada y se valida contra el conjunto autorizado.

La interpretación reserva una unidad y confirma el cargo cuando devuelve una propuesta válida. La transcripción, los errores y las solicitudes de aclaración tienen coste de cuota cero en Lúmina. Reenviar el UUID con el mismo contenido recupera la propuesta sin duplicar el consumo. Si la respuesta se perdió, Android debe conservar el UUID. `REPORT_AI_IN_PROGRESS` indica que la primera ejecución sigue activa. Tras `REPORT_AI_INTENT_FAILED` debe generarse una nueva intención.

Para habilitar el proveedor se configuran `REPORT_AI_OPENAI_KEY`, `REPORT_AI_TEXT_MODEL` y `REPORT_AI_VOICE_MODEL` en el servidor. El adaptador usa Responses con almacenamiento desactivado y Audio Transcriptions. La ausencia de configuración devuelve `REPORT_AI_UNAVAILABLE` con HTTP 503. [OpenAI Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses), [Audio Transcriptions](https://developers.openai.com/api/reference/resources/audio/subresources/transcriptions/methods/create).

## Evidencia local

- `npm test -- --cacheDirectory .local/jest --runTestsByPath apps/api/test/report-assistant.test.ts` comprobó el plan, el aislamiento del corte, la ausencia de proveedor, el rechazo de SQL y una sola cuota confirmada tras transcripción y reintento. El endpoint de ejecución obtuvo Bs 220,00 sobre la definición aprobada del fixture.
- `npm run build` y `node scripts/check-reporting-web.cjs` compilaron el sistema y verificaron la grabación WebM, la revisión de la propuesta y la generación manual del resultado. Los servicios del proveedor usaron respuestas controladas y el micrófono de prueba de Chromium.

Queda pendiente la comprobación con una cuenta de proveedor y la integración en el APK. El despliegue se reserva para la nueva VM.
