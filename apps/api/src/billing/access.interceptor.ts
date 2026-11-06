import { CallHandler, ExecutionContext, Inject, Injectable, NestInterceptor } from '@nestjs/common';
import { defer, firstValueFrom } from 'rxjs';
import { AuthRequest, AuthService } from '../auth';
import { currentTenant } from '../tenancy/context';
import { TenantRegistry } from '../tenancy/platform';
import { isAvatarPrivacyDeletion } from '../avatars/lifecycle';

// These handlers take their own short write lease, or are authorized read operations.
const independentlyGated =
  /^\/api\/(?:analytics\/query|reports\/(?:execute|datasets|export|interpret|transcribe)|offline\/(?:sync|bootstrap|outfits)|tenant\/subscription\/(?:checkout|cancel-renewal|qr\/[^/]+\/confirm))\/?$/i;
@Injectable()
export class PlanWriteInterceptor implements NestInterceptor {
  constructor(
    @Inject(TenantRegistry) private readonly registry: TenantRegistry,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}
  intercept(context: ExecutionContext, next: CallHandler) {
    const request = context.switchToHttp().getRequest<AuthRequest>();
    const tenant = currentTenant();
    if (
      !request.user ||
      !tenant ||
      ['GET', 'HEAD', 'OPTIONS'].includes(request.method) ||
      independentlyGated.test(request.path) ||
      isAvatarPrivacyDeletion(request.method, request.path) ||
      /^multipart\/form-data/i.test(request.headers['content-type'] || '')
    )
      return next.handle();
    return defer(() =>
      this.registry.withWriteAccess(tenant, async () => {
        request.user = await this.auth.verify(
          request.headers.authorization?.replace(/^Bearer /, ''),
        );
        return firstValueFrom(next.handle());
      }),
    );
  }
}
