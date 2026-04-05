import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { DB_PATH, TOPICS_DIR } from "../src/lib/paths.mjs";
import {
  createMissingTopic,
  deleteTopic,
  initializeStore,
  listTopics,
  readTopic,
  saveTopic
} from "../src/lib/store.mjs";
import { rebuildIndex } from "../src/lib/indexer.mjs";

test("store supports filters, manual layer override, and missing-link creation", async () => {
  await fs.rm(DB_PATH, { force: true });
  await fs.rm(`${DB_PATH}-shm`, { force: true });
  await fs.rm(`${DB_PATH}-wal`, { force: true });
  await initializeStore();

  const saved = await saveTopic({
    frontmatter: {
      title: "Store Test Topic",
      tags: "alpha,beta",
      manual_layer: 4
    },
    body: "# Store Test Topic\n\n## Related\n- [[store-test-stub]]"
  });

  const detail = await readTopic(saved.id);
  assert.equal(detail.metadata.manual_layer, 4);
  assert.equal(detail.metadata.layer, 4);
  assert.deepEqual(detail.unresolvedLinks, [
    { target: "store-test-stub", title: "Store Test Stub" }
  ]);

  const filtered = await listTopics({ tags: ["alpha"], layer: [4] });
  assert.ok(filtered.items.some((item) => item.id === saved.id));

  const created = await createMissingTopic({
    sourceTopicId: saved.id,
    target: "store-test-stub"
  });
  assert.equal(created.status, "created");

  const stubPath = path.join(TOPICS_DIR, "store-test-stub.md");
  const exists = await fs.readFile(stubPath, "utf8");
  assert.match(exists, /Auto-created/);

  await deleteTopic(saved.id);
  await deleteTopic(created.id);
  await rebuildIndex();
});
