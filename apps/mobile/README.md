# Vestidor AR móvil

Base React Native/Expo para reemplazar el avatar 3D por una experiencia de cámara. Incluye autenticación móvil con renovación segura, catálogo por ubicación y variante, filtros combinables de marca/color/talla, galería de fotos por prenda, cámara frontal y actualizaciones de inventario mediante WebSocket. Las fotos de catálogo no se usan automáticamente como recursos AR.

Se añadió un primer seguimiento corporal experimental para Android: un módulo nativo MediaPipe analiza capturas temporales de la cámara y devuelve hombros y cadera. Las imágenes PNG de los 12 vestidos y faldas del catálogo se superponen de forma aproximada sobre esos puntos; si una imagen no está disponible, se muestra una silueta vectorial. En Expo Go o iOS se muestra solo una guía; para ver el seguimiento hace falta una compilación Android con el módulo nativo. La superposición no modela la caída de la tela, la oclusión por brazos ni determina la talla correcta.

La variante Marfil de «Camiseta esencial» incluye una imagen PNG transparente generada como muestra ilustrativa. Se ancla a hombros y cadera para probar la superposición de una prenda visual. No representa la foto del producto vendido ni simula el ajuste real de las tallas.

Un administrador con permiso `catalogo:gestionar` puede cargar desde el panel web una imagen frontal PNG transparente por talla y color. La imagen queda en borrador hasta pulsar «Publicar». La API entrega entonces su ruta en `arImagePath` y la app móvil la usa en la cámara para esa variante. Al publicar una nueva imagen para la misma variante, la anterior pasa a borrador. La semilla inicial solo crea el recurso RA si la variante no tiene uno; los siguientes arranques conservan imágenes y estados elegidos por el administrador. Las variantes sin imagen publicada muestran la silueta vectorial; la muestra Marfil permanece solo como ejemplo cuando no hay imagen propia publicada.

## Preparación

1. Copia `.env.example` como `.env` y sustituye la dirección por la IP local de la computadora cuando uses un teléfono físico.
2. Inicia API y base de datos desde la raíz del repositorio.
3. Para probar la guía en Expo Go, ejecuta `npm start` dentro de `apps/mobile`.
4. Para probar seguimiento en Android, instala Android Studio/SDK y una development build: `npm --prefix apps/mobile run android`. Después inicia Metro con `npm --prefix apps/mobile start -- --dev-client`.

Para un teléfono físico configura temporalmente `API_HOST=0.0.0.0` en el `.env` de la raíz y permite el puerto 3018 solamente en la red privada de Windows. Mantén `127.0.0.1` cuando no estés realizando pruebas móviles.

El modelo oficial `pose_landmarker_lite.task` se descarga y verifica con SHA-256 durante la compilación de Android; queda dentro de la aplicación. La inferencia de imágenes se hace localmente. Cada captura se elimina de la caché tras analizarse. La development build Android se compiló en EAS y el seguimiento corporal se verificó en un teléfono físico; falta calibrar posición y rendimiento en más dispositivos. iOS requiere macOS/Xcode y un módulo nativo propio pendiente.

La detección actual toma capturas discretas, aproximadamente una por segundo. El siguiente paso técnico es usar fotogramas en flujo continuo para lograr mayor fluidez, añadir prendas 2D autorizadas, calibrar la cámara frontal en distintos teléfonos y tratar brazos y otras oclusiones.

Desde la raíz se comprueba la parte JavaScript con `npm run mobile:typecheck`, `npm run mobile:check` y `npm run mobile:pose-test`. Estas pruebas no sustituyen la compilación nativa ni la revisión visual en Android.

El video de cámara debe mantenerse en el dispositivo. WebSocket transporta únicamente eventos de disponibilidad, nunca fotogramas.
