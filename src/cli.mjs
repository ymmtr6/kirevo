#!/usr/bin/env node
import fs from "node:fs/promises";
import process from "node:process";
import { parseCliArgs, getFlag, getFlagList } from "./lib/cli-parser.mjs";
import { buildGraph, rebuildIndex } from "./lib/indexer.mjs";
import {
  createMissingTopic,
  deleteTopic,
  ensureStoreReady,
  listTopics,
  readTopic,
  readTopicContext,
  saveTopic
} from "./lib/store.mjs";
import { importWebPage, previewWebImport } from "./lib/web-import.mjs";
import { parseTopicFile } from "./lib/topic-format.mjs";

async function main() {
  await ensureStoreReady();

  const { positionals, flags } = parseCliArgs(process.argv.slice(2));
  const [resource, action, ...rest] = positionals;

  try {
    if (!resource || resource === "help" || getFlag(flags, "help")) {
      exitSuccess({
      ok: true,
      usage: [
        "kirevo topics list [--query <text>] [--layers 1,2] [--tags auth,design] [--source-types manual,web]",
        "kirevo topics read <topic-id-or-slug>",
        "kirevo topics save --file <path>",
        "kirevo topics save --stdin",
        "kirevo topics delete <topic-id-or-slug>",
        "kirevo topics create-from-link --source <topic-id> --target <slug>",
        "kirevo context get <topic-id-or-slug> [--depth 2] [--max-topics 8] [--mode summary|top-sections|full]",
        "kirevo graph show [--query <text>]",
        "kirevo import preview <url>",
        "kirevo import run <url> [--mode create|update-if-exists]",
        "kirevo index rebuild"
      ]
      });
      return;
    }

    if (resource === "topics" && action === "list") {
      exitSuccess({
        ok: true,
        ...(await listTopics({
          query: getFlag(flags, "query"),
          layer: getFlagList(flags, "layers").map(Number).filter(Boolean),
          tags: getFlagList(flags, "tags"),
          sourceType: getFlagList(flags, "sourceTypes"),
          limit: Number(getFlag(flags, "limit", 100)),
          offset: Number(getFlag(flags, "offset", 0))
        }))
      });
      return;
    }

    if (resource === "topics" && action === "read") {
      const topicId = rest[0];
      assertRequired(topicId, "topic id or slug is required");
      exitSuccess({
        ok: true,
        topic: await readTopic(topicId)
      });
      return;
    }

    if (resource === "topics" && action === "save") {
      const markdown = await readMarkdownInput(flags);
      const parsed = parseTopicFile(markdown);
      const saved = await saveTopic({
        frontmatter: parsed.frontmatter,
        body: parsed.body
      });
      exitSuccess({ ok: true, saved });
      return;
    }

    if (resource === "topics" && action === "delete") {
      const topicId = rest[0];
      assertRequired(topicId, "topic id or slug is required");
      exitSuccess({
        ok: true,
        result: await deleteTopic(topicId)
      });
      return;
    }

    if (resource === "topics" && action === "create-from-link") {
      const sourceTopicId = getFlag(flags, "source");
      const target = getFlag(flags, "target");
      assertRequired(sourceTopicId, "--source is required");
      assertRequired(target, "--target is required");
      exitSuccess({
        ok: true,
        result: await createMissingTopic({ sourceTopicId, target })
      });
      return;
    }

    if (resource === "context" && action === "get") {
      const topicId = rest[0];
      assertRequired(topicId, "topic id or slug is required");
      exitSuccess({
        ok: true,
        context: await readTopicContext({
          topicId,
          depth: Number(getFlag(flags, "depth", 1)),
          maxTopics: Number(getFlag(flags, "maxTopics", 5)),
          sectionMode: getFlag(flags, "mode", "summary")
        })
      });
      return;
    }

    if (resource === "graph" && action === "show") {
      exitSuccess({
        ok: true,
        graph: await buildGraph({
          query: getFlag(flags, "query"),
          tags: getFlagList(flags, "tags"),
          layers: getFlagList(flags, "layers").map(Number).filter(Boolean),
          sourceTypes: getFlagList(flags, "sourceTypes")
        })
      });
      return;
    }

    if (resource === "import" && action === "preview") {
      const url = rest[0];
      assertRequired(url, "url is required");
      exitSuccess({
        ok: true,
        preview: await previewWebImport({ url })
      });
      return;
    }

    if (resource === "import" && action === "run") {
      const url = rest[0];
      assertRequired(url, "url is required");
      exitSuccess({
        ok: true,
        result: await importWebPage({
          url,
          mode: getFlag(flags, "mode", "update-if-exists")
        })
      });
      return;
    }

    if (resource === "index" && action === "rebuild") {
      const result = await rebuildIndex();
      exitSuccess({
        ok: true,
        result: {
          generated_at: result.generated_at,
          topics: result.topics.length,
          links: result.links.length,
          sections: result.sections.length
        }
      });
      return;
    }

    exitError("validation_error", `unknown command: ${[resource, action].filter(Boolean).join(" ")}`, 2);
  } catch (error) {
    const message = error?.message || "unknown error";
    const code = /not found/i.test(message) ? "not_found" : /required/i.test(message) ? "validation_error" : "internal_error";
    const exitCode = code === "not_found" ? 3 : code === "validation_error" ? 2 : 5;
    exitError(code, message, exitCode);
  }
}

await main();

async function readMarkdownInput(flags) {
  const filePath = getFlag(flags, "file");
  const useStdin = Boolean(getFlag(flags, "stdin"));
  if (filePath) {
    return fs.readFile(filePath, "utf8");
  }
  if (useStdin || !process.stdin.isTTY) {
    return readStdin();
  }
  throw new Error("either --file <path> or --stdin is required");
}

function readStdin() {
  return new Promise((resolve, reject) => {
    const chunks = [];
    process.stdin.on("data", (chunk) => chunks.push(chunk));
    process.stdin.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    process.stdin.on("error", reject);
  });
}

function assertRequired(value, message) {
  if (!value) {
    throw new Error(message);
  }
}

function exitSuccess(payload) {
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(0);
}

function exitError(code, message, exitCode) {
  const payload = {
    ok: false,
    error: {
      code,
      message
    }
  };
  process.stderr.write(`${message}\n`);
  process.stdout.write(`${JSON.stringify(payload, null, 2)}\n`);
  process.exit(exitCode);
}
