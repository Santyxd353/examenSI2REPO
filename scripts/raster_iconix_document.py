"""Usa el renderer empaquetado con el PDF exportado por Word en Windows."""
from pathlib import Path
import sys
import importlib.util

script=Path('C:/Users/ASUS/.codex/plugins/cache/openai-primary-runtime/documents/26.1026.10807/skills/documents/render_docx.py')
module_spec=importlib.util.spec_from_file_location('packaged_docx_renderer',script)
module=importlib.util.module_from_spec(module_spec);module_spec.loader.exec_module(module)
docx,pdf,out=map(lambda p:str(Path(p).resolve()),sys.argv[1:4])
if not Path(pdf).is_file():raise FileNotFoundError(pdf)
module.convert_to_pdf=lambda *args,**kwargs:(pdf,'Conversión nativa Word; LibreOffice no disponible en Windows.')
pages=module.rasterize(docx,out,144,False,False)
print(f'Render verificado: {len(pages)} PNG mediante render_docx.py y Poppler del runtime.')
