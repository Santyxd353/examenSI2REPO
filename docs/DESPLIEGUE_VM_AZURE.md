# Despliegue en VM Azure

La VM ejecuta tres contenedores con Docker Compose:

- `proxy`: Caddy publica HTTPS y renueva el certificado.
- `app`: web React, API NestJS y worker MediaPipe/Blender.
- `database`: PostgreSQL 16, accesible solo desde la red interna de Docker.

Los datos PostgreSQL, archivos de avatares y certificados usan volúmenes persistentes.

## Código de la instancia publicada

La VM usa la rama `main` de `https://github.com/Santyxd353/examenSI2REPO.git` en `/opt/vestidor18-repo`. El archivo `.env.vm` se conserva solo en la VM; no se sube a Git. Los datos de PostgreSQL, los archivos de la aplicación y los certificados permanecen en los volúmenes de Docker Compose.

## Actualizar desde GitHub

```bash
cd /opt/vestidor18-repo
git fetch origin
git checkout main
git pull --ff-only origin main
sudo docker compose --env-file .env.vm -f infra/vm/compose.yml up -d --build
```

Estado:

```bash
sudo docker compose --env-file .env.vm -f infra/vm/compose.yml ps
sudo docker compose --env-file .env.vm -f infra/vm/compose.yml logs --tail=100
```

La base de datos no publica el puerto 5432. Los únicos puertos públicos son SSH 22, HTTP 80 y HTTPS 443.
