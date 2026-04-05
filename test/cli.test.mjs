import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";

test("cli topics list returns JSON payload", async () => {
  const stdout = execFileSync("node", ["src/cli.mjs", "topics", "list"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const json = JSON.parse(stdout);
  assert.equal(json.ok, true);
  assert.ok(Array.isArray(json.items));
});

test("cli context get returns context bundle", async () => {
  const stdout = execFileSync("node", ["src/cli.mjs", "context", "get", "topic-welcome-to-kirevo"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const json = JSON.parse(stdout);
  assert.equal(json.ok, true);
  assert.equal(json.context.primaryTopics[0].id, "topic-welcome-to-kirevo");
});

test("cli topics save accepts markdown from stdin", async () => {
  const markdown = [
    "---",
    "title: CLI Topic",
    "slug: cli-topic",
    "tags: [cli, test]",
    "---",
    "",
    "# CLI Topic",
    "",
    "## Summary",
    "Created by CLI test."
  ].join("\n");

  const save = spawnSync("node", ["src/cli.mjs", "topics", "save", "--stdin"], {
    cwd: process.cwd(),
    input: markdown,
    encoding: "utf8"
  });
  assert.equal(save.status, 0, save.stderr);
  const json = JSON.parse(save.stdout);
  assert.equal(json.ok, true);
  assert.equal(json.saved.slug, "cli-topic");

  const read = execFileSync("node", ["src/cli.mjs", "topics", "read", "cli-topic"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
  const readJson = JSON.parse(read);
  assert.equal(readJson.topic.frontmatter.slug, "cli-topic");

  execFileSync("node", ["src/cli.mjs", "topics", "delete", "cli-topic"], {
    cwd: process.cwd(),
    encoding: "utf8"
  });
});
