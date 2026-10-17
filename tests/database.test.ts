import test from "node:test";
import assert from "node:assert/strict";

// Explicit opt-in: never run seed/delete tests against a production database.
test("PostgreSQL seed concurrency, preserved edits, sessions and ownership", { skip: !process.env.TEST_DATABASE_URL }, async () => {
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { prisma } = await import("../src/lib/database/client");
  const { seedDemoAccount, DEMO_ACCOUNT_EMAIL } = await import("../src/lib/demo/demo-seed");
  const { assertProfileOwnership, assertRecordOwnership } = await import("../src/lib/auth/guards");
  try {
    await Promise.all([seedDemoAccount(prisma), seedDemoAccount(prisma)]);
    const user = await prisma.user.findUniqueOrThrow({ where: { email: DEMO_ACCOUNT_EMAIL }, include: { profiles: { include: { records: true } } } });
    assert.equal(user.profiles.length, 3);
    const record = user.profiles.flatMap((p) => p.records)[0];
    const originalNotes = record.notes;
    await prisma.healthRecord.update({ where: { id: record.id }, data: { notes: "preserved-test-edit" } });
    await seedDemoAccount(prisma);
    assert.equal((await prisma.healthRecord.findUniqueOrThrow({ where: { id: record.id } })).notes, "preserved-test-edit");
    await prisma.healthRecord.update({ where: { id: record.id }, data: { notes: originalNotes } });
    await assertProfileOwnership(user.id, user.profiles[0].id);
    await assertRecordOwnership(user.id, record.id);
    await assert.rejects(assertProfileOwnership("another-user", user.profiles[0].id), /FORBIDDEN/);
    await assert.rejects(assertRecordOwnership("another-user", record.id), /FORBIDDEN/);
    const session = await prisma.session.create({ data: { userId: user.id, tokenHash: `test-${crypto.randomUUID()}`, expiresAt: new Date(Date.now() + 60000) } });
    await prisma.session.delete({ where: { id: session.id } });
    assert.equal(await prisma.session.findUnique({ where: { id: session.id } }), null);
  } finally { await prisma.$disconnect(); }
});
