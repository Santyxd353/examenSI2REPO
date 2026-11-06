import 'reflect-metadata';
import { Module, Controller, Get } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import express from 'express';
import { resolve } from 'path';
import { rateLimit } from 'express-rate-limit';
import { Db } from './db';
import { AuthController, AuthService, AuthGuard } from './auth';
import { CatalogController } from './catalog';
import { AvatarsController } from './avatars';
import { isAvatarPrivacyDeletion } from './avatars/lifecycle';
import { FittingController } from './fitting';
import { AvatarJobs } from './avatar-jobs';
import { OfflineController } from './offline/offline.controller';
import { DeviceKeysService } from './offline/device-keys.service';
import { SyncService } from './offline/sync.service';
import { SnapshotService } from './offline/snapshot.service';
import { OutfitsService } from './offline/outfits.service';
import { OfflineMaintenance } from './offline/offline-maintenance';
import { ResourcesService } from './offline/resources.service';
import { ResourcesController, OfflineMediaController } from './offline/resources.controller';
import { LocationsController, StaffController } from './locations';
import { AnalyticsController, CommercialAnalytics, ReportsController } from './reports';
import { ReportDefinitionsController } from './reporting/definitions.controller';
import { ReportDefinitionsService } from './reporting/definitions.service';
import { ReportController } from './reporting/report.controller';
import { ReportDatasetService } from './reporting/dataset.service';
import { SalesController } from './sales';
import { CommerceController } from './commerce';
import { ProfileController } from './profile';
import { OrdersController } from './orders';
import { RealtimeGateway } from './realtime';
import { ApiErrors } from './errors';
import { EntitlementsController, EntitlementsService } from './billing/entitlements.service';
import { QuotaService } from './billing/quota.service';
import { SubscriptionService } from './billing/subscription.service';
import { SubscriptionController } from './billing/subscription.controller';
import { StripeAdapter } from './billing/stripe.adapter';
import { BillingWebhookController } from './billing/webhook.controller';
import {
  PlatformOperatorController,
  PlatformOperatorService,
  PlatformOperatorGuard,
} from './tenancy/operator';
import { PlanWriteInterceptor } from './billing/access.interceptor';
import { storedPath, ensureStorage } from './storage';
import { TenantRegistry, TenantController, PlatformController } from './tenancy/platform';
import { runForTenant } from './tenancy/context';
import { HttpException } from '@nestjs/common';
@Controller('health')
class HealthController {
  @Get() health() {
    return { status: 'ok' };
  }
}
@Module({
  controllers: [
    HealthController,
    OfflineController,
    ResourcesController,
    OfflineMediaController,
    AuthController,
    CatalogController,
    AvatarsController,
    FittingController,
    LocationsController,
    StaffController,
    ReportsController,
    ReportDefinitionsController,
    ReportController,
    AnalyticsController,
    SalesController,
    CommerceController,
    ProfileController,
    OrdersController,
    TenantController,
    PlatformController,
    EntitlementsController,
    SubscriptionController,
    BillingWebhookController,
    PlatformOperatorController,
  ],
  providers: [
    Db,
    AuthService,
    AuthGuard,
    AvatarJobs,
    DeviceKeysService,
    SyncService,
    SnapshotService,
    OutfitsService,
    OfflineMaintenance,
    ResourcesService,
    CommercialAnalytics,
    ReportDefinitionsService,
    ReportDatasetService,
    RealtimeGateway,
    TenantRegistry,
    EntitlementsService,
    QuotaService,
    SubscriptionService,
    StripeAdapter,
    PlatformOperatorService,
    PlatformOperatorGuard,
    PlanWriteInterceptor,
  ],
})
class AppModule {}
export async function createApp() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 48)
    throw new Error('Configura JWT_SECRET con al menos 48 caracteres aleatorios.');
  const app = await NestFactory.create(AppModule, { logger: false, rawBody: true });
  const registry = app.get(TenantRegistry);
  await registry.initialize();
  if (process.env.TRUST_PROXY === '1') app.getHttpAdapter().getInstance().set('trust proxy', 1);
  const origin = process.env.WEB_ORIGIN || 'http://localhost:5173';
  const allowedOrigins = [origin, origin.replace('localhost', '127.0.0.1')];
  app.use(
    helmet({
      crossOriginResourcePolicy: { policy: 'same-site' },
      // Authenticated models become local Blob URLs before Three.js loads them.
      contentSecurityPolicy: { directives: { connectSrc: ["'self'", 'blob:'] } },
    }),
  );
  app.use(cookieParser());
  const webRoot =
    process.env.SERVE_WEB === 'true' ? resolve(process.env.WEB_ROOT || 'dist/web') : null;
  if (webRoot) {
    const sharedWeb = express.static(webRoot, { dotfiles: 'deny', index: 'index.html' });
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (/^\/(api|stores)(\/|$)/i.test(req.path)) return next();
      return sharedWeb(req, res, next);
    });
  }
  app.use(async (req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (/^\/api\/health\/?$/i.test(req.path)) return next();
    if (req.method === 'POST' && /^\/api\/billing\/stripe\/webhook\/?$/i.test(req.path))
      return next();
    if (/^\/api\/platform\/operator\/(login|tenants)\/?$/i.test(req.path)) return next();
    if (
      ['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      /^\/api\/platform\/stores\/?$/i.test(req.path)
    )
      return next();
    if (
      !/^\/(api|assets)(\/|$)/i.test(req.path) &&
      !/^\/stores\/[^/]+\/assets(\/|$)/i.test(req.path)
    )
      return next();
    try {
      const mediaStore = /^\/api\/catalog\/offline-media\/[^/]+\/?$/i.test(req.path)
        ? req.query.store
        : undefined;
      if (mediaStore !== undefined && typeof mediaStore !== 'string')
        throw new HttpException('Selecciona una tienda válida.', 400);
      const pathStore = req.path.match(/^\/stores\/([^/]+)\/assets(?:\/|$)/i)?.[1] ?? mediaStore;
      const requested = req.headers['x-tenant-slug'];
      if (requested !== undefined && typeof requested !== 'string')
        throw new HttpException('Selecciona una tienda válida.', 400);
      if (pathStore && requested && pathStore !== requested)
        throw new HttpException('La imagen no pertenece a la tienda seleccionada.', 400);
      const tenant = await registry.resolve(pathStore || requested || 'lumina');
      const readOnlyQuery =
        req.method === 'POST' &&
        /^\/api\/(?:analytics\/query|reports\/(?:datasets|execute|export)|offline\/(?:sync|bootstrap|outfits))\/?$/i.test(
          req.path,
        );
      if (
        tenant.readOnly &&
        !readOnlyQuery &&
        !isAvatarPrivacyDeletion(req.method, req.path) &&
        !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
        !req.path.startsWith('/api/auth/') &&
        !req.path.startsWith('/api/tenant/subscription')
      )
        throw new HttpException('Renueva la suscripción para guardar cambios en esta tienda.', 402);
      runForTenant(tenant, next);
    } catch (error) {
      const status = error instanceof HttpException ? error.getStatus() : 503;
      res.status(status).json({
        message:
          error instanceof HttpException
            ? error.message
            : 'El espacio de la tienda no está disponible.',
      });
    }
  });
  app.enableCors({ origin: allowedOrigins, credentials: true });
  app.use(
    '/api/platform/operator/login',
    rateLimit({
      windowMs: 15 * 60000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: 'Demasiados intentos. Espera antes de volver a iniciar sesión.' },
    }),
  );
  app.use(
    '/api/auth',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 80,
      standardHeaders: true,
      legacyHeaders: false,
      message: { message: 'Demasiados intentos. Espera unos minutos antes de continuar.' },
    }),
  );
  app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (
      !['GET', 'HEAD', 'OPTIONS'].includes(req.method) &&
      req.headers.origin &&
      !allowedOrigins.includes(req.headers.origin)
    )
      return res.status(403).json({ message: 'Origen no autorizado.' });
    next();
  });
  await ensureStorage();
  const assets = (req: express.Request, res: express.Response, next: express.NextFunction) =>
    express.static(storedPath('public'), { dotfiles: 'deny', index: false })(req, res, next);
  app.use('/assets', assets);
  app.use('/stores/:slug/assets', assets);
  if (webRoot) {
    app.use((req: express.Request, res: express.Response, next: express.NextFunction) => {
      if (
        !['GET', 'HEAD'].includes(req.method) ||
        /^\/(api|assets|socket\.io)(\/|$)/i.test(req.path) ||
        /^\/stores\/[^/]+\/assets(?:\/|$)/i.test(req.path)
      )
        return next();
      return res.sendFile('index.html', { root: webRoot });
    });
  }
  app.useGlobalFilters(new ApiErrors());
  app.useGlobalInterceptors(app.get(PlanWriteInterceptor));
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}
