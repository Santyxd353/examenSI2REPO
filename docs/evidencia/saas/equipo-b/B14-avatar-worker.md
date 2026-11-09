# B14 — Worker de avatar, regeneración y vestidor

Estado: `VERIFICADO_LOCAL` (09/11/2026).

- El worker valida altura, dos vistas distintas y calidad mínima antes de generar.
- Las proporciones dependen de la silueta y medidas; no se entrega un avatar constante.
- Exporta GLB 2.0 válido con dimensiones personales y rutas de trabajo controladas.
- El API mantiene versiones, revisión/aprobación, privacidad por usuario y borrado con purga de
  GLB, medidas y temporales.
- Vestidos y faldas de demostración conservan mallas separadas; el AR corporal Android continúa
  usando el detector nativo y recursos PNG verificados de B09.

Verificación ejecutada:

```text
workers/avatar/.venv/Scripts/python.exe -m pytest workers/avatar/tests -q
11 passed
npx jest apps/api/test/avatar.test.ts apps/api/test/commerce.test.ts apps/api/test/orders.test.ts --runInBand
16 passed
```
