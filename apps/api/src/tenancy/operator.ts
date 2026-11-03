import {
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Get,
  Inject,
  Injectable,
  Post,
  Query,
  ServiceUnavailableException,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { compare } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { TenantRegistry } from './platform';
import { provisionTenant } from './provision';

const input = z.strictObject({
  username: z.string().min(1).max(100),
  password: z
    .string()
    .min(10)
    .max(72)
    .refine((value) => Buffer.byteLength(value, 'utf8') <= 72),
});
function signingKey(): string {
  const key = process.env.PLATFORM_OPERATOR_JWT_SECRET;
  if (!key || key.length < 48)
    throw new ServiceUnavailableException('El acceso de plataforma todavía no está configurado.');
  return key;
}
@Injectable()
export class PlatformOperatorService {
  constructor(@Inject(TenantRegistry) private readonly registry: TenantRegistry) {}
  async login(raw: unknown) {
    const data = input.parse(raw),
      key = signingKey();
    const username = process.env.PLATFORM_OPERATOR_USERNAME,
      hash = process.env.PLATFORM_OPERATOR_PASSWORD_HASH;
    if (!username || !hash || !/^\$2[aby]\$\d\d\$[./A-Za-z0-9]{53}$/.test(hash))
      throw new ServiceUnavailableException('El acceso de plataforma todavía no está configurado.');
    const valid = await compare(data.password, hash);
    if (!valid || data.username !== username)
      throw new UnauthorizedException('Usuario o contraseña incorrectos.');
    return {
      scope: 'PLATFORM_OPERATOR',
      expiresIn: 900,
      accessToken: jwt.sign({ scope: 'PLATFORM_OPERATOR' }, key, {
        subject: username,
        issuer: 'lumina-platform',
        audience: 'lumina-control',
        algorithm: 'HS256',
        expiresIn: '15m',
      }),
    };
  }
  verify(token: string | undefined) {
    if (!token) throw new UnauthorizedException('Inicia sesión en el acceso de plataforma.');
    const key = signingKey();
    try {
      const payload = jwt.verify(token, key, {
        algorithms: ['HS256'],
        issuer: 'lumina-platform',
        audience: 'lumina-control',
      }) as jwt.JwtPayload;
      if (
        payload.scope !== 'PLATFORM_OPERATOR' ||
        payload.sub !== process.env.PLATFORM_OPERATOR_USERNAME ||
        !payload.exp
      )
        throw new Error('Invalid platform scope.');
      return { username: payload.sub };
    } catch {
      throw new UnauthorizedException('La sesión de plataforma no es válida o venció.');
    }
  }
  async list(offsetRaw: string) {
    const offset = z.coerce.number().int().min(0).max(1000000).parse(offsetRaw);
    const rows = (
      await this.registry.pool.query(
        `SELECT t.id,t.slug,t.name,t.state,t.created_at,
      s.plan_code,s.status,s.trial_ends_at,s.current_period_end FROM platform.tenant t
      LEFT JOIN platform.subscription s ON s.tenant_id=t.id ORDER BY t.created_at DESC,t.id LIMIT 51 OFFSET $1`,
        [offset],
      )
    ).rows;
    return {
      tenants: rows
        .slice(0, 50)
        .map((row) => ({
          id: row.id,
          slug: row.slug,
          name: row.name,
          state: row.state,
          createdAt: row.created_at,
          planCode: row.plan_code,
          status: row.status,
          trialEndsAt: row.trial_ends_at,
          paidThrough: row.current_period_end,
        })),
      hasMore: rows.length > 50,
      nextOffset: rows.length > 50 ? offset + 50 : null,
    };
  }
  async create(raw: unknown) {
    const tenant = await provisionTenant(raw, this.registry);
    return {
      tenant: {
        id: tenant.id,
        slug: tenant.slug,
        name: tenant.name,
        state: tenant.state,
        planCode: tenant.subscription?.plan,
        status: tenant.subscription?.status,
        trialEndsAt: tenant.subscription?.trialEnd,
      },
      webPath: `/?tienda=${tenant.slug}`,
    };
  }
}
@Injectable()
export class PlatformOperatorGuard implements CanActivate {
  constructor(
    @Inject(PlatformOperatorService) private readonly operator: PlatformOperatorService,
  ) {}
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    request.platformOperator = this.operator.verify(
      request.headers.authorization?.replace(/^Bearer /, ''),
    );
    return true;
  }
}
@Controller('platform/operator')
export class PlatformOperatorController {
  constructor(
    @Inject(PlatformOperatorService) private readonly operator: PlatformOperatorService,
  ) {}
  @Post('login') login(@Body() raw: unknown) {
    return this.operator.login(raw);
  }
  @Get('tenants')
  @UseGuards(PlatformOperatorGuard)
  list(@Query('offset') offset = '0') {
    return this.operator.list(offset);
  }
  @Post('tenants')
  @UseGuards(PlatformOperatorGuard)
  create(@Body() raw: unknown) {
    return this.operator.create(raw);
  }
}
