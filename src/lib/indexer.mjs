import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { atomicWriteFile, listMarkdownFiles, readJsonFile } from "./fs-utils.mjs";
import { computeTopicScore, assignLayers } from "./layer-engine.mjs";
import { INDEX_PATH, TOPICS_DIR } from "./paths.mjs";
import {
  buildDefaultFrontmatter,
  extractSections,
  extractWikiLinks,
  parseTopicFile,
  summarizeBody
} from "./topic-format.mjs";

export async function rebuildIndex() {
  const files = await listMarkdownFiles(TOPICS_DIR);
  const topicRecords = [];
  const sections = [];
  const linkCandidates = [];

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const topic = parseTopicFile(raw);
    const frontmatter = buildDefaultFrontmatter(topic.frontmatter);
    const stats = await fs.stat(filePath);
    const body = topic.body ?? "";
    const derivedSections = extractSections(body).map((section, index) => ({
      ...section,
      id: section.id ?? crypto.randomUUID(),
      topic_id: frontmatter.id,
      ord: index
    }));
    const links = extractWikiLinks(body);

    topicRecords.push({
      ...frontmatter,
      path: filePath,
      body,
      summary: frontmatter.summary || summarizeBody(body),
      layer: 4,
      read_count: 0,
      write_count: 0,
      inbound_link_count: 0,
      outbound_link_count: links.length,
      score: 0,
      file_mtime: stats.mtime.toISOString()
    });

    sections.push(...derivedSections);
    linkCandidates.push(
      ...links.map((link) => ({
        from_topic_id: frontmatter.id,
        target: link.target,
        link_type: "wiki",
        created_at: new Date().toISOString()
      }))
    );
  }

  const existingIndex = await readJsonFile(INDEX_PATH, {
    generated_at: null,
    topics: [],
    links: [],
    sections: [],
    fetches: []
  });
  const existingTopicMap = new Map(existingIndex.topics.map((topic) => [topic.id, topic]));
  const bySlug = new Map(topicRecords.map((topic) => [topic.slug, topic.id]));
  const byId = new Map(topicRecords.map((topic) => [topic.id, topic.id]));

  const links = [];
  for (const candidate of linkCandidates) {
    const targetId = byId.get(candidate.target) ?? bySlug.get(candidate.target);
    if (!targetId) {
      continue;
    }
    links.push({
      from_topic_id: candidate.from_topic_id,
      to_topic_id: targetId,
      link_type: candidate.link_type,
      created_at: candidate.created_at
    });
  }

  const inboundMap = new Map();
  const outboundMap = new Map();
  for (const link of links) {
    inboundMap.set(link.to_topic_id, (inboundMap.get(link.to_topic_id) ?? 0) + 1);
    outboundMap.set(link.from_topic_id, (outboundMap.get(link.from_topic_id) ?? 0) + 1);
  }

  const scoredTopics = topicRecords.map((topic) => {
    const existing = existingTopicMap.get(topic.id);
    const merged = {
      ...topic,
      last_read_at: existing?.last_read_at ?? topic.last_read_at,
      read_count: existing?.read_count ?? 0,
      write_count: existing?.write_count ?? 0,
      inbound_link_count: inboundMap.get(topic.id) ?? 0,
      outbound_link_count: outboundMap.get(topic.id) ?? 0
    };
    return {
      ...merged,
      score: computeTopicScore(merged)
    };
  });

  const layeredTopics = assignLayers(scoredTopics)
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .map((topic) => ({
      ...topic,
      tags: Array.isArray(topic.tags) ? topic.tags : []
    }));

  const nextIndex = {
    generated_at: new Date().toISOString(),
    topics: layeredTopics,
    links,
    sections,
    fetches: existingIndex.fetches ?? []
  };

  await atomicWriteFile(INDEX_PATH, JSON.stringify(nextIndex, null, 2));
  return nextIndex;
}

export function buildGraph(index, filters = {}) {
  const allowedTopics = index.topics.filter((topic) => {
    if (filters.query) {
      const query = filters.query.toLowerCase();
      const haystack = `${topic.title} ${topic.summary} ${(topic.tags ?? []).join(" ")}`.toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }
    if (filters.layers?.length && !filters.layers.includes(topic.layer)) {
      return false;
    }
    if (filters.sourceTypes?.length && !filters.sourceTypes.includes(topic.source_type)) {
      return false;
    }
    return true;
  });

  const topicIds = new Set(allowedTopics.map((topic) => topic.id));
  const columns = new Map([
    [1, []],
    [2, []],
    [3, []],
    [4, []]
  ]);

  for (const topic of allowedTopics) {
    columns.get(topic.layer)?.push(topic);
  }

  const positionedNodes = [];
  for (const [layer, topics] of columns.entries()) {
    topics.forEach((topic, index) => {
      positionedNodes.push({
        id: topic.id,
        label: topic.title,
        slug: topic.slug,
        layer,
        sourceType: topic.source_type,
        x: 140 + (layer - 1) * 220,
        y: 80 + index * 90
      });
    });
  }

  const edges = index.links
    .filter((link) => topicIds.has(link.from_topic_id) && topicIds.has(link.to_topic_id))
    .map((link) => ({
      id: `${link.from_topic_id}:${link.to_topic_id}`,
      source: link.from_topic_id,
      target: link.to_topic_id
    }));

  return { nodes: positionedNodes, edges };
}
