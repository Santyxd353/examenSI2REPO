# B16 — Candidato APK y handoff

## Estado

**APK QA ARM64 construida, verificada e instalada el 09/11/2026.** Es un
candidato académico/laboratorio y no una publicación de Play Store: usa el
certificado Android Debug y un API local mediante USB.

## Manifiesto del artefacto

| Campo | Valor |
| --- | --- |
| Archivo local | `dist/android/lumina-qa-0.1.2-arm64.apk` |
| Bytes | `59056989` |
| SHA-256 | `7AB162F826FCB97CFF4DB75D00E550691112DBD01FDF8DB5F6DDC88C838A30BE` |
| Paquete | `bo.edu.grupo18.vestidorar.qa` |
| Versión | `0.1.2` (`versionCode 3`) |
| SDK mínimo / objetivo | 24 / 36 |
| ABI | `arm64-v8a` |
| Firma | Android Debug, permitida solo para QA |
| API incluida | `http://localhost:3018/api`, accesible con `adb reverse` |

El APK no se sube al repositorio porque es un binario reproducible de 59 MB.
El código, las instrucciones y el hash sí quedan versionados.

Actualización B09/B12 instalada sobre este candidato en el TECNO: `dist/android/lumina-qa-b12-arm64.apk`,
59 059 777 bytes, SHA-256 `532E8FA72CA426BC900A81D9B526F5B26BFEFD7DB12F67E07EEB44C38DA47675`.
Conserva el paquete, firma QA y URL de laboratorio de la tabla.

## Verificación reproducible para este candidato

```powershell
./scripts/verify-android-artifact.ps1 `
  -ApkPath 'dist/android/lumina-qa-0.1.2-arm64.apk' `
  -ApiUrl 'http://localhost:3018/api' `
  -ExpectedPackage 'bo.edu.grupo18.vestidorar.qa' `
  -AllowDebugCertificate `
  -AllowLoopbackApi
```

## Instalación de laboratorio

```powershell
adb reverse tcp:3018 tcp:3018
adb install -r dist/android/lumina-qa-0.1.2-arm64.apk
```

Para una publicación real aún se debe proporcionar externamente una URL API
HTTPS y un certificado privado de producción. Esas credenciales no se generan
ni se almacenan en Git. La versión de presentación local ya queda completa y
reproducible sin esos recursos externos.
