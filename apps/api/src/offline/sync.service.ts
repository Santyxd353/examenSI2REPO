import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { Prisma } from '@prisma/client';
import {
  ApiProblem,
  canonicalIntentJson,
  OfflineIntent,
  OperationReceipt,
  SyncBatchSchema,
  SyncOperationResult,
} from '@lumina/contracts';
import { Db } from '../db';
import { AuthRequest, AuthService } from '../auth';
import { TenantRegistry } from '../tenancy/platform';
import { currentTenant } from '../tenancy/context';
import { lockOperation } from '../commerce/idempotency';
import { DeviceKeysService } from './device-keys.service';
import { findReceipt, saveReceipt } from './receipts.repository';
import { inventoryHandler } from './inventory-handler';
import { catalogHandler } from './catalog-handler';

function problem(error: unknown, correlationId: string): ApiProblem {
  if (error instanceof HttpException) {
    const body = error.getResponse(),
      detail = (typeof body === 'object' ? body : {}) as Record<string, unknown>;
    const status = error.getStatus();
    const defaults: Record<number, string> = {
      400: 'VALIDATION_ERROR',
      401: 'AUTH_REQUIRED',
      402: 'SUBSCRIPTION_REQUIRED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'INVALID_OPERATION',
      503: 'SERVICE_UNAVAILABLE',
    };
    return {
      code:
        typeof detail.code === 'string' ? detail.code : defaults[status] || 'SERVICE_UNAVAILABLE',
      message: error.message,
      correlationId,
      retryable: status >= 500 || [401, 402, 403].includes(status) || detail.retryable === true,
      ...(detail.details && typeof detail.details === 'object'
        ? { details: detail.details as ApiProblem['details'] }
        : {}),
    };
  }
  return {
    code: 'SERVICE_UNAVAILABLE',
    message:
      'No se pudo confirmar la operación. Conserva la cola y reintenta con el mismo identificador.',
    correlationId,
    retryable: true,
  };
}
function ordered(ops: OfflineIntent[]) {
  const byId = new Map(ops.map((op) => [op.operationId, op]));
  if (byId.size !== ops.length)
    throw new BadRequestException('El lote contiene identificadores repetidos.');
  const active = new Set<string>(),
    visited = new Set<string>(),
    output: OfflineIntent[] = [];
  function visit(op: OfflineIntent) {
    if (active.has(op.operationId))
      throw new BadRequestException('El lote contiene dependencias cíclicas.');
    if (visited.has(op.operationId)) return;
    active.add(op.operationId);
    for (const id of op.dependsOn) {
      const parent = byId.get(id);
      if (parent) visit(parent);
    }
    active.delete(op.operationId);
    visited.add(op.operationId);
    output.push(op);
  }
  ops.forEach(visit);
  return output;
}
@Injectable()
export class SyncService {
  constructor(
    @Inject(Db) private db: Db,
    @Inject(AuthService) private auth: AuthService,
    @Inject(TenantRegistry) private registry: TenantRegistry,
    @Inject(DeviceKeysService) private devices: DeviceKeysService,
  ) {}
  async applyBatch(request: AuthRequest, raw: unknown) {
    const { operations } = SyncBatchSchema.parse(raw),
      tenant = currentTenant()!;
    const sequence = ordered(operations);
    for (const op of operations) {
      if (op.tenantId !== tenant.id || op.actorId !== request.user.id)
        throw new ForbiddenException('La operación pertenece a otra identidad o tienda.');
      const { payloadHash, ...unsigned } = op;
      if (createHash('sha256').update(canonicalIntentJson(unsigned)).digest('hex') !== payloadHash)
        throw new BadRequestException({
          code: 'INTENT_HASH_MISMATCH',
          message: 'La operación fue modificada después de crear su huella.',
        });
      // Preflight durable IDs before applying any other item in this batch.
      await this.db.$transaction((tx) =>
        findReceipt(tx, request.user, op.deviceId, op.operationId, op.payloadHash),
      );
    }
    const results = new Map<string, SyncOperationResult>();
    for (const op of sequence) {
      const correlationId = randomUUID(),
        receivedAt = new Date();
      try {
        const actor = await this.auth.verify(
          request.headers.authorization?.replace(/^Bearer /, ''),
        );
        await this.devices.registered(actor.id, op.deviceId);
        const replay = await this.db.$transaction((tx) =>
          findReceipt(tx, actor, op.deviceId, op.operationId, op.payloadHash),
        );
        if (replay) {
          results.set(op.operationId, { operationId: op.operationId, receipt: replay });
          continue;
        }
        const result = await this.registry.withWriteAccess(tenant, async () => {
          const fresh = await this.auth.verify(
            request.headers.authorization?.replace(/^Bearer /, ''),
          );
          return this.db.$transaction(
            async (tx) => {
              await lockOperation(tx, 'operation', op.operationId);
              const saved = await findReceipt(
                tx,
                fresh,
                op.deviceId,
                op.operationId,
                op.payloadHash,
              );
              if (saved) return { operationId: op.operationId, receipt: saved };
              const parents: OperationReceipt[] = [];
              for (const id of op.dependsOn) {
                let parent: OperationReceipt | null = null;
                try {
                  parent = await findReceipt(tx, fresh, op.deviceId, id);
                } catch (error) {
                  if (!(error instanceof NotFoundException)) throw error;
                }
                if (!parent || parent.status !== 'APPLIED')
                  return {
                    operationId: op.operationId,
                    blocked: {
                      code: 'DEPENDENCY_BLOCKED',
                      message: 'Espera o resuelve la operación previa antes de enviar esta.',
                      correlationId,
                      retryable: true,
                    },
                  };
                parents.push(parent);
              }
              let receipt: OperationReceipt;
              // Business changes and receipt commit together; domain failures cannot retain partial writes.
              await tx.$executeRawUnsafe('SAVEPOINT offline_mutation');
              try {
                const value =
                  op.kind === 'STOCK_DELTA' || op.kind === 'STOCK_COUNT'
                    ? await inventoryHandler(tx, fresh, op)
                    : await catalogHandler(tx, fresh, op, parents);
                receipt = {
                  tenantId: tenant.id,
                  actorId: actor.id,
                  operationId: op.operationId,
                  deviceId: op.deviceId,
                  payloadHash: op.payloadHash,
                  status: 'APPLIED',
                  entityId: op.entityId,
                  confirmedVersion: value.version,
                  result: value.result,
                  committedAt: new Date().toISOString(),
                  correlationId,
                };
                await tx.$executeRawUnsafe('RELEASE SAVEPOINT offline_mutation');
              } catch (error) {
                const detail = problem(error, correlationId);
                if (
                  !(error instanceof HttpException) ||
                  detail.retryable ||
                  detail.code === 'CAPACITY_EXCEEDED'
                )
                  throw error;
                await tx.$executeRawUnsafe('ROLLBACK TO SAVEPOINT offline_mutation');
                await tx.$executeRawUnsafe('RELEASE SAVEPOINT offline_mutation');
                receipt = {
                  tenantId: tenant.id,
                  actorId: actor.id,
                  operationId: op.operationId,
                  deviceId: op.deviceId,
                  payloadHash: op.payloadHash,
                  status: error.getStatus() === 409 ? 'CONFLICT' : 'REJECTED',
                  entityId: op.entityId,
                  confirmedVersion: null,
                  result: {
                    ...detail,
                    ...(op.kind.startsWith('STOCK_')
                      ? {
                          locationId: (op as Extract<OfflineIntent, { kind: 'STOCK_DELTA' }>)
                            .payload.locationId,
                        }
                      : {}),
                  },
                  committedAt: new Date().toISOString(),
                  correlationId,
                };
                await tx.auditoria.create({
                  data: {
                    actor_id: actor.id,
                    accion: 'OFFLINE_' + receipt.status,
                    entidad: 'operacion_sincronizacion',
                    entidad_id: op.operationId,
                    correlacion: correlationId,
                    cambios: { code: detail.code, kind: op.kind },
                    creado_en: new Date(),
                  },
                });
              }
              await saveReceipt(tx, op, receipt, receivedAt);
              return { operationId: op.operationId, receipt };
            },
            { timeout: 15000 },
          );
        });
        results.set(op.operationId, result);
      } catch (error) {
        const detail = problem(error, correlationId);
        if (detail.code === 'IDEMPOTENCY_PAYLOAD_MISMATCH') throw error;
        results.set(op.operationId, { operationId: op.operationId, blocked: detail });
      }
    }
    // Preserve original order so callers need not infer the server's topological scheduling.
    return { results: operations.map((op) => results.get(op.operationId)!) };
  }
}
