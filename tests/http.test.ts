import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

test("production HTTP routes, demo server action, HTTPS cookie and logout", { skip: !process.env.TEST_APP_URL }, async () => {
  const base = process.env.TEST_APP_URL!;
  const manifest = JSON.parse(await readFile(".next/server/server-reference-manifest.json", "utf8"));
  function action(name: string) {
    return Object.keys(manifest.node).find((key) => manifest.node[key].exportedName === name)!;
  }
  const request = (path: string, init: RequestInit = {}) => fetch(base + path, { redirect: "manual", ...init });
  assert.equal((await request("/")).status, 200);
  assert.equal((await request("/dashboard")).status, 307);
  assert.equal((await request("/api/export")).status, 401);
  assert.equal((await request("/api/records/missing/file")).status, 401);
  assert.equal((await request("/dashboard", { headers: { Cookie: "phc_session=invalid" } })).status, 307);
  const postAction = (name: string, cookie = "") => request("/login", { method: "POST", headers: { "Next-Action": action(name), "Content-Type": "text/plain;charset=UTF-8", Origin: base, Cookie: cookie }, body: "[]" });
  const signedIn = await postAction("demoSignInAction");
  assert.equal(signedIn.status, 303);
  const header = signedIn.headers.get("set-cookie")!;
  assert.match(header, /Secure/); assert.match(header, /HttpOnly/); assert.match(header, /SameSite=lax/);
  const cookie = header.split(";")[0];
  for (const route of ["/dashboard", "/records", "/medications", "/trends", "/assistant", "/settings", "/api/export"]) {
    assert.equal((await request(route, { headers: { Cookie: cookie } })).status, 200, route);
  }
  assert.equal((await request("/api/records/missing/file", { headers: { Cookie: cookie } })).status, 404);
  const signedOut = await postAction("signOutAction", cookie);
  assert.equal(signedOut.status, 303);
  assert.match(signedOut.headers.get("set-cookie")!, /Expires=Thu, 01 Jan 1970/);
  assert.equal((await request("/api/export", { headers: { Cookie: cookie } })).status, 401);
});
