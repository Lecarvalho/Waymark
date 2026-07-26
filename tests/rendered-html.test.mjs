import assert from "node:assert/strict";
import test from "node:test";

async function render() {
  const serverUrl = new URL("../dist/server/ssr/index.js", import.meta.url);
  serverUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: server } = await import(serverUrl.href);

  return server.fetch(
    new Request("http://localhost/", {
      headers: { accept: "text/html" },
    }),
  );
}

test("server-renders an honest empty state without mock audit data", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);

  const html = await response.text();
  assert.match(html, /<title>Waymark · AI Navigability Auditor<\/title>/i);
  assert.match(html, /No audit data yet/);
  assert.match(html, /SQLite archive is empty/);
  assert.match(html, /Connecting to SQLite/);
  assert.match(html, /Prepare audit request/);
  assert.match(html, /Preparation only/);
  assert.match(html, /Nothing here creates a run, invokes a model, or writes to the audit journal/);
  assert.match(html, /Copy audit request/);
  assert.doesNotMatch(html, /Concise audit name/);
  assert.match(html, /Automatic targets/);
  assert.match(html, /editable hard limits/);
  assert.doesNotMatch(html, /<span>Target<\/span>/);
  assert.doesNotMatch(html, /Start audit/);
  assert.doesNotMatch(html, /meridian-commerce/);
  assert.doesNotMatch(html, /Example audit data/);
  assert.doesNotMatch(html, /Demo fallback/);
  assert.doesNotMatch(html, /codex-preview/);
  assert.doesNotMatch(html, /react-loading-skeleton/);
});
