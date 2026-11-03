# Android QA

La variante QA se construye con `APP_VARIANT=qa`. Instala una aplicación separada:

- Nombre: `Lúmina QA`
- Android applicationId: `bo.edu.grupo18.vestidorar.qa`
- No sustituye la instalación oficial.

## Requisitos

- Android SDK y JDK 21.
- `EXPO_PUBLIC_API_URL` configurada con la URL de QA acordada.
- Un keystore de QA. La clave de producción no se almacena en este repositorio.

## Construcción local

```powershell
Push-Location apps/mobile
$env:APP_VARIANT = 'qa'
$env:EXPO_PUBLIC_API_URL = 'https://api-qa.example/api'
npx expo prebuild --platform android --no-install
Push-Location android
./gradlew.bat assembleRelease
Pop-Location
Pop-Location
```

Antes de entregar, registrar SHA-256, bytes, versionName, versionCode, applicationId, certificado y URL API. La firma oficial requiere el certificado autorizado del proyecto.

## Verificar el artefacto

La verificación no publica ni firma nada; rechaza una URL sin HTTPS. Para una
APK QA firmada con depuración se debe declarar explícitamente el límite:

```powershell
./scripts/verify-android-artifact.ps1 `
  -ApkPath 'apps/mobile/android/app/build/outputs/apk/release/app-release.apk' `
  -ApiUrl 'https://api-qa.example/api' `
  -ExpectedPackage 'bo.edu.grupo18.vestidorar.qa' `
  -AllowDebugCertificate
```

Para producción, omite `-AllowDebugCertificate`, usa el paquete
`bo.edu.grupo18.vestidorar`, un `versionCode` superior al instalado y una firma
propia cuya clave privada no se guarda en este repositorio.
