import {
  Body,
  Controller,
  Post,
  Get,
  Req,
  Res,
  UseGuards,
  Injectable,
  Inject,
  CanActivate,
  ExecutionContext,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { hash, compare } from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash, randomBytes, randomUUID } from 'crypto';
import { z } from 'zod';
import { Db } from './db';
import { currentTenant, currentTenantSlug } from './tenancy/context';
const digest = (v: string) => createHash('sha256').update(v).digest('hex');
const correo = z.string().trim().toLowerCase().email().max(160);
const credentials = z
  .object({
    correo,
    clave: z
      .string()
      .min(10)
      .max(72)
      .refine(
        (value) => Buffer.byteLength(value, 'utf8') <= 72,
        'La contraseña supera el límite de 72 bytes; usa menos caracteres.',
      ),
  })
  .strict();
const registration = credentials
  .extend({
    nombres: z.string().trim().min(2).max(100),
    apellidos: z.string().trim().min(2).max(120),
  })
  .strict();
export type Identity = {
  id: string;
  nombres: string;
  apellidos: string;
  correo: string;
  roles: string[];
  permissions: string[];
  tenant?: { id: string; slug: string; name: string };
};
export type AuthRequest = Request & { user: Identity };
const cookieOptions = {
  httpOnly: true,
  sameSite: 'strict' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/api/auth',
  maxAge: 7 * 86400000,
};
const refreshCookieName = () =>
  currentTenantSlug() === 'lumina' ? 'refresh' : `refresh_${currentTenantSlug()}`;
@Injectable()
export class AuthService {
  constructor(@Inject(Db) private db: Db) {}
  async identity(id: string): Promise<Identity> {
    const u = await this.db.usuario.findFirst({ where: { id, estado: 'ACTIVO' } });
    if (!u) throw new UnauthorizedException('La sesión no está disponible.');
    const rows = await this.db.$queryRaw<
      { nombre: string; recurso: string | null; accion: string | null }[]
    >`
   SELECT r.nombre,p.recurso,p.accion FROM usuario_rol ur JOIN rol r ON r.id=ur.rol_id
   LEFT JOIN rol_permiso rp ON rp.rol_id=r.id LEFT JOIN permiso p ON p.id=rp.permiso_id WHERE ur.usuario_id=${id}::uuid`;
    return {
      id: u.id,
      nombres: u.nombres,
      apellidos: u.apellidos,
      correo: u.correo,
      tenant: {
        id: currentTenant()?.id || '00000000-0000-4000-8000-000000000018',
        slug: currentTenantSlug(),
        name: currentTenant()?.name || 'Lúmina',
      },
      roles: [...new Set(rows.map((r) => r.nombre))],
      permissions: [
        ...new Set(rows.filter((r) => r.recurso).map((r) => r.recurso + ':' + r.accion)),
      ],
    };
  }
  private makeRefresh(userId: string, sessionId: string) {
    return jwt.sign(
      { sid: sessionId, tenant: currentTenantSlug(), nonce: randomBytes(40).toString('hex') },
      process.env.JWT_SECRET!,
      {
        subject: userId,
        expiresIn: '7d',
        algorithm: 'HS256',
        issuer: 'vestidor18',
        audience: 'vestidor18-refresh',
      },
    );
  }
  private readRefresh(raw: string) {
    try {
      const payload = jwt.verify(raw, process.env.JWT_SECRET!, {
        algorithms: ['HS256'],
        issuer: 'vestidor18',
        audience: 'vestidor18-refresh',
      }) as jwt.JwtPayload;
      if ((payload.tenant || 'lumina') !== currentTenantSlug()) throw new Error();
      if (
        !z.string().uuid().safeParse(payload.sid).success ||
        !z.string().uuid().safeParse(payload.sub).success
      )
        throw new Error();
      return payload;
    } catch {
      throw new UnauthorizedException('La sesión venció.');
    }
  }
  private async tokenResponse(userId: string, sessionId: string, raw: string) {
    const user = await this.identity(userId);
    // The refresh hash also versions access tokens: rotation invalidates the prior access token.
    const token = jwt.sign(
      { sid: sessionId, tenant: currentTenantSlug(), sv: digest(raw) },
      process.env.JWT_SECRET!,
      {
        subject: userId,
        expiresIn: '15m',
        algorithm: 'HS256',
        issuer: 'vestidor18',
        audience: 'vestidor18',
      },
    );
    return { accessToken: token, user };
  }
  private async sessionResponse(userId: string, sessionId: string, raw: string, res: Response) {
    const response = await this.tokenResponse(userId, sessionId, raw);
    res.cookie(refreshCookieName(), raw, cookieOptions);
    return response;
  }
  async issue(id: string, res: Response) {
    const sessionId = randomUUID(),
      raw = this.makeRefresh(id, sessionId);
    await this.db.sesion.create({
      data: {
        id: sessionId,
        usuario_id: id,
        refresh_hash: digest(raw),
        creada_en: new Date(),
        vence_en: new Date(Date.now() + 7 * 86400000),
      },
    });
    return this.sessionResponse(id, sessionId, raw, res);
  }

  private async createClient(body: unknown) {
    const data = registration.parse(body);
    const encrypted = await hash(data.clave, 12);
    return this.db.$transaction(async (tx) => {
      const role = await tx.rol.findUniqueOrThrow({ where: { nombre: 'Cliente' } });
      const user = await tx.usuario.create({
        data: {
          nombres: data.nombres,
          apellidos: data.apellidos,
          correo: data.correo,
          clave_hash: encrypted,
          estado: 'ACTIVO',
          preferencias: { push: false },
          creado_en: new Date(),
        },
      });
      await tx.usuario_rol.create({
        data: { usuario_id: user.id, rol_id: role.id, asignado_en: new Date() },
      });
      return user;
    });
  }

  async register(body: unknown, res: Response) {
    const u = await this.createClient(body);
    return this.issue(u.id, res);
  }
  async login(body: unknown, res: Response) {
    const u = await this.authenticate(body);
    return this.issue(u.id, res);
  }
  private async authenticate(body: unknown) {
    const data = credentials.parse(body);
    const u = await this.db.usuario.findUnique({ where: { correo: data.correo } });
    if (!u || !(await compare(data.clave, u.clave_hash)) || u.estado !== 'ACTIVO')
      throw new UnauthorizedException('Correo o contraseña incorrectos.');
    return u;
  }
  private async mobileIssue(userId: string) {
    const sessionId = randomUUID(),
      raw = this.makeRefresh(userId, sessionId);
    await this.db.sesion.create({
      data: {
        id: sessionId,
        usuario_id: userId,
        refresh_hash: digest(raw),
        creada_en: new Date(),
        vence_en: new Date(Date.now() + 7 * 86400000),
      },
    });
    return { ...(await this.tokenResponse(userId, sessionId, raw)), refreshToken: raw };
  }

  async mobileRegister(body: unknown) {
    const u = await this.createClient(body);
    return this.mobileIssue(u.id);
  }

  async mobileLogin(body: unknown) {
    const u = await this.authenticate(body);
    return this.mobileIssue(u.id);
  }
  async refresh(raw: string | undefined, res: Response) {
    if (!raw) throw new UnauthorizedException('Inicia sesión para continuar.');
    const payload = this.readRefresh(raw);
    await this.identity(payload.sub!);
    const next = this.makeRefresh(payload.sub!, payload.sid);
    // Compare-and-swap on the SAME session row serializes rotation against logout.
    const changed = await this.db.sesion.updateMany({
      where: {
        id: payload.sid,
        usuario_id: payload.sub,
        refresh_hash: digest(raw),
        revocada_en: null,
        vence_en: { gt: new Date() },
      },
      data: { refresh_hash: digest(next), vence_en: new Date(Date.now() + 7 * 86400000) },
    });
    if (changed.count !== 1) throw new UnauthorizedException('La sesión ya se renovó o se cerró.');
    return this.sessionResponse(payload.sub!, payload.sid, next, res);
  }
  async mobileRefresh(body: unknown) {
    const { refreshToken } = z
      .object({ refreshToken: z.string().min(80) })
      .strict()
      .parse(body);
    const payload = this.readRefresh(refreshToken);
    await this.identity(payload.sub!);
    const next = this.makeRefresh(payload.sub!, payload.sid);
    const changed = await this.db.sesion.updateMany({
      where: {
        id: payload.sid,
        usuario_id: payload.sub,
        refresh_hash: digest(refreshToken),
        revocada_en: null,
        vence_en: { gt: new Date() },
      },
      data: { refresh_hash: digest(next), vence_en: new Date(Date.now() + 7 * 86400000) },
    });
    if (changed.count !== 1) throw new UnauthorizedException('La sesión ya se renovó o se cerró.');
    return { ...(await this.tokenResponse(payload.sub!, payload.sid, next)), refreshToken: next };
  }
  async logout(raw: string | undefined, res: Response) {
    if (raw) {
      let payload: jwt.JwtPayload | undefined;
      try {
        payload = this.readRefresh(raw);
      } catch {
        /* Expired or malformed cookie: clear it below. */
      }
      // A signed prior refresh token can revoke this session even after rotation.
      if (payload)
        await this.db.sesion.updateMany({
          where: { id: payload.sid, usuario_id: payload.sub, revocada_en: null },
          data: { revocada_en: new Date() },
        });
    }
    res.clearCookie(refreshCookieName(), cookieOptions);
    return { ok: true };
  }
  async mobileLogout(body: unknown) {
    const { refreshToken } = z
      .object({ refreshToken: z.string().min(80) })
      .strict()
      .parse(body);
    let payload: jwt.JwtPayload | undefined;
    try {
      payload = this.readRefresh(refreshToken);
    } catch {
      return { ok: true };
    }
    await this.db.sesion.updateMany({
      where: { id: payload.sid, usuario_id: payload.sub, revocada_en: null },
      data: { revocada_en: new Date() },
    });
    return { ok: true };
  }
  async verify(token: string | undefined) {
    try {
      if (!token) throw new Error();
      const payload = jwt.verify(token, process.env.JWT_SECRET!, {
        algorithms: ['HS256'],
        issuer: 'vestidor18',
        audience: 'vestidor18',
      }) as jwt.JwtPayload;
      if ((payload.tenant || 'lumina') !== currentTenantSlug()) throw new Error();
      const s = await this.db.sesion.findFirst({
        where: {
          id: payload.sid,
          usuario_id: payload.sub,
          revocada_en: null,
          vence_en: { gt: new Date() },
        },
      });
      if (!s || s.refresh_hash !== payload.sv) throw new Error();
      return this.identity(s.usuario_id);
    } catch {
      throw new UnauthorizedException('Inicia sesión para continuar.');
    }
  }
}
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(AuthService) private auth: AuthService) {}
  async canActivate(ctx: ExecutionContext) {
    const r = ctx.switchToHttp().getRequest<AuthRequest>();
    r.user = await this.auth.verify(r.headers.authorization?.replace(/^Bearer /, ''));
    return true;
  }
}
export function requirePermission(user: Identity, permission: string) {
  if (!user.permissions.includes(permission))
    throw new ForbiddenException('No tienes permiso para esta operación.');
}
@Controller('auth')
export class AuthController {
  constructor(@Inject(AuthService) private auth: AuthService) {}
  @Post('register') register(@Body() b: unknown, @Res({ passthrough: true }) r: Response) {
    return this.auth.register(b, r);
  }
  @Post('login') login(@Body() b: unknown, @Res({ passthrough: true }) r: Response) {
    return this.auth.login(b, r);
  }
  @Post('mobile/login') mobileLogin(@Body() b: unknown) {
    return this.auth.mobileLogin(b);
  }
  @Post('mobile/register') mobileRegister(@Body() b: unknown) {
    return this.auth.mobileRegister(b);
  }
  @Post('mobile/refresh') mobileRefresh(@Body() b: unknown) {
    return this.auth.mobileRefresh(b);
  }
  @Post('mobile/logout') mobileLogout(@Body() b: unknown) {
    return this.auth.mobileLogout(b);
  }
  @Post('refresh') refresh(@Req() r: Request, @Res({ passthrough: true }) s: Response) {
    return this.auth.refresh(r.cookies?.[refreshCookieName()], s);
  }
  @Post('logout') logout(@Req() r: Request, @Res({ passthrough: true }) s: Response) {
    return this.auth.logout(r.cookies?.[refreshCookieName()], s);
  }
  @Get('me') @UseGuards(AuthGuard) me(@Req() r: AuthRequest) {
    return r.user;
  }
}
