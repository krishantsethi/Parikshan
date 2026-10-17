# Vercel deployment runbook

## Scope and safety

This makes the existing **demo application** deployable; it does not turn demo
email/ABHA sign-in into verified identity. Anyone can access the shared demo
account and demo sign-in accepts an email without password verification. Do not
store real patient data or open this application for clinical use without replacing
that authentication, adding abuse controls and completing clinical/privacy review.
UI, Zod validation, ownership guards, consent notices and medical safety rules remain.
Demo OCR returns fictional example text, not a transcription of your uploaded file.
Hosted OCR adapters remain extension points; paid keys are not required.

No deployment or cloud-resource provisioning is performed by these changes.
Never use production credentials in tests. Do not commit `.env` files.

## 1. PostgreSQL

Create a managed PostgreSQL database (e.g. Neon or Supabase) in an appropriate
region, enable TLS and backups, and retain the provider's connection settings.
Use a **pooled** connection string as `DATABASE_URL` in Vercel. The application uses
`@prisma/adapter-pg` with at most three connections per warm function; set provider
connection limits accordingly. Do not disable TLS certificate verification.

Set `DIRECT_URL` to a direct connection for Prisma CLI operations if the runtime
pooler does not support migrations/session advisory locks. CLI prefers DIRECT_URL;
runtime only reads DATABASE_URL. Prisma's warning that the schema URL is ignored
by the CLI adapter is expected: the config explicitly supplies the same environment
URL (or the direct override).

The WASM schema engine avoids native engine downloads. Prisma 6 adapter-pg cannot
read PostgreSQL catalog `name` types during migrate deploy; prisma.config.ts casts
the two catalog name projections to text. Migration deploy, repeat deployment and
schema diff have been tested against PostgreSQL 17. Keep this compatibility fix
until upgrading Prisma with regression coverage.

From a trusted release runner with these variables available:

```bash
npm ci
npm run db:generate
npm run db:migrate        # prisma migrate deploy, committed PostgreSQL migration
npm run db:seed           # optional: creates fictional demo data ONLY when absent
```

`npm run setup` runs those three commands for an explicitly configured environment.
Dev, build, postinstall and start do **not** migrate, reset or seed. Demo sign-in
also initializes an absent demo account. Seeding uses a transaction-scoped advisory
lock so concurrent initial sign-ins cannot partially initialize it. Existing demo
accounts, edits, sessions and curated interaction data are not overwritten.

For future schema changes, use `npm run db:migrate:dev -- --name descriptive_name`
against an isolated development database with shadow-database privileges. Review
and commit SQL, then apply with `npm run db:migrate` during a controlled release.

### Existing SQLite data

This initial migration targets a **new empty PostgreSQL database**. It does not
convert or erase your SQLite database. Do not apply it to a populated PostgreSQL
schema or mark it resolved merely to suppress errors. Back up the SQLite file and
uploads together; stop writes before a cutover. If existing data must be retained,
perform an audited offline ETL (preserve IDs/relationships; convert SQLite booleans
and dates), import in foreign-key order, and compare row counts and sample records
before switching traffic. Local upload paths must be replaced with the new object
keys after uploading each file to the private bucket; copying old filePath strings
alone does not migrate documents. Revoke old sessions at cutover. This repository
does not include an automatic historical-data conversion tool.

## 2. Private S3-compatible storage

For AWS S3:

1. Create a bucket, enable **Block all public access** and bucket-owner-enforced
   ownership. Enable default encryption at rest. Select retention/versioning and
   regional residency policies appropriate to medical data. Avoid an object lock
   that would silently defeat the account erasure workflow.
2. Create a least-privilege IAM principal with `s3:PutObject`, `s3:GetObject`, and
   `s3:DeleteObject` on `arn:aws:s3:::YOUR_BUCKET/*`. No public ACL or browser CORS
   policy is needed: all uploads/downloads go through the application server.
3. Set `S3_BUCKET`, `S3_REGION`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.
   Leave S3_ENDPOINT empty. Do not use public-read bucket policies.

For Cloudflare R2, create a private bucket and a bucket-scoped read/write API token;
use its S3 access keys, `S3_REGION=auto`, and
`S3_ENDPOINT=https://ACCOUNT_ID.r2.cloudflarestorage.com`. Other S3-compatible
providers can set `S3_FORCE_PATH_STYLE=true` if required. Use HTTPS endpoints.

Only opaque `profileId/uuid.extension` keys are stored in HealthRecord.filePath.
The existing ownership-checked `/api/records/[id]/file` route proxies bytes, never
redirects to a public object URL, and returns `private, no-store` on success.
Delete failures propagate instead of deleting the database references and silently
leaving private documents behind. Configure orphan cleanup/retention monitoring;
DB transactions cannot atomically commit S3 operations.

## 3. Environment configuration

Copy `.env.example` for local development. In Vercel Project Settings → Environment
Variables, configure each target (Development, Preview, Production) separately:

| Variable | Requirement |
| --- | --- |
| DATABASE_URL | Required; PostgreSQL pooled runtime connection with TLS |
| DIRECT_URL | Optional direct CLI migration URL |
| SESSION_SECRET | Required; generate with `openssl rand -base64 48`; keep stable across instances |
| S3_BUCKET, S3_REGION | Required private bucket and region |
| S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY | Required server-side credentials |
| S3_ENDPOINT | Optional HTTPS S3-compatible endpoint (empty for AWS) |
| S3_FORCE_PATH_STYLE | Optional, defaults false |
| NEXT_PUBLIC_MAX_UPLOAD_MB | Non-secret; default/cap 4 MB, same client/server rule |
| AI_PROVIDER, OCR_PROVIDER | Leave `mock` for built-in functional demos |
| INTERACTION_PROVIDER, ABDM_MODE | Leave `demo` unless explicitly integrating real services |

Optional vendor key names are in `.env.example`. Never prefix credentials with
NEXT_PUBLIC_. Only the upload limit is public. Secret rotation invalidates existing
sessions. Production cookies are Secure, HttpOnly, SameSite=Lax, path `/`; logout
expires the cookie with the same attributes. Use HTTPS when testing in a browser.

Vercel's 4.5 MB request limit includes multipart overhead, so this implementation
caps files at 4 MB (previously 10 MB). Increasing Next's bodySizeLimit alone cannot
raise Vercel's gateway limit. Larger files require a separate authorized direct
object upload design. Demo OCR is synchronous and fast; real OCR may need a queue.

## 4. Release gate (before deploying)

Use Node 22 and npm. No real secrets need to be shared in chat.

```bash
npm run check:env         # presence/format checks, not a connectivity guarantee
npm run db:generate
npm run typecheck
npm test                 # unit tests; integration cases explicitly skipped without opt-in
npm run vercel-build     # environment checks + Prisma generation + next build
```

For isolated integration tests, migrate a disposable PostgreSQL DB first:

```bash
DATABASE_URL="$TEST_DATABASE_URL" npm run db:migrate
# Start the production build against that SAME disposable DB in another terminal:
DATABASE_URL="$TEST_DATABASE_URL" npm start
# HTTP test creates a demo session and logs it out. Never target a production app.
TEST_DATABASE_URL="postgresql://...disposable..." TEST_APP_URL="http://localhost:3000" npm test
```

The HTTP suite requires the `.next` server-action manifest from the running build.
It checks real demo login/logout actions, cookie flags, protected pages, invalid
sessions, export authorization and file-route 401/404 behavior. Storage tests use
an in-process S3 protocol fixture (signed SDK PUT/GET/DELETE), **not a real cloud
bucket**. Verify actual bucket permissions/connectivity manually before deployment.

Vercel uses `vercel.json` → `npm run vercel-build`; retain the Node.js runtime (not
Edge) for Prisma/S3 route handlers and actions. Run migrations once in a controlled
release job, not every concurrent Preview build. Seed is optional and non-destructive.
Use separate Preview databases/buckets; do not grant untrusted previews production
medical-data credentials. Deploy only after the above checks and provisioning pass.

## 5. Manual verification on a configured HTTPS Preview

- Sign in with the demo button twice/concurrently; existing data and edits remain.
- Refresh dashboard and switch family profiles; verify records, trends, medications.
- Upload a small PDF/image, review OCR fields, correct a value, view AI summary.
  No AI/OCR keys should be needed; fictional demo output must remain labelled.
- Open the private file endpoint while signed in: correct bytes/type and no-store.
  Sign out: 401. With another account's cookie: 404 (no existence disclosure).
- Confirm direct unsigned bucket access fails. Redeploy/restart and confirm the
  database record and document survive. Test storage denial/outage: upload reports
  STORAGE_FAILED and downloads report FILE_UNAVAILABLE rather than a broken public URL.
- Verify empty/unsupported/oversized uploads are rejected. Test a 4 MB file in
  Preview, including the camera upload path; gateway overhead may vary.
- Ask an unknown medical question; verify grounding, safety disclaimers and source
  references. Verify interactions never instruct starting/stopping medication.
- Check HTTPS cookie flags, expiration, logout and expired sessions. Verify export
  requires authentication. Test edit/delete actions and object deletion, including
  right-to-erasure on a disposable account only.
- Inspect Vercel function logs for sanitized errors (no secrets/clinical payloads),
  database pool saturation and timeouts. Test a backup restore before real use.

## Verification recorded in this change

Prisma generation, PostgreSQL migration deploy (fresh and repeat), non-destructive
seed, TypeScript checking, production build, and six unit/integration tests passed
in the sandbox (temporary PostgreSQL 17 and local S3 fixture). Real managed DB TLS,
cloud bucket policy, Vercel HTTPS and interactive upload flows remain release checks.
`npm audit` also reports inherited advisories in Prisma's deepmerge-ts and Next's
PostCSS dependency tree; assess/patch those before a public clinical deployment.
