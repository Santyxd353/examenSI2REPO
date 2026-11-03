# B16 — Candidato APK y handoff

## Estado

**Configuración y verificación preparadas; entrega oficial pendiente.** La APK
QA construida localmente no se presenta como APK de producción porque usa la
firma de depuración. Esta distinción evita reemplazar una aplicación oficial
por otra con un certificado incompatible.

## Variante QA

| Campo | Valor |
| --- | --- |
| Nombre | Lúmina QA |
| Paquete | `bo.edu.grupo18.vestidorar.qa` |
| Código / versión actual | `3` / `0.1.2` |
| Firma permitida | Debug, solo laboratorio QA |
| Endpoint aceptable | HTTPS que termine en `/api`; `localhost` solo por USB durante desarrollo |

## Verificación reproducible

Después de construir el APK, ejecutar desde la raíz:

```powershell
./scripts/verify-android-artifact.ps1 `
  -ApkPath 'apps/mobile/android/app/build/outputs/apk/release/app-release.apk' `
  -ApiUrl 'https://API-QA.example/api' `
  -ExpectedPackage 'bo.edu.grupo18.vestidorar.qa' `
  -AllowDebugCertificate
```

El comando informa SHA-256, bytes, paquete, versión, URL y estado del
certificado. Copiar su salida al registro de entrega, no el APK ni una clave
privada al repositorio.

## Pendientes para producción

1. Ejecutar B15 y corregir sus hallazgos.
2. Desplegar API HTTPS y definir la URL de producción.
3. Recibir/crear en un almacén seguro el certificado de firma autorizado.
4. Configurar la firma de release fuera de Git, subir `versionCode` por encima
   de `3` y construir el paquete oficial `bo.edu.grupo18.vestidorar`.
5. Verificar que el APK no tiene firma Debug, instalarlo limpio y registrar su
   SHA-256, certificado y URL API en esta evidencia.

No se debe declarar una actualización oficial lista mientras falte cualquiera
de estos puntos.
