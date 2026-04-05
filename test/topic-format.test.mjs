import test from "node:test";
import assert from "node:assert/strict";
import {
  buildDefaultFrontmatter,
  extractSections,
  extractWikiLinks,
  parseTopicFile,
  serializeTopic
} from "../src/lib/topic-format.mjs";

test("topic parse and serialize round-trip frontmatter", () => {
  const frontmatter = buildDefaultFrontmatter({
    title: "DDD設計メモ",
    slug: "ddd-notes",
    tags: ["architecture", "backend"]
  });
  const body = "# DDD\n\nSee [[auth-session|Auth]].";
  const serialized = serializeTopic({ frontmatter, body });
  const parsed = parseTopicFile(serialized);

  assert.equal(parsed.frontmatter.title, "DDD設計メモ");
  assert.deepEqual(parsed.frontmatter.tags, ["architecture", "backend"]);
  assert.equal(parsed.body, body);
});

test("wiki link extraction supports label syntax", () => {
  const links = extractWikiLinks("Use [[auth-session|Auth Session]] and [[cookie-strategy]].");
  assert.deepEqual(links, [
    { target: "auth-session", label: "Auth Session" },
    { target: "cookie-strategy", label: null }
  ]);
});

test("section extraction splits by headings", () => {
  const sections = extractSections("# Title\n\n## Summary\nHello\n\n## Notes\nWorld");
  assert.equal(sections.length, 3);
  assert.equal(sections[1].heading, "Summary");
  assert.match(sections[2].content, /World/);
});
