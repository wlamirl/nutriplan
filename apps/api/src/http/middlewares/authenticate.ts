import { FastifyRequest, FastifyReply } from 'fastify';
import { AppError } from '@nutriplan/shared';

// ─── JWT payload type ─────────────────────────────────────────────────────────

export interface JwtPayload {
  sub: string;               // user id
  role: 'nutritionist' | 'admin' | 'patient';
  email: string;
}

// Augment @fastify/jwt so request.user is typed throughout the app
declare module '@fastify/jwt' {
  interface FastifyJWT {
    payload: JwtPayload;
    user: JwtPayload;
  }
}

// ─── Middleware ───────────────────────────────────────────────────────────────

export async function authenticate(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  try {
    await request.jwtVerify();
  } catch {
    const err = AppError.unauthorized();
    reply.status(err.statusCode).send({ error: err.message, code: err.code });
  }
}

export async function requireAdmin(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  await authenticate(request, reply);
  if (request.user.role !== 'admin') {
    const err = AppError.forbidden();
    reply.status(err.statusCode).send({ error: err.message, code: err.code });
  }
}
