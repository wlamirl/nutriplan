/**
 * apps/gateway/src/main.ts
 *
 * API Gateway — ponto de entrada único para web e mobile.
 *
 * Responsabilidades:
 *   - Verificação de JWT (exceto /auth e /health)
 *   - Injeção de headers de contexto para serviços internos (X-User-Id, X-User-Role)
 *   - CORS configurado para o front-end web
 *   - Rate limiting global + stricter para geração de dietas (IA)
 *   - Proxy reverso para os serviços internos
 *
 * Topologia (atual — monolito):
 *   gateway:8080 → api:3000 (apps/api)
 *
 * Topologia futura (após split de serviços):
 *   /auth, /patients, /consultations → api-patients:3001
 *   /diet-plans                      → api-diets:3002
 *   /foods, /admin/sync              → api-foods:3003
 *
 * Web    → GATEWAY_URL (CORS obrigatório)
 * Mobile → GATEWAY_URL (CORS não obrigatório, mas compartilha a mesma URL)
 */

import { config } from 'dotenv';
import { resolve } from 'path';
config({ path: resolve(__dirname, '../../../.env') });

import Fastify, { FastifyRequest, FastifyReply } from 'fastify';
import helmet    from '@fastify/helmet';
import cors      from '@fastify/cors';
import jwt       from '@fastify/jwt';
import rateLimit from '@fastify/rate-limit';
import proxy     from '@fastify/http-proxy';
import Redis     from 'ioredis';
import type { IncomingHttpHeaders } from 'http';

// O @fastify/jwt declara req.user como string | object | Buffer.
// Usamos uma interface auxiliar + type assertion para acessar os campos.
interface JwtUser {
  id:    string;
  email: string;
  role:  string;
}

function jwtUser(req: FastifyRequest): JwtUser | undefined {
  return req.user as JwtUser | undefined;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Variável de ambiente obrigatória não definida: ${name}`);
  return value;
}

function parsedOrigins(): string[] | boolean {
  const raw = process.env['CORS_ORIGINS'];
  if (!raw) return process.env['NODE_ENV'] !== 'production';
  return raw.split(',').map((o: string) => o.trim());
}

function buildUserHeaders(req: FastifyRequest): IncomingHttpHeaders {
  const user = jwtUser(req);
  if (!user?.id) return {};
  return {
    'x-user-id':   user.id,
    'x-user-role': user.role ?? '',
    // Marca a origem como gateway interno — serviços podem rejeitar chamadas externas
    'x-gateway':   '1',
  };
}

// ─── Bootstrap ────────────────────────────────────────────────────────────────

async function bootstrap(): Promise<void> {
  const JWT_SECRET = requireEnv('JWT_SECRET');
  const API_URL    = process.env['API_URL'] ?? 'http://localhost:3000';
  // Futuramente, variáveis individuais por serviço:
  // const PATIENTS_SERVICE_URL = process.env['PATIENTS_SERVICE_URL'] ?? 'http://localhost:3001';
  // const DIETS_SERVICE_URL    = process.env['DIETS_SERVICE_URL']    ?? 'http://localhost:3002';
  // const FOODS_SERVICE_URL    = process.env['FOODS_SERVICE_URL']    ?? 'http://localhost:3003';

  const AI_GEN_MAX    = parseInt(process.env['AI_RATE_LIMIT_MAX']    ?? '10', 10);
  const AI_GEN_WINDOW = parseInt(process.env['AI_RATE_LIMIT_WINDOW'] ?? '60', 10); // segundos

  // ─── Redis (rate limiting distribuído) ──────────────────────────────────────
  const redis = new Redis({
    host:               process.env['REDIS_HOST']     ?? 'localhost',
    port:               Number(process.env['REDIS_PORT'] ?? 6379),
    password:           process.env['REDIS_PASSWORD'] ?? undefined,
    lazyConnect:        true,
    enableOfflineQueue: false,
  });

  // ─── Fastify ────────────────────────────────────────────────────────────────
  const app = Fastify({
    logger: {
      transport:
        process.env['NODE_ENV'] === 'development'
          ? { target: 'pino-pretty', options: { colorize: true } }
          : undefined,
    },
    // Confia em X-Forwarded-For quando atrás de load balancer
    trustProxy: process.env['NODE_ENV'] === 'production',
  });

  redis.on('error', (err: Error) => {
    app.log.warn({ err }, '[gateway] Redis indisponível — rate-limit em memória');
  });

  await redis.connect().catch(() => { /* tolera falha de conexão — veja handler acima */ });

  // ─── Plugins de segurança ────────────────────────────────────────────────────
  await app.register(helmet, {
    // CSP gerenciado pelo front-end; gateway entrega apenas headers base
    contentSecurityPolicy: false,
  });

  // CORS: necessário para o front-end web (React SPA no browser).
  // React Native não usa browser, mas compartilhar a mesma URL é seguro.
  await app.register(cors, {
    origin:           parsedOrigins(),
    methods:          ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders:   ['Content-Type', 'Authorization'],
    credentials:      true,
    // preflight: false evita que @fastify/cors registre OPTIONS /* globalmente,
    // que conflitaria com o @fastify/http-proxy. Os headers CORS ainda são
    // adicionados via hooks em todas as respostas, inclusive em preflight proxiado.
    preflight:        false,
    strictPreflight:  false,
  });

  // ─── JWT ─────────────────────────────────────────────────────────────────────
  await app.register(jwt, { secret: JWT_SECRET });

  // ─── Rate Limiting global (120 req/min por usuário ou IP) ────────────────────
  await app.register(rateLimit, {
    global:     true,
    max:        120,
    timeWindow: '1 minute',
    redis,
    // Usa ID do usuário autenticado — mais justo que IP para mobile (IPs compartilhados)
    keyGenerator: (req: FastifyRequest) => jwtUser(req)?.id ?? req.ip,
    errorResponseBuilder: (_req: FastifyRequest, context: { max: number; ttl: number }) => ({
      error:      'Too Many Requests',
      message:    `Limite de ${context.max} requisições por minuto atingido.`,
      retryAfter: Math.ceil(context.ttl / 1000),
    }),
  });

  // ─── Hook de autenticação global ─────────────────────────────────────────────
  // Rotas públicas: /health, /auth/* e preflight CORS (OPTIONS)
  const PUBLIC_PREFIXES = ['/health', '/auth', '/v1/auth'];

  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.method === 'OPTIONS') return;
    if (PUBLIC_PREFIXES.some((p) => req.url.startsWith(p))) return;
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: 'Token inválido ou expirado.' });
    }
  });

  // ─── Rate limit específico: geração de dietas via IA ─────────────────────────
  // Chamada cara (créditos Anthropic) — limite independente do rate limit global.
  app.addHook('onRequest', async (req: FastifyRequest, reply: FastifyReply) => {
    const isAiGenerate =
      req.method === 'POST' &&
      (req.url === '/diet-plans' || req.url === '/v1/diet-plans' ||
       req.url.endsWith('/generate'));

    if (!isAiGenerate) return;

    const key = `rl:ai-generate:${jwtUser(req)?.id ?? req.ip}`;
    try {
      const count = await redis.incr(key);
      if (count === 1) await redis.expire(key, AI_GEN_WINDOW);
      if (count > AI_GEN_MAX) {
        reply.code(429).send({
          error:      'Limite de geração de dietas atingido.',
          message:    `Máximo de ${AI_GEN_MAX} gerações por minuto. Tente novamente em breve.`,
          retryAfter: AI_GEN_WINDOW,
        });
      }
    } catch {
      // Redis indisponível — fail-open (não bloqueia a requisição)
    }
  });

  // ─── Health check (não proxiado — resposta do próprio gateway) ───────────────
  app.get('/health', async () => ({
    status:    'ok',
    service:   'gateway',
    timestamp: new Date().toISOString(),
  }));

  // ─── Proxy reverso ────────────────────────────────────────────────────────────
  // Upstream único (fase atual — monolito).
  // Ao separar serviços: criar 3 registros com prefix /auth+/patients, /diet-plans, /foods.
  await app.register(proxy, {
    upstream:      API_URL,
    rewritePrefix: '',
    replyOptions: {
      // Injeta contexto do usuário autenticado como headers internos.
      // Serviços downstream confiam em x-user-id / x-user-role sem re-verificar JWT.
      // `req` é inferido como o tipo mais amplo de @fastify/http-proxy (HTTP/1 + HTTP/2);
      // fazemos o cast para FastifyRequest (HTTP/1) — seguro porque o gateway usa HTTP/1.
      rewriteRequestHeaders(req, headers: IncomingHttpHeaders): IncomingHttpHeaders {
        return { ...headers, ...buildUserHeaders(req as FastifyRequest) };
      },
    },
  });

  // ─── Graceful shutdown ────────────────────────────────────────────────────────
  const signals = ['SIGINT', 'SIGTERM'] as const;
  for (const signal of signals) {
    process.on(signal, () => {
      app.close()
        .then(() => redis.quit())
        .then(() => process.exit(0))
        .catch(() => process.exit(1));
    });
  }

  // ─── Start ────────────────────────────────────────────────────────────────────
  const port = Number(process.env['GATEWAY_PORT'] ?? 8080);
  await app.listen({ port, host: '0.0.0.0' });
}

bootstrap().catch((err: unknown) => {
  console.error('Falha ao iniciar o gateway:', err);
  process.exit(1);
});
