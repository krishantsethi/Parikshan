import { randomUUID } from "node:crypto";
import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } from "@aws-sdk/client-s3";
import { MAX_UPLOAD_BYTES, isAllowedType } from "./limits";
export { ALLOWED_MIME_TYPES, MAX_UPLOAD_BYTES, formatBytes, isAllowedType } from "./limits";

function storage() {
  const { S3_BUCKET: bucket, S3_REGION: region, S3_ENDPOINT: endpoint, S3_ACCESS_KEY_ID: accessKeyId, S3_SECRET_ACCESS_KEY: secretAccessKey } = process.env;
  if (!bucket || !region || !accessKeyId || !secretAccessKey) throw new Error("STORAGE_NOT_CONFIGURED");
  const client = new S3Client({ region, endpoint: endpoint || undefined,
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    credentials: { accessKeyId, secretAccessKey } });
  return { client, bucket };
}

/** Only opaque keys generated here may be used; never accept a URL or disk path. */
export function validateObjectKey(key: string): string {
  if (!/^[a-zA-Z0-9_-]+\/[a-f0-9-]{36}\.(pdf|png|webp|heic|jpg)$/.test(key)) throw new Error("INVALID_PATH");
  return key;
}
export type StoredFile = { relativePath: string; size: number };

export async function saveUploadedFile(buffer: Buffer, originalName: string, mimeType: string, profileId: string): Promise<StoredFile> {
  if (!buffer.length || buffer.length > MAX_UPLOAD_BYTES || !isAllowedType(mimeType, originalName)) throw new Error("INVALID_FILE");
  const extension = mimeType === "application/pdf" ? "pdf" : mimeType === "image/png" ? "png" : mimeType === "image/webp" ? "webp" : /heic|heif/.test(mimeType) ? "heic" : "jpg";
  const key = validateObjectKey(`${profileId}/${randomUUID()}.${extension}`);
  const { client, bucket } = storage();
  try {
    // Bucket is private; do not set a public ACL or return an object URL.
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: buffer, ContentType: mimeType, CacheControl: "private, no-store" }));
    return { relativePath: key, size: buffer.length };
  } finally { client.destroy(); }
}
export async function readUploadedFile(key: string): Promise<Buffer> {
  validateObjectKey(key);
  const { client, bucket } = storage();
  try {
    const result = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!result.Body || (result.ContentLength ?? 0) > MAX_UPLOAD_BYTES) throw new Error("FILE_UNAVAILABLE");
    return Buffer.from(await result.Body.transformToByteArray());
  } finally { client.destroy(); }
}
export async function removeUploadedFile(key: string): Promise<void> {
  validateObjectKey(key);
  const { client, bucket } = storage();
  try {
    // S3 deletion is idempotent for missing keys; propagate outages/permission failures.
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  } finally { client.destroy(); }
}
