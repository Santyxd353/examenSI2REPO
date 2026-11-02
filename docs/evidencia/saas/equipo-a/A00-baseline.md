# A00 — Entorno aislado y baseline

Fecha: 02/11/2026, America/La_Paz. Estado: VERIFICADO_LOCAL.
Base: `14ffcc9`. Rama: `desarrollo/servidor-web`.

El checkout de integración conserva su estado. El trabajo A usa un git worktree
en `.local/worktrees/servidor-web`, ignorado por la regla `.local/` existente.
La herramienta nativa rechazó el repositorio anidado bajo el workspace; se
utilizó git sin borrar ni mover el directorio original.

Entorno: Windows, Node 22.19.0, PostgreSQL 18.3 local en 127.0.0.1:55418.
Se comprobó host/puerto antes de preparar `vestidor18_test`. No se imprimieron
contraseñas ni se conectó a la VM. npm ci raíz y móvil desde sus locks actuales.

El primer ensayo dio 92/100: faltaban reference.glb, el intérprete avatar y
dependencias Expo en el nuevo worktree. Se copió únicamente la referencia GLB
pública de pruebas, se configuró el intérprete local existente en el `.env`
ignorado y se instalaron dependencias móviles sin modificar sus manifests.
No se cambiaron las pruebas para ocultar esos fallos.

Verificación observada:

- `npm run db:generate`: aprobado.
- `npm run db:prepare-test`: aprobado, semilla femenina de 12 productos/36 variantes.
- `npm test` después de preparar el entorno: **18 suites, 100/100 aprobadas**.
- `npm run build`: API y web compiladas.
- `npm run test:admin-ui`: Chromium comprobó navegación modular, ancho móvil,
  venta persistida y confirmación visual; aprobado.

Los logs completos están en `.local/logs/` del worktree y no contienen valores
de secretos en este informe. Estos resultados corresponden al baseline, no
acreditan todavía offline, suscripciones TEST ni nuevo ML integrado.

La rama remota B existe y contiene Android/workers y algunas extensiones API.
A01 publicará contratos y fixtures completos para reemplazar interpretaciones
locales. Esas extensiones se revisan antes de integrar; no se considera G0b
aprobado hasta comprobar el consumidor Android real.
