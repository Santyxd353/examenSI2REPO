# B05 — Base de almacenamiento offline

Estado: `PARCIAL_VERIFICADO_LOCAL` (01/11/2026).

Se añadió el scope offline obligatorio `tenantId + actorId + deviceId`, el
repositorio de intenciones y proyecciones, y una implementación de prueba con
transacción atómica: si la proyección falla, la intención no queda guardada.
Los datos de otro ámbito no se pueden leer ni mezclar.

El vault usa la API AES-GCM de Expo con nonce de 12 bytes, tag de 16 bytes y
AAD explícito. El DEK no se genera ni queda persistido en esta etapa: depende
del sobre/bootstrap autorizado de A01/A07. Esto evita inventar un formato de
claves incompatible o almacenar una clave maestra en la aplicación.

La persistencia nativa usa `withExclusiveTransactionAsync`: inserta la intención
y la proyección en la misma transacción SQLite exclusiva. El vault conserva
solamente el DEK activo por ámbito dentro de SecureStore; cerrar sesión puede
bloquear el ámbito sin borrar su cola SQLite. Verificado:
`npm --prefix apps/mobile run typecheck` y prueba de cola con dos casos
aprobados. El bootstrap de DEK, identidad estable del dispositivo y migración
formal están implementados. Falta aplicar la migración/configurar el secreto en
cada entorno y ejecutar la prueba nativa Android de cifrado/reinicio.
