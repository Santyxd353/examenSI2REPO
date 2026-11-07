targetScope = 'resourceGroup'

param location string = resourceGroup().location
param appName string
param environmentName string
param environmentStorageName string
param acrName string
param identityName string
param image string
param webOrigin string

@secure()
param databaseUrl string

@secure()
param jwtSecret string

resource environment 'Microsoft.App/managedEnvironments@2024-03-01' existing = {
  name: environmentName
}

resource registry 'Microsoft.ContainerRegistry/registries@2023-07-01' existing = {
  name: acrName
}

resource pullIdentity 'Microsoft.ManagedIdentity/userAssignedIdentities@2023-01-31' existing = {
  name: identityName
}

resource app 'Microsoft.App/containerApps@2024-03-01' = {
  name: appName
  location: location
  identity: {
    type: 'UserAssigned'
    userAssignedIdentities: {
      '${pullIdentity.id}': {}
    }
  }
  properties: {
    managedEnvironmentId: environment.id
    configuration: {
      activeRevisionsMode: 'Single'
      ingress: {
        allowInsecure: false
        external: true
        targetPort: 3018
        transport: 'auto'
      }
      registries: [
        {
          identity: pullIdentity.id
          server: registry.properties.loginServer
        }
      ]
      secrets: [
        {
          name: 'database-url'
          value: databaseUrl
        }
        {
          name: 'jwt-secret'
          value: jwtSecret
        }
      ]
    }
    template: {
      containers: [
        {
          name: 'vestidor18'
          image: image
          env: [
            { name: 'NODE_ENV', value: 'production' }
            { name: 'API_HOST', value: '0.0.0.0' }
            { name: 'API_PORT', value: '3018' }
            { name: 'WEB_ORIGIN', value: webOrigin }
            { name: 'SERVE_WEB', value: 'true' }
            { name: 'WEB_ROOT', value: '/app/dist/web' }
            { name: 'TRUST_PROXY', value: '1' }
            { name: 'STORAGE_ROOT', value: '/data/storage' }
            { name: 'PYTHON_PATH', value: '/opt/venv/bin/python' }
            { name: 'POSE_MODEL_PATH', value: '/opt/models/pose_landmarker.task' }
            { name: 'BLENDER_PATH', value: '/usr/bin/blender' }
            { name: 'RUN_DB_SEED', value: 'true' }
            { name: 'DATABASE_URL', secretRef: 'database-url' }
            { name: 'JWT_SECRET', secretRef: 'jwt-secret' }
          ]
          probes: [
            {
              type: 'Startup'
              failureThreshold: 60
              periodSeconds: 5
              timeoutSeconds: 3
              httpGet: {
                path: '/api/health'
                port: 3018
                scheme: 'HTTP'
              }
            }
            {
              type: 'Liveness'
              failureThreshold: 3
              initialDelaySeconds: 10
              periodSeconds: 20
              timeoutSeconds: 3
              httpGet: {
                path: '/api/health'
                port: 3018
                scheme: 'HTTP'
              }
            }
            {
              type: 'Readiness'
              failureThreshold: 6
              periodSeconds: 10
              timeoutSeconds: 3
              httpGet: {
                path: '/api/health'
                port: 3018
                scheme: 'HTTP'
              }
            }
          ]
          resources: {
            cpu: json('2.0')
            memory: '4Gi'
          }
          volumeMounts: [
            {
              mountPath: '/data'
              volumeName: 'vestidor-data'
            }
          ]
        }
      ]
      scale: {
        maxReplicas: 1
        minReplicas: 1
        rules: [
          {
            name: 'http-concurrency'
            http: {
              metadata: {
                concurrentRequests: '50'
              }
            }
          }
        ]
      }
      volumes: [
        {
          name: 'vestidor-data'
          storageName: environmentStorageName
          storageType: 'AzureFile'
        }
      ]
    }
  }
}

output fqdn string = app.properties.configuration.ingress.fqdn
output url string = 'https://${app.properties.configuration.ingress.fqdn}'
