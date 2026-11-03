import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import { ZodError } from 'zod';
import { Prisma } from '@prisma/client';
import { MulterError } from 'multer';
import { randomUUID } from 'crypto';
@Catch()
export class ApiErrors implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse();
    if (error instanceof ZodError)
      return res.status(400).json({
        message: 'Revisa los campos del formulario.',
        errors: error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      });
    if (error instanceof MulterError)
      return res.status(400).json({
        message:
          'El archivo supera el límite permitido o el formulario contiene archivos adicionales.',
      });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return res.status(409).json({ message: 'Ya existe un registro con esos datos.' });
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034')
      return res.status(409).json({
        message:
          'El inventario cambió durante la compra. Actualiza el carrito e intenta nuevamente.',
      });
    if (error instanceof HttpException) {
      const body = error.getResponse();
      const detail =
        typeof body === 'object' && body !== null ? (body as Record<string, unknown>) : {};
      const status = error.getStatus();
      const defaultCode: Record<number, string> = {
        400: 'VALIDATION_ERROR',
        401: 'AUTH_REQUIRED',
        402: 'SUBSCRIPTION_REQUIRED',
        403: 'FORBIDDEN',
        404: 'NOT_FOUND',
        409: 'CONFLICT',
        422: 'INVALID_OPERATION',
        503: 'SERVICE_UNAVAILABLE',
      };
      return res
        .status(status)
        .json({
          message: error.message,
          code:
            typeof detail.code === 'string' ? detail.code : defaultCode[status] || 'REQUEST_FAILED',
          retryable: detail.retryable === true || status === 503,
          correlationId: randomUUID(),
          ...(detail.details && typeof detail.details === 'object'
            ? { details: detail.details }
            : {}),
        });
    }
    console.error('Error de operación:', error instanceof Error ? error.name : 'desconocido');
    return res.status(500).json({ message: 'No se pudo completar la operación.' });
  }
}
