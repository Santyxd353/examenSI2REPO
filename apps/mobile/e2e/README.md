# B15 — Pruebas nativas Android

Estos flujos usan [Maestro](https://maestro.mobile.dev/) sobre la variante QA. No
contienen contraseñas, tokens ni datos personales. Las cuentas y datos de QA se
inyectan como variables de entorno en la terminal local.

## Preparación

1. Conectar un único dispositivo autorizado y comprobarlo con `adb devices`.
2. Arrancar la API de QA y usar una URL HTTPS; para desarrollo por USB se admite
   temporalmente `adb reverse tcp:3018 tcp:3018`.
3. Instalar la APK QA del mismo commit que la API.
4. Instalar Maestro desde su canal oficial y confirmar `maestro --version`.
5. Preparar dos cuentas de QA de negocios distintos y datos semilla: catálogo,
   una variante con stock y un pedido confirmado. No usar cuentas reales.

Ejemplo de variables PowerShell (no guardar este bloque con valores reales):

```powershell
$env:QA_STORE = 'tienda-qa-a'
$env:QA_ADMIN_EMAIL = 'admin-qa@example.invalid'
$env:QA_ADMIN_PASSWORD = 'solo-en-tu-terminal'
$env:QA_SECOND_STORE = 'tienda-qa-b'
$env:QA_SECOND_EMAIL = 'admin-b@example.invalid'
$env:QA_SECOND_PASSWORD = 'solo-en-tu-terminal'
maestro test apps/mobile/e2e
```

Los selectores `qa-*` son `testID` estables. No se usan coordenadas.

## Alcance y límites

- Los YAML automatizan navegación, sesión, consulta y aislamiento visible.
- `stockConflict`, `lostResponse` y `checkoutRecord` necesitan las precondiciones
  que indica cada archivo; Maestro no debe fingir una respuesta perdida ni una
  cámara física.
- La cámara/pose, el permiso de micrófono, el modo avión, la reinstalación y la
  validación visual se ejecutan manualmente según `../QA_CHECKLIST.md` y se
  anotan en `docs/evidencia/saas/equipo-b/B15-aceptacion.md`.
- Antes de distribuir una APK, usar endpoint HTTPS. `localhost` y `adb reverse`
  son solo para este laboratorio por USB.
