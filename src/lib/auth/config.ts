export function sessionSecret(): string {
  const secret = process.env.SESSION_SECRET;
  if (secret && Buffer.byteLength(secret) >= 32 && !/change.me|placeholder|dev-only/i.test(secret)) return secret;
  if (process.env.NODE_ENV === "production") throw new Error("Set SESSION_SECRET to at least 32 random bytes");
  return secret || "dev-only-secret";
}
export function sessionCookieOptions(expires: Date) {
  return { httpOnly: true, sameSite: "lax" as const, secure: process.env.NODE_ENV === "production", path: "/", expires };
}
