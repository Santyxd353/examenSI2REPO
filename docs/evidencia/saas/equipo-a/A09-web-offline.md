# A09 · Vestidor, catálogo e inventario offline en la web

La web permite preparar descargas en la tienda activa, reabrirlas sin conexión y registrar cambios pendientes desde Administración → Sincronización. El catálogo y el stock indican la fecha del corte. Las ventas y los pagos conservan su flujo con conexión.

| Flujo | Evidencia de navegador |
| --- | --- |
| Vestidor | Diez prendas de la colección, talla L y prioridad Nike. La prueba altera la respuesta de un GLB y comprueba el estado parcial. El reintento verifica el archivo faltante y deja las diez prendas listas. |
| Reapertura | Chromium se cierra por completo. Se vuelve a abrir el mismo perfil con red desactivada, se carga el shell y se renderizan un GLB de prenda y el avatar aprobado de prueba. |
| Inventario | Un delta de +3 y un conteo se guardan sin red. Tras reabrir sobreviven la cola y la proyección. El delta confirma una vez pese a perder la primera respuesta. El conteo conserva su conflicto y la conciliación usa un UUID nuevo. |
| Catálogo | Se guarda offline una prenda con JPEG y una edición dependiente. El servidor confirma las dos operaciones y registra un solo recurso. Se archiva posteriormente desde el mismo módulo. |
| Identidad local | El cierre con conservación elimina la clave activa. El ensayo de IndexedDB verifica que otra cuenta y tienda no leen la intención y que una escritura tardía del contexto anterior se rechaza. La cuenta original recupera el UUID y el hash después de autenticarse. |

Los binarios, el snapshot y la cola se cifran en IndexedDB con AES-GCM. La clave activa del dispositivo es un objeto Web Crypto no exportable. Los datos asociados ligan cada sobre a tienda, actor, dispositivo, recurso y versión de clave. La cola guarda la intención y los archivos adjuntos en una transacción. La vista pendiente se calcula a partir de las intenciones durables. Web Locks evita dos envíos simultáneos desde pestañas con la misma identidad.

El service worker se genera con los archivos públicos que realmente produjo la compilación. Almacena el shell y sus módulos estáticos. La prueba de caché confirma que los archivos autenticados y las respuestas de API quedan fuera de CacheStorage. Las copias se abren desde un origen HTTPS o localhost.

La primera prueba de reapertura encontró nombres de módulos temporales de Vite en la lista de caché. La lista se genera después de escribir la salida para que la instalación solo solicite archivos existentes. El catálogo muestra la silueta aproximada del Grupo 18 y la prueba del avatar parte de parámetros de control exportados por Blender. La aceptación de Android físico y del avatar generado desde fotografías permanece en sus bloques correspondientes.

```powershell
npm run build
node scripts/check-offline-vault.cjs
node scripts/check-offline-web.cjs
node scripts/check-admin-ui.cjs
```

El ensayo crea una tienda aislada en PostgreSQL local, descarta esa base al terminar y conserva las capturas de comprobación en `.local`. La suite general de A08 aprobó 214 pruebas. Las siete pruebas de servidor web y aislamiento HTTP volvieron a pasar con la compilación de A09.
