# Despliegue en Azure

## Arquitectura preparada

- **Azure Container Apps:** ejecuta API NestJS, web React y worker de avatares en una imagen Linux.
- **Azure Database for PostgreSQL Flexible Server 16:** conserva datos y aplica migraciones Prisma al iniciar.
- **Azure Files:** monta `/data`; conserva fotos temporales, modelos de avatar y prendas GLB entre reinicios.
- **Azure Container Registry:** construye y almacena la imagen sin requerir Docker local.
- **Identidad administrada:** Container Apps descarga imágenes desde ACR sin usuario ni contraseña del registro.
- **Log Analytics:** recibe logs de consola y estado del contenedor.

La app usa una réplica de 2 CPU y 4 GiB. Esto evita duplicar el worker incluido en el proceso y mantiene WebSocket, migraciones y archivos simples para esta entrega. Para escalar horizontalmente se debe separar el worker en otra Container App y usar una cola.

## Archivos

| Archivo | Función |
|---|---|
| `Dockerfile.azure` | Construye Node 22, React, Prisma, Python, MediaPipe y Blender. |
| `docker/azure-entrypoint.sh` | Aplica migraciones, genera GLB base, ejecuta semilla idempotente y arranca API. |
| `infra/azure/main.bicep` | Crea ACR, identidad, entorno, Azure Files, PostgreSQL y Log Analytics. |
| `infra/azure/app.bicep` | Crea Container App, secretos, volumen, HTTPS y sondas de salud. |
| `scripts/deploy-azure.ps1` | Construye imagen, despliega recursos y verifica `/api/health`. |
| `.github/workflows/deploy-azure.yml` | Despliegue manual con OpenID Connect desde GitHub Actions. |

## Desplegar desde una computadora

### Requisitos

1. Suscripción Azure con permiso para crear recursos y asignar el rol `AcrPull`.
2. [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli-windows) instalado.
3. Sesión iniciada:

```powershell
az login
az account set --subscription ID_O_NOMBRE_DE_SUSCRIPCION
```

### Crear o actualizar

Desde la raíz del repositorio:

```powershell
./scripts/deploy-azure.ps1 `
  -SubscriptionId 'ID_DE_SUSCRIPCION' `
  -ResourceGroup 'rg-vestidor18' `
  -Location 'eastus2' `
  -Prefix 'vestidor18'
```

El script registra proveedores, crea el grupo, despliega Bicep, construye la imagen en ACR, publica Container App y espera una respuesta correcta de salud. Si no se pasan secretos, genera valores aleatorios. No los imprime ni los guarda en Git.

Para mantener secretos fijos entre despliegues:

```powershell
$env:AZURE_POSTGRES_PASSWORD = 'CONTRASENA_LARGA_Y_ALEATORIA'
$env:AZURE_JWT_SECRET = 'SECRETO_JWT_DE_48_O_MAS_CARACTERES_ALEATORIOS'
./scripts/deploy-azure.ps1 -SubscriptionId 'ID_DE_SUSCRIPCION'
```

La salida final muestra:

- URL web HTTPS.
- URL de salud.
- valor `EXPO_PUBLIC_API_URL` para Expo.

Cada ejecución usa una etiqueta nueva. Migraciones y semilla son idempotentes.

## Configurar GitHub Actions

El flujo se ejecuta solo de forma manual en **Actions → Desplegar en Azure → Run workflow**.

Crear un registro de aplicación con federación OpenID Connect para este repositorio y configurar secretos del entorno `production`:

| Secreto | Valor |
|---|---|
| `AZURE_CLIENT_ID` | Client ID de identidad o aplicación federada. |
| `AZURE_TENANT_ID` | Tenant ID. |
| `AZURE_SUBSCRIPTION_ID` | Subscription ID. |
| `AZURE_POSTGRES_PASSWORD` | Contraseña aleatoria de al menos 24 caracteres. |
| `AZURE_JWT_SECRET` | Secreto aleatorio de al menos 48 caracteres. |

Variables opcionales:

| Variable | Predeterminado |
|---|---|
| `AZURE_RESOURCE_GROUP` | `rg-vestidor18` |
| `AZURE_LOCATION` | `eastus2` |
| `AZURE_PREFIX` | `vestidor18` |

La identidad de GitHub necesita permisos para crear recursos en el grupo y asignar `AcrPull` al registro.

## App móvil Expo

La web y API usan el mismo dominio. Para compilar la app móvil:

```powershell
cd apps/mobile
$env:EXPO_PUBLIC_API_URL = 'https://URL_DE_CONTAINER_APP/api'
npx eas-cli build --platform android --profile preview
```

Para EAS remoto, registrar `EXPO_PUBLIC_API_URL` en variables del proyecto o del perfil antes de compilar. La URL debe terminar en `/api` y usar HTTPS.

## Operación

Salud:

```powershell
Invoke-RestMethod 'https://URL_DE_CONTAINER_APP/api/health'
```

Logs:

```powershell
az containerapp logs show --name NOMBRE_APP --resource-group rg-vestidor18 --follow
```

Crear primer administrador después de registrar la cuenta desde la interfaz:

```powershell
az containerapp exec `
  --name NOMBRE_APP `
  --resource-group rg-vestidor18 `
  --command "./node_modules/.bin/tsx scripts/grant-admin.ts correo@ejemplo.com"
```

Los archivos permanecen en Azure Files al desplegar otra revisión. PostgreSQL conserva pedidos, usuarios, inventario, auditoría y trabajos.

## Seguridad y límites actuales

- HTTPS externo queda habilitado y HTTP se rechaza.
- ACR no usa cuenta administrativa; la descarga usa identidad administrada.
- Contraseña PostgreSQL y secreto JWT se guardan como secretos de Container Apps.
- Conexión PostgreSQL exige `sslmode=require`.
- La regla `0.0.0.0` de PostgreSQL permite conexiones desde servicios Azure de cualquier suscripción que conozcan credenciales. Para un entorno comercial, mover Container Apps y PostgreSQL a red virtual con acceso privado.
- Azure Files usa clave de cuenta en la configuración protegida del entorno Container Apps. Rotar la clave exige actualizar ese vínculo.
- Una réplica siempre activa genera costo continuo. El servidor PostgreSQL, Azure Files, Log Analytics, ACR y compilaciones también generan costo.

## Eliminar el entorno

Esto borra aplicación, base de datos y archivos. Exportar datos antes:

```powershell
az group delete --name rg-vestidor18
```

## Referencias oficiales

- [Montar Azure Files en Azure Container Apps](https://learn.microsoft.com/azure/container-apps/storage-mounts-azure-files)
- [Usar identidad administrada para descargar imágenes](https://learn.microsoft.com/azure/container-apps/managed-identity-image-pull)
- [Configurar ingreso HTTPS en Container Apps](https://learn.microsoft.com/azure/container-apps/ingress-how-to)
- [Reglas de firewall de PostgreSQL Flexible Server](https://learn.microsoft.com/azure/postgresql/security/security-firewall-rules)
- [TLS en PostgreSQL Flexible Server](https://learn.microsoft.com/azure/postgresql/security/security-tls-how-to-connect)
