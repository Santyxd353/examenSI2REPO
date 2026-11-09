# Despliegue en VM Azure

La VM ejecuta tres contenedores con Docker Compose:

- `proxy`: Caddy publica HTTPS y renueva el certificado.
- `app`: web React, API NestJS, worker MediaPipe/Blender y worker analítico en dos entornos Python independientes.
- `database`: PostgreSQL 16, accesible solo desde la red interna de Docker.

Los datos PostgreSQL, archivos privados y certificados usan volúmenes persistentes. Cada tienda tiene su base comercial; el registro de control conserva las conexiones y suscripciones. Las claves maestras y sus versiones forman parte del material de recuperación y se guardan fuera de Git.

## Código de la instancia publicada

La instalación anterior se preparó desde `main` de `https://github.com/Santyxd353/examenSI2REPO.git` en `/opt/vestidor18-repo`. El candidato SaaS se trabaja en `integracion/android`: requiere cerrar las comprobaciones pendientes antes de su promoción final. La nueva VM y el despliegue están pendientes por decisión del usuario; estas instrucciones no afirman que el candidato esté publicado.

El archivo `.env.vm` se conserva solo en el destino. La plantilla actual es `infra/vm/.env.example`; sus marcadores deben reemplazarse, incluidas las claves offline y las credenciales del operador. Una restauración conserva todas las versiones de claves anteriores. `RUN_DB_SEED=false` evita cargar semillas al arrancar. Stripe/IA requieren configuración y comprobación con las cuentas autorizadas.

## Preparación y recuperación antes de publicar

Ejecutar el ensayo local descrito en [A16 — recuperación local](evidencia/saas/equipo-a/A16-recuperacion-local.md). Comprueba control, dos tiendas, archivos y claves con datos sintéticos; no genera un respaldo de producción.

Antes de cambiar el destino, bloquear escrituras y detener los workers, inventariar todas las tiendas y obtener dumps consistentes de control y de cada base. Conservar archivos privados, recursos, modelos y certificados con un manifiesto de rutas/tamaños/SHA-256. Guardar `.env.vm`, credenciales y versiones de claves en una bóveda separada. Ensayar la restauración en bases y almacenamiento nuevos; conservar el original hasta aprobar las comprobaciones. El ensayo QA no sustituye ese respaldo real ni valida permisos de los roles de la nueva VM.

Un cambio de imagen no revierte una migración de esquema. Ante una reversión incompatible se recuperan el código, las bases, los archivos y el material de claves del mismo corte. El punto de recuperación y el tiempo de indisponibilidad se medirán sobre el destino definitivo.

## Publicar el SHA verificado

Solo después de cerrar aceptación, build Linux, restauración y firma Android; no ejecutar como actualización automática del candidato actual. El SHA verificado debe estar disponible en el repositorio antes de usar estos comandos.

```bash
cd /opt/vestidor18-repo
git fetch origin
DEPLOY_SHA=REEMPLAZAR_POR_SHA_VERIFICADO
git switch --detach "$DEPLOY_SHA"
sudo docker compose --env-file .env.vm -f infra/vm/compose.yml config --quiet
sudo docker compose --env-file .env.vm -f infra/vm/compose.yml up -d --build
```

Estado:

```bash
sudo docker compose --env-file .env.vm -f infra/vm/compose.yml ps
sudo docker compose --env-file .env.vm -f infra/vm/compose.yml logs --tail=100
```

La base de datos no publica el puerto 5432. Los únicos puertos públicos son SSH 22, HTTP 80 y HTTPS 443.
