# Diseño del primer incremento: base SaaS

## Resultado esperado

Dos tiendas usan la misma aplicación y las mismas tablas de negocio en bases diferentes. Un token, archivo o evento de una tienda no puede usarse para acceder a la otra. La tienda Lúmina existente continúa funcionando con sus rutas anteriores.

## Componentes

- `tenancy/context.ts`: contexto asincrónico validado de una tienda por petición o trabajo.
- `tenancy/platform.ts`: registro de tiendas, planes y suscripciones en esquema de control `platform`; usa una conexión explícita al control, nunca la conexión dinámica de negocio.
- `prisma/platform/schema.sql`: DDL del registro de control; inicialización transaccional e idempotente.
- `Db`: cliente Prisma de negocio elegido por contexto. Cada tienda limita conexiones a PostgreSQL. Los controladores no construyen URLs desde entrada sin validar.
- `storage.ts`: raíz de archivos por tienda y URLs públicas con prefijo de tienda.
- `AuthService`: tokens de acceso y renovación vinculados a la tienda; compatibilidad de tokens anteriores solo para Lúmina.
- `RealtimeGateway`: autenticación en contexto de la tienda y salas separadas por tienda y ubicación.
- `AvatarJobs`: recorrido de tiendas preparadas, incluidas las suspendidas, para purgar datos privados con su propia base y archivos. Generar avatares nuevos requiere suscripción vigente.
- `scripts/create-tenant.ts`: alta de negocio, base vacía migrada, roles iniciales y administrador; contraseña desde variable de entorno. La cuenta de negocio no necesita privilegios de control.
- `GET /api/tenant`: identidad del negocio, plan y capacidades, disponible para componer la navegación.

## Contrato

La selección usa `X-Tenant-Slug`; al omitirlo se conserva `lumina`. Una tienda inexistente, suspendida o no provisionada no cae silenciosamente en Lúmina. Los tokens llevan `tenant`; cambiar la cabecera no cambia la autorización. Cada petición mantiene su contexto aunque existan otras peticiones concurrentes. Las URLs de recursos de una nueva tienda incluyen `/stores/<slug>/assets/`.

El contexto de tienda se resuelve antes de controladores, autenticación y archivos. Las suscripciones y precios de planes se almacenan con estado explícito; durante este incremento no se simula una integración Stripe terminada. El control de expiración debe distinguir lectura, renovación y escrituras comerciales.

## Criterios de aceptación

1. Token Lúmina rechazado al solicitar una segunda tienda.
2. Mismo correo y mismos identificadores de catálogo en dos bases no mezclan datos.
3. Peticiones concurrentes mantienen base y directorio correctos.
4. Una imagen con el mismo nombre en dos tiendas devuelve el archivo de su propia tienda.
5. Una operación de inventario no difunde eventos a otra tienda.
6. Un administrador de tienda no accede al registro global ni configura otra suscripción.
7. Token anterior sin `tenant` solo conserva compatibilidad con Lúmina.
8. La batería anterior sigue aprobando los recorridos existentes.

## Revisión de decisiones

Se elige base por tienda para evitar una conversión apresurada de 49 tablas y numerosas consultas SQL directas. Es necesario automatizar las migraciones de todas las bases y limitar el número de clientes Prisma activos. La creación de bases solo se permite a la herramienta de provisión o al servicio de control autorizado. Ningún código recibido de la IA participa en este proceso.
