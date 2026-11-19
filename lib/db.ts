import { PrismaClient } from '@prisma/client';

// One client per process. In dev, hot reload re-evaluates modules, so the
// instance is parked on globalThis to avoid exhausting connections.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}
