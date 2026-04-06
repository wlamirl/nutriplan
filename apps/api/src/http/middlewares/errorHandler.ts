import { FastifyError, FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@nutriplan/shared';
import { DomainError } from '@nutriplan/domain';

export function errorHandler(
  error: FastifyError | Error,
  _request: FastifyRequest,
  reply: FastifyReply,
): void {
  // Erros de negócio → 422
  if (error instanceof DomainError) {
    reply.status(422).send({ error: error.message, code: 'DOMAIN_ERROR' });
    return;
  }

  // Erros de aplicação controlados → status definido no AppError
  if (error instanceof AppError) {
    reply.status(error.statusCode).send({ error: error.message, code: error.code });
    return;
  }

  // Erros de validação do Fastify (schema JSON nativo)
  if ('statusCode' in error && error.statusCode === 400) {
    reply.status(400).send({ error: error.message });
    return;
  }

  // Erros inesperados → 500 (sem stack trace em produção)
  reply.log.error({ err: error }, 'Unhandled error');
  const isProduction = process.env.NODE_ENV === 'production';
  reply.status(500).send({
    error: 'Erro interno do servidor',
    ...(isProduction ? {} : { details: error.message, stack: error.stack }),
  });
}
