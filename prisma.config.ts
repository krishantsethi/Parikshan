import path from "node:path";
import { defineConfig } from "prisma/config";

try { process.loadEnvFile?.(path.join(process.cwd(), ".env")); } catch { /* Environment may be injected. */ }

export default defineConfig({
  schema: path.join("prisma", "schema.prisma"),
  engine: "js",
  experimental: { adapter: true },
  adapter: async () => {
    const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
    if (!url || !/^postgres(ql)?:\/\//.test(url)) throw new Error("Configure DATABASE_URL (or DIRECT_URL) for PostgreSQL");
    const { PrismaPg } = await import("@prisma/adapter-pg");
    const factory = new PrismaPg({ connectionString: url, max: 1 });
    const connect = factory.connect.bind(factory);
    factory.connect = async () => {
      const adapter = await connect();
      const queryRaw = adapter.queryRaw.bind(adapter);
      adapter.queryRaw = (query) => queryRaw({ ...query,
        // Prisma 6's WASM migration introspection selects PostgreSQL `name`
        // columns, which adapter-pg 6 cannot deserialize. Cast catalog names
        // to text; values and query parameters remain unchanged.
        sql: query.sql.replace(/\b(tbl\.relname|namespace\.nspname) AS/g, "$1::text AS"),
      });
      return adapter;
    };
    return factory;
  },
  migrations: { path: "prisma/migrations", seed: "tsx prisma/seed.ts" },
});
