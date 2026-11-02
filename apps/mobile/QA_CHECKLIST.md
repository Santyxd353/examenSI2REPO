# Prueba física Android — Lúmina QA

Ejecutar con el teléfono conectado por USB, la API local encendida y `adb reverse tcp:3018 tcp:3018` activo. Registrar fecha, modelo de teléfono y resultado de cada caso.

## Sesión y diseño

- [ ] Abrir la APK, iniciar sesión como administrador y cerrar/abrir la aplicación: la sesión se restaura.
- [ ] Verificar que ningún encabezado queda detrás de la barra de estado.
- [ ] Verificar que catálogo, carrito y cuenta no quedan debajo de la barra de navegación.
- [ ] Probar orientación horizontal o una pantalla ancha: el catálogo usa tres columnas y las métricas administrativas se distribuyen correctamente.

## Administración

- [ ] Crear un borrador de prenda con categoría, material y descripción válidos.
- [ ] Crear una ubicación de tipo tienda y otra de tipo almacén.
- [ ] Crear un vendedor con contraseña temporal y una ubicación asignada.
- [ ] Consultar inventario por ubicación y registrar un conteo físico válido.
- [ ] Consultar pedidos recientes y el reporte de los últimos treinta días.
- [ ] Preguntar al asistente de reportes por ventas e inventario; comprobar que solo responde con datos de lectura.

## Offline y sincronización

- [ ] Con conexión, entrar en Sincronización y comprobar que la cola está vacía o identificar sus pendientes.
- [ ] Activar modo avión, crear una intención offline soportada y cerrar/abrir la aplicación.
- [ ] Desactivar modo avión, sincronizar y verificar un recibo aplicado sin duplicar el efecto.
- [ ] Provocar una modificación concurrente para obtener un conflicto y confirmar que la intención queda marcada como conflicto, sin aplicarse dos veces.

## Catálogo y AR

- [ ] Abrir catálogo, filtros, favoritos, carrito y cuenta.
- [ ] Probar la cámara AR con una prenda compatible; confirmar permiso de cámara, encuadre y aviso de aproximación.
- [ ] Repetir con poca luz y con orientación distinta; anotar estabilidad y rendimiento.

## Cierre de QA

- [ ] Capturar evidencia de los casos aprobados y de cualquier error reproducible.
- [ ] Corregir hallazgos antes de construir el APK firmado de producción.
- [ ] No declarar pagos reales, reconocimiento de voz, iOS ni ajuste físico AR como completados sin sus pruebas y credenciales correspondientes.
