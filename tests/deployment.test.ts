import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { sessionCookieOptions, sessionSecret } from "../src/lib/auth/config";
import { saveUploadedFile, readUploadedFile, removeUploadedFile, validateObjectKey } from "../src/lib/uploads/storage";
import { isAllowedType, MAX_UPLOAD_BYTES } from "../src/lib/uploads/limits";
import { answerQuestionSafely, resetAIProviderCache } from "../src/lib/ai";
import { readDocument } from "../src/lib/ocr";

test("production cookies and secret fail closed", () => {
  const previous = { ...process.env };
  try {
    Object.assign(process.env, { NODE_ENV: "production", SESSION_SECRET: "dev-only-secret" });
    assert.throws(sessionSecret);
    process.env.SESSION_SECRET = "a".repeat(64);
    assert.equal(sessionSecret().length, 64);
    assert.deepEqual(sessionCookieOptions(new Date(0)), { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: new Date(0) });
  } finally { process.env = previous; }
});

test("upload validation rejects traversal and oversized/non-document files", async () => {
  for (const key of ["../secret", "/etc/passwd", "https://public/object", "profile/../../x.pdf"]) assert.throws(() => validateObjectKey(key));
  assert.equal(isAllowedType("text/html", "report.html"), false);
  assert.equal(isAllowedType("", "report.pdf"), true);
  await assert.rejects(saveUploadedFile(Buffer.alloc(MAX_UPLOAD_BYTES + 1), "x.pdf", "application/pdf", "p"));
  await assert.rejects(saveUploadedFile(Buffer.from("html"), "x.html", "text/html", "p"));
});

test("private S3 SDK round trip, signed requests, deletion and outage propagation", async () => {
  const previous = { ...process.env };
  let data: Buffer | undefined;
  let outage = false;
  const server = createServer(async (req, res) => {
    assert.match(req.headers.authorization || "", /^AWS4-HMAC-SHA256/);
    assert.equal(req.headers["x-amz-acl"], undefined);
    if (outage) { res.writeHead(403); res.end(); return; }
    if (req.method === "PUT") { const chunks = []; for await (const chunk of req) chunks.push(chunk); data = Buffer.concat(chunks); res.end(); }
    else if (req.method === "GET") { res.writeHead(200, { "Content-Length": data!.length }); res.end(data); }
    else { data = undefined; res.writeHead(204); res.end(); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  Object.assign(process.env, { S3_BUCKET: "private", S3_REGION: "us-east-1", S3_ENDPOINT: `http://127.0.0.1:${address.port}`, S3_ACCESS_KEY_ID: "test", S3_SECRET_ACCESS_KEY: "test", S3_FORCE_PATH_STYLE: "true" });
  try {
    const stored = await saveUploadedFile(Buffer.from("%PDF test"), "report.pdf", "application/pdf", "profile");
    assert.equal((await readUploadedFile(stored.relativePath)).toString(), "%PDF test");
    await removeUploadedFile(stored.relativePath);
    assert.equal(data, undefined);
    outage = true;
    await assert.rejects(removeUploadedFile(stored.relativePath));
  } finally { process.env = previous; await new Promise<void>((resolve) => server.close(() => resolve())); }
});

test("demo OCR and AI work without paid keys, retaining grounding", async () => {
  process.env.AI_PROVIDER = "mock"; process.env.OCR_PROVIDER = "mock"; resetAIProviderCache();
  const result = await readDocument({ buffer: Buffer.from("sample"), fileName: "cbc.pdf", mimeType: "application/pdf" }, "LAB_REPORT");
  assert.ok(result.extracted.labValues.length > 0);
  const answer = await answerQuestionSafely({ question: "What is my vitamin D?", language: "en", context: { profileName: "Test", isChild: false, isElder: false, language: "en", records: [], medications: [], metrics: [], today: new Date() } });
  assert.equal(answer.isMock, true); assert.equal(answer.grounded, false);
});
