export class AppError extends Error {
  constructor(
    public override readonly message: string,
    public readonly statusCode: number,
    public readonly code?: string,
  ) {
    super(message);
    this.name = 'AppError';
    Object.setPrototypeOf(this, new.target.prototype);
  }

  static badRequest(message: string, code?: string): AppError {
    return new AppError(message, 400, code);
  }

  static unauthorized(message = 'Não autorizado'): AppError {
    return new AppError(message, 401, 'UNAUTHORIZED');
  }

  static forbidden(message = 'Acesso negado'): AppError {
    return new AppError(message, 403, 'FORBIDDEN');
  }

  static notFound(resource: string): AppError {
    return new AppError(`${resource} não encontrado`, 404, 'NOT_FOUND');
  }

  static internal(message = 'Erro interno do servidor'): AppError {
    return new AppError(message, 500, 'INTERNAL_ERROR');
  }
}
