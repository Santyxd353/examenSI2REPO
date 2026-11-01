# Especificación ICONIX de Lúmina

Línea base del 31 de octubre de 2026, para entrega el 7 de noviembre.
Los planes confirmados cuestan Bs149, Bs299 y Bs599 por tienda y mes.
Primero se documenta; la implementación pendiente seguirá estos contratos.

- Informe: `docs/Lumina_SaaS_ICONIX_Grupo18.docx`.
- Fuente de requisitos, casos y datos: `especificacion.json`.
- Figuras editables: `diagramas/*.svg`.
- Generador: `scripts/build_iconix_document.py` e `iconix_diagrams.py`.
- Referencia conservada: `docs/Plataforma_Vestidor3D_Grupo18.docx`.

El generador conserva las dos carátulas de la referencia y crea el cuerpo
ICONIX, 111 figuras, 27 casos y el diccionario de 59 tablas. Las columnas
propuestas se distinguen de las existentes. Los resultados de pruebas y ML
de los incrementos nuevos no se inventan: siguen planificados.

## Reproducir el Word

Se requieren Python con python-docx, Pillow, lxml, reportlab, pypdf y
pdfplumber; fuentes Arial de Windows; Word para actualizar el índice y
exportar PDF; y Poppler para la revisión visual. La autoría utilizó las
dependencias empaquetadas del entorno de documentos de Codex. El renderizador
invoca su `render_docx.py` con el PDF exportado por Word porque LibreOffice
no está instalado. Es una adaptación del render, no una conversión sin revisar.

Desde la raíz del repositorio:

```powershell
& $taskPython -X utf8 scripts/build_iconix_document.py
& ./scripts/render_iconix_document.ps1 -OutputDirectory .local/iconix/render
& $taskPython -X utf8 scripts/verify_iconix_document.py .local/iconix/render
```

`$taskPython` debe apuntar al Python del runtime de documentos. Los scripts
de render incluyen las rutas del entorno de autoría; se deben ajustar si
se reproducen en otro equipo. Los PNG y PDF de `.local` son revisión interna.
La verificación estructural comprueba cobertura, marcadores, enlaces y
páginas; es necesario inspeccionar visualmente cada PNG antes de entregar.

La aplicación y la VM no se modificaron al generar esta línea base.
