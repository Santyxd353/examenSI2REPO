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
import { FittingController } from './fitting';
import { AvatarJobs } from './avatar-jobs';
import { LocationsController, StaffController } from './locations';
import { AnalyticsController, CommercialAnalytics, ReportsController } from './reports';
import { SalesController } from './sales';
import { CommerceController } from './commerce';
import { ProfileController } from './profile';
import { OrdersController } from './orders';
import { RealtimeGateway } from './realtime';
import { ApiErrors } from './errors';
import { storedPath, ensureStorage } from './storage';
import { TenantRegistry, TenantController, PlatformController } from './tenancy/platform';
import { OfflineKeyController, OfflineKeyService } from './offline-keys';
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
    AuthController,
    CatalogController,
    AvatarsController,
    FittingController,
    LocationsController,
    StaffController,
    ReportsController,
    AnalyticsController,
    SalesController,
    CommerceController,
    ProfileController,
    OrdersController,
    TenantController,
    PlatformController,
    OfflineKeyController,
  ],
  providers: [
    Db,
    AuthService,
    AuthGuard,
    AvatarJobs,
    CommercialAnalytics,
    RealtimeGateway,
    TenantRegistry,
    OfflineKeyService,
  ],
})
class AppModule {}
export async function createApp() {
  if (!process.env.JWT_SECRET || process.env.JWT_SECRET.length < 48)
    throw new Error('Configura JWT_SECRET con al menos 48 caracteres aleatorios.');
  const app = await NestFactory.create(AppModule, { logger: false });
  const registry = app.get(TenantRegistry);
  await registry.initialize();
  if (process.env.TRUST_PROXY === '1') app.getHttpAdapter().getInstance().set('trust proxy', 1);
  const origin = process.env.WEB_ORIGIN || 'http://localhost:5173';
  const allowedOrigins = [origin, origin.replace('localhost', '127.0.0.1')];
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
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
      const pathStore = req.path.match(/^\/stores\/([^/]+)\/assets(?:\/|$)/i)?.[1];
      const requested = req.headers['x-tenant-slug'];
      if (requested !== undefined && typeof requested !== 'string')
        throw new HttpException('Selecciona una tienda válida.', 400);
      if (pathStore && requested && pathStore !== requested)
        throw new HttpException('La imagen no pertenece a la tienda seleccionada.', 400);
      const tenant = await registry.resolve(pathStore || requested || 'lumina');
      const readOnlyQuery = req.method === 'POST' && /^\/api\/analytics\/query\/?$/i.test(req.path);
      if (
        tenant.readOnly &&
        !readOnlyQuery &&
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
  app.setGlobalPrefix('api');
  await app.init();
  return app;
}
