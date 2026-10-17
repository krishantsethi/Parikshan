try { process.loadEnvFile?.(); } catch { /* Vercel injects variables. */ }
const errors = [];
if (!/^postgres(ql)?:\/\//.test(process.env.DATABASE_URL || "")) errors.push("DATABASE_URL must use PostgreSQL");
const secret = process.env.SESSION_SECRET || "";
if (Buffer.byteLength(secret) < 32 || /change.me|placeholder|dev-only/i.test(secret)) errors.push("SESSION_SECRET: generate with openssl rand -base64 48");
for (const name of ["S3_BUCKET", "S3_REGION", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"]) {
  if (!process.env[name] || /placeholder|replace.me/i.test(process.env[name])) errors.push(`${name} is required`);
}
if (process.env.S3_ENDPOINT) {
  try { if (new URL(process.env.S3_ENDPOINT).protocol !== "https:") errors.push("S3_ENDPOINT must use HTTPS"); }
  catch { errors.push("S3_ENDPOINT must be a URL"); }
}
if (errors.length) { console.error(errors.join("\n")); process.exitCode = 1; }
else console.log("Required configuration present (connectivity is verified separately).");
