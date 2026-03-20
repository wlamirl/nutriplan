// Configuração de conexão para BullMQ (ioredis connection options)
// BullMQ gerencia internamente a instância ioredis com estas opções.
export const redis = {
  host: process.env.REDIS_HOST ?? 'localhost',
  port: Number(process.env.REDIS_PORT ?? 6379),
  ...(process.env.REDIS_PASSWORD ? { password: process.env.REDIS_PASSWORD } : {}),
};
