export type ApiProblemPayload = {
  code?: string;
  message?: string;
  correlationId?: string;
  retryable?: boolean;
};

function retryableStatus(status: number) {
  return status === 0 || status === 408 || status === 429 || status >= 500;
}

export class ApiProblem extends Error {
  readonly status: number;
  readonly code: string;
  readonly retryable: boolean;
  readonly correlationId?: string;

  constructor({ status, code, message, retryable, correlationId }: Required<Pick<ApiProblemPayload, 'code' | 'message'>> & Omit<ApiProblemPayload, 'code' | 'message'> & { status: number }) {
    super(message);
    this.name = 'ApiProblem';
    this.status = status;
    this.code = code;
    this.retryable = retryable ?? retryableStatus(status);
    this.correlationId = correlationId;
  }

  static fromHttp(status: number, payload: ApiProblemPayload = {}): ApiProblem {
    const defaults: Record<number, string> = {
      401: 'AUTH_REQUIRED',
      402: 'SUBSCRIPTION_REQUIRED',
      403: 'FORBIDDEN',
      409: 'CONFLICT',
      422: 'VALIDATION_FAILED',
    };
    return new ApiProblem({
      status,
      code: payload.code || defaults[status] || 'HTTP_ERROR',
      message: payload.message || 'No se pudo completar la solicitud.',
      retryable: payload.retryable ?? retryableStatus(status),
      correlationId: payload.correlationId,
    });
  }

  static network(cause?: unknown): ApiProblem {
    const timeout = cause instanceof Error && cause.name === 'AbortError';
    return new ApiProblem({
      status: 0,
      code: timeout ? 'NETWORK_TIMEOUT' : 'NETWORK_UNAVAILABLE',
      message: timeout ? 'La solicitud tardó demasiado. Intenta nuevamente.' : 'No hay conexión con el servidor.',
      retryable: true,
    });
  }

  static isNetwork(problem: unknown): problem is ApiProblem {
    return problem instanceof ApiProblem && problem.status === 0;
  }
}
