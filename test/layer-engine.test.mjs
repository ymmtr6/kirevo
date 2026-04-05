import test from "node:test";
import assert from "node:assert/strict";
import { assignLayers, computeTopicScore } from "../src/lib/layer-engine.mjs";

test("compute topic score reflects recency and read count", () => {
  const score = computeTopicScore({
    updated_at: new Date().toISOString(),
    last_read_at: new Date().toISOString(),
    read_count: 5,
    inbound_link_count: 3,
    outbound_link_count: 1,
    pinned: true
  });
  assert.ok(score > 0.5);
});

test("manual layer overrides percentile assignment", () => {
  const layered = assignLayers([
    { id: "a", score: 10, manual_layer: null },
    { id: "b", score: 5, manual_layer: 4 }
  ]);
  const manual = layered.find((item) => item.id === "b");
  assert.equal(manual.layer, 4);
});
