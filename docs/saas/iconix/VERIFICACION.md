# Verificación documental del 31 de octubre de 2026

Archivo revisado: `docs/Lumina_SaaS_ICONIX_Grupo18.docx`.

SHA256 del Word:
`23d0f83c3892c154a8f19198526d7ea17b0cc3f388e8a9705e1e3fcb80d16579`.

La verificación estructural del archivo final confirmó:

- 54 requisitos funcionales vinculados con 27 casos de uso.
- 111 figuras y sus 111 fuentes SVG editables.
- Diccionario de 59 tablas, con ampliaciones propuestas identificadas.
- Dos carátulas e integrantes en orden alfabético.
- Índice generado en Word, 267 marcadores y 213 enlaces internos con destino válido.
- 21 enlaces externos, bibliografía, recomendaciones y dos QR finales.
- 194 páginas renderizadas; ninguna vacía, sin caracteres de sustitución ni texto fuera del papel.

Se inspeccionaron las páginas por tramos mediante PNG a 144 dpi. Las
correcciones cerraron numeración de flujos continuada entre casos, cabeceras
de tablas sin filas, etiquetas y rutas superpuestas, nombres recortados y
espacios de hipervínculos. Se revisaron los diagramas y textos modificados
en los renders posteriores. La comparación final conservó la paginación y
las posiciones de las figuras; las diferencias de texto tipográfico no
editado fueron menores a 0,6 puntos. No se detectaron nuevos desbordamientos.

Comandos ejecutados con el runtime de documentos:

```powershell
& $taskPython -X utf8 scripts/verify_iconix_document.py .local/iconix/render-final
& $taskPython -X utf8 -m py_compile scripts/build_iconix_document.py scripts/iconix_diagrams.py scripts/raster_iconix_document.py scripts/verify_iconix_document.py
git diff --cached --check
```

El informe anterior conserva su SHA256:
`d72a18adb0d7779f52b3e8f483ba5a17c34d1561b78385798e446c944e75338c`.

Esta evidencia corresponde al documento. No acredita nuevas pruebas
funcionales, entrenamiento ML ni despliegues. La aplicación y la VM no se
modificaron en esta actualización. Los PNG y PDF usados para revisión se
conservan localmente y no forman parte de la entrega del Word.
