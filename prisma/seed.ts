import path from "node:path";
import { seedDemoAccount } from "../src/lib/demo/demo-seed";

try { process.loadEnvFile?.(path.join(process.cwd(), ".env")); } catch { /* Injected environment. */ }
// Dynamic import ensures the CLI loads .env before creating the database pool.
async function main() {
const { prisma } = await import("../src/lib/database/client");
try {
  await seedDemoAccount(prisma);
  console.log("Demo seed ready (existing data preserved).");
} catch (error) {
  console.error("Seed failed", error);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}

}
main().catch(() => { process.exitCode = 1; });
