import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

/** No local database fallback: missing production configuration must fail. */
export function resolveDatabaseUrl(): string {
  const url = process.env.DATABASE_URL?.trim();
  if (!url || !/^postgres(ql)?:\/\//.test(url)) {
    throw new Error("DATABASE_URL must be a PostgreSQL connection string");
  }
  return url;
}

const globalForPrisma = globalThis as unknown as { __phcPrisma?: PrismaClient };
function createPrismaClient() {
  // Keep per-function pools small; use the managed provider's pooled URL on Vercel.
  const adapter = new PrismaPg({ connectionString: resolveDatabaseUrl(), max: 3, connectionTimeoutMillis: 10000 });
  return new PrismaClient({ adapter, log: ["error"] });
}
export const prisma = globalForPrisma.__phcPrisma ?? createPrismaClient();
if (process.env.NODE_ENV !== "production") globalForPrisma.__phcPrisma = prisma;
export type { PrismaClient };
