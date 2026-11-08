# A15 — mostrador Android

Registro actualizado: 08/11/2026. Continúa el candidato `02e306f`; no modifica el servidor ni despliega cambios.

«Ventas y pedidos» incorpora dos accesos independientes: Vender exige `ventas:registrar`; Pedidos exige `pedidos:gestionar`. Cada acceso consulta únicamente su API autorizada. Vender utiliza `/sales/context` y `/sales`: ubicación asignada, búsqueda por prenda/SKU/talla/color, cantidades, resumen en centavos, nombre opcional y medio de cobro declarado. Requiere conexión y conserva el aviso de que registrar tarjeta/QR no procesa un cargo bancario.

Antes de enviar, guarda la intención y su resumen en el almacén privado cifrado del ámbito tienda/persona/dispositivo. Si se pierde la respuesta o se cierra la pantalla, se recupera la misma intención. Un comprobante confirmado queda guardado antes de cualquier actualización de pantalla. Un envío incierto bloquea cambios de contenido y una venta nueva; un rechazo definitivo permite corregir desde otro formulario. Los comprobantes anteriores se conservan al iniciar otra venta.

Evidencia observada:

- Cuatro pruebas nuevas del flujo y una de permisos con fallo previo observado y resultado favorable posterior.
- Suite móvil completa: **74 pruebas aprobadas**, TypeScript aprobado.
- Suite API completa del candidato base: **49 suites/242 pruebas aprobadas**. Tras conectar el mostrador, `saas-acceptance` volvió a pasar sus **tres casos**. Su caso comercial utiliza el flujo Android real contra `/sales`, pierde la respuesta después del commit y reabre otra instancia: queda un pedido TIENDA, junto con uno WEB y uno APP, por Bs 150 en el mismo conjunto de reportes; la otra tienda conserva cero ventas.
- Exportación Android/Hermes aprobada: **1195 módulos**, 3,8 MB; SHA-256 `968497753B92461E02F7EB9B79D00591B80CD03CBDB4FD8E21F8A3AB9015E3FB`.

La verificación no ejecuta un APK. Persistencia SecureStore/SQLite, controles y navegación todavía necesitan la aceptación física B15/B16. El primer export se interrumpió al reiniciarse el entorno de herramientas; la repetición terminó con exit 0. No se cambió la VM ni se apagó la PC.
