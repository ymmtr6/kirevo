import test from "node:test";
import assert from "node:assert/strict";
import { previewWebImport } from "../src/lib/web-import.mjs";

test("preview web import returns extracted markdown", async (t) => {
  const originalFetch = global.fetch;
  t.after(() => {
    global.fetch = originalFetch;
  });

  global.fetch = async () => ({
    url: "https://example.com/article",
    status: 200,
    headers: new Map([["content-type", "text/html"]]),
    text: async () => `
      <html>
        <head><title>Example Article</title></head>
        <body>
          <article>
            <h1>Example Article</h1>
            <p>Hello world.</p>
            <pre><code>const x = 1;</code></pre>
          </article>
        </body>
      </html>
    `
  });

  const result = await previewWebImport({ url: "https://example.com/article" });
  assert.equal(result.title, "Example Article");
  assert.match(result.extractedMarkdown, /Hello world/);
  assert.match(result.extractedMarkdown, /```/);
});
