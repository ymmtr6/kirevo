import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import {
  atomicWriteFile,
  ensureAppDirs,
  readJsonFile
} from "./fs-utils.mjs";
import { rebuildIndex } from "./indexer.mjs";
import { assignLayers, computeTopicScore } from "./layer-engine.mjs";
import { EVENTS_PATH, INDEX_PATH, TOPICS_DIR } from "./paths.mjs";
import {
  buildDefaultFrontmatter,
  parseTopicFile,
  serializeTopic,
  slugifyTitle
} from "./topic-format.mjs";

export async function initializeStore() {
  await ensureAppDirs();
  const samplePath = path.join(TOPICS_DIR, "welcome-to-kirevo.md");
  try {
    await fs.access(samplePath);
  } catch {
    const frontmatter = buildDefaultFrontmatter({
      title: "Welcome to Kirevo",
      slug: "welcome-to-kirevo",
      tags: ["welcome", "manual"],
      summary: "Kirevo workspace bootstrap topic."
    });
    const body = [
      "# Welcome to Kirevo",
      "",
      "## Summary",
      "Kirevo stores knowledge as Markdown topics.",
      "",
      "## Related",
      "- [[kirevo-usage-guide]]"
    ].join("\n");
    await atomicWriteFile(samplePath, serializeTopic({ frontmatter, body }));
  }

  const guidePath = path.join(TOPICS_DIR, "kirevo-usage-guide.md");
  try {
    await fs.access(guidePath);
  } catch {
    const frontmatter = buildDefaultFrontmatter({
      title: "Kirevo Usage Guide",
      slug: "kirevo-usage-guide",
      tags: ["guide"],
      summary: "Basic usage for topics, links, and imports."
    });
    const body = [
      "# Kirevo Usage Guide",
      "",
      "## Create",
      "Use the New Topic button to create a topic.",
      "",
      "## Link",
      "Use wiki links like [[welcome-to-kirevo]]."
    ].join("\n");
    await atomicWriteFile(guidePath, serializeTopic({ frontmatter, body }));
  }

  return rebuildIndex();
}

export async function getIndex() {
  return readJsonFile(INDEX_PATH, {
    generated_at: null,
    topics: [],
    links: [],
    sections: [],
    fetches: []
  });
}

export async function listTopics({ query, layer, tags, sourceType, offset = 0, limit = 100 } = {}) {
  const index = await getIndex();
  const normalizedQuery = query?.toLowerCase().trim();
  let topics = [...index.topics];

  if (normalizedQuery) {
    const sectionByTopic = new Map();
    for (const section of index.sections) {
      const list = sectionByTopic.get(section.topic_id) ?? [];
      list.push(`${section.heading ?? ""} ${section.content}`);
      sectionByTopic.set(section.topic_id, list);
    }

    topics = topics.filter((topic) => {
      const sectionText = (sectionByTopic.get(topic.id) ?? []).join(" ").toLowerCase();
      const haystack = `${topic.title} ${topic.summary} ${(topic.tags ?? []).join(" ")} ${sectionText}`.toLowerCase();
      return haystack.includes(normalizedQuery);
    });
  }

  if (layer?.length) {
    topics = topics.filter((topic) => layer.includes(topic.layer));
  }
  if (tags?.length) {
    topics = topics.filter((topic) => tags.every((tag) => (topic.tags ?? []).includes(tag)));
  }
  if (sourceType?.length) {
    topics = topics.filter((topic) => sourceType.includes(topic.source_type));
  }

  return {
    total: topics.length,
    items: topics.slice(offset, offset + limit)
  };
}

export async function readTopic(topicId) {
  const index = await getIndex();
  const topicMeta = index.topics.find((topic) => topic.id === topicId || topic.slug === topicId);
  if (!topicMeta) {
    throw new Error("Topic not found");
  }

  const raw = await fs.readFile(topicMeta.path, "utf8");
  const parsed = parseTopicFile(raw);
  const now = new Date().toISOString();
  const nextFrontmatter = {
    ...buildDefaultFrontmatter(parsed.frontmatter),
    last_read_at: now,
    updated_at: parsed.frontmatter.updated_at ?? topicMeta.updated_at
  };

  await atomicWriteFile(topicMeta.path, serializeTopic({ frontmatter: nextFrontmatter, body: parsed.body }));
  await appendEvent({
    id: crypto.randomUUID(),
    topic_id: topicMeta.id,
    event_type: "read",
    actor_type: "user",
    actor_id: "local-ui",
    created_at: now
  });

  await rebuildIndex();
  const rebuiltIndex = await getIndex();
  const topics = rebuiltIndex.topics.map((topic) =>
    topic.id === topicMeta.id
      ? {
          ...topic,
          last_read_at: now,
          read_count: (topic.read_count ?? 0) + 1
        }
      : topic
  );
  const rebalancedTopics = rebalanceTopics(topics);
  await atomicWriteFile(
    INDEX_PATH,
    JSON.stringify({ ...rebuiltIndex, topics: rebalancedTopics }, null, 2)
  );
  const nextIndex = await getIndex();
  const nextMeta = nextIndex.topics.find((topic) => topic.id === topicMeta.id);
  const backlinks = nextIndex.links
    .filter((link) => link.to_topic_id === topicMeta.id)
    .map((link) => nextIndex.topics.find((topic) => topic.id === link.from_topic_id))
    .filter(Boolean);

  return {
    frontmatter: nextFrontmatter,
    body: parsed.body,
    metadata: nextMeta,
    backlinks,
    sections: nextIndex.sections.filter((section) => section.topic_id === topicMeta.id)
  };
}

export async function saveTopic(input) {
  const index = await getIndex();
  const existing = input.frontmatter?.id
    ? index.topics.find((topic) => topic.id === input.frontmatter.id)
    : null;

  const title = input.frontmatter?.title?.trim() || "Untitled Topic";
  const requestedSlug = input.frontmatter?.slug?.trim() || slugifyTitle(title);
  const slug = ensureUniqueSlug(requestedSlug, index.topics, existing?.id);
  const now = new Date().toISOString();

  const frontmatter = buildDefaultFrontmatter({
    ...input.frontmatter,
    id: existing?.id ?? input.frontmatter?.id ?? `topic-${slug}`,
    slug,
    title,
    summary: input.frontmatter?.summary ?? "",
    tags: normalizeTags(input.frontmatter?.tags),
    created_at: existing?.created_at ?? input.frontmatter?.created_at ?? now,
    updated_at: now,
    source_type: input.frontmatter?.source_type ?? existing?.source_type ?? "manual",
    source_url: input.frontmatter?.source_url ?? existing?.source_url ?? null,
    site_name: input.frontmatter?.site_name ?? existing?.site_name ?? null,
    source_hash: input.frontmatter?.source_hash ?? existing?.source_hash ?? null,
    fetched_at: input.frontmatter?.fetched_at ?? existing?.fetched_at ?? null,
    author: input.frontmatter?.author ?? existing?.author ?? null,
    last_read_at: existing?.last_read_at ?? input.frontmatter?.last_read_at ?? null,
    pinned: Boolean(input.frontmatter?.pinned ?? existing?.pinned ?? false),
    manual_layer: input.frontmatter?.manual_layer ?? existing?.manual_layer ?? null
  });

  const destination = path.join(TOPICS_DIR, `${slug}.md`);
  await atomicWriteFile(
    destination,
    serializeTopic({
      frontmatter,
      body: input.body ?? ""
    })
  );

  if (existing?.path && existing.path !== destination) {
    await fs.rm(existing.path, { force: true });
  }

  await appendEvent({
    id: crypto.randomUUID(),
    topic_id: frontmatter.id,
    event_type: existing ? "update" : "create",
    actor_type: "user",
    actor_id: "local-ui",
    created_at: now
  });

  const existingWrites = existing?.write_count ?? 0;
  await rebuildIndex();
  const nextIndex = await getIndex();
  const topics = nextIndex.topics.map((topic) =>
    topic.id === frontmatter.id
      ? { ...topic, write_count: existingWrites + 1 }
      : topic
  );
  const rebalancedTopics = rebalanceTopics(topics);
  await atomicWriteFile(
    INDEX_PATH,
    JSON.stringify({ ...nextIndex, topics: rebalancedTopics }, null, 2)
  );
  return { id: frontmatter.id, slug, path: destination };
}

export async function readTopicContext({
  topicId,
  depth = 1,
  maxTopics = 5,
  sectionMode = "summary"
}) {
  const index = await getIndex();
  const primary = index.topics.find((topic) => topic.id === topicId || topic.slug === topicId);
  if (!primary) {
    throw new Error("Topic not found");
  }

  const visited = new Set([primary.id]);
  let frontier = [primary.id];
  const related = [];

  for (let currentDepth = 0; currentDepth < depth; currentDepth += 1) {
    const nextFrontier = [];
    for (const currentId of frontier) {
      for (const link of index.links) {
        if (link.from_topic_id !== currentId) {
          continue;
        }
        if (visited.has(link.to_topic_id)) {
          continue;
        }
        const topic = index.topics.find((item) => item.id === link.to_topic_id);
        if (!topic) {
          continue;
        }
        visited.add(topic.id);
        nextFrontier.push(topic.id);
        related.push(topic);
        if (related.length >= maxTopics) {
          break;
        }
      }
      if (related.length >= maxTopics) {
        break;
      }
    }
    frontier = nextFrontier;
    if (!frontier.length || related.length >= maxTopics) {
      break;
    }
  }

  return {
    query: primary.title,
    primaryTopics: [bundleTopic(primary, index, sectionMode)],
    relatedTopics: related.map((topic) => bundleTopic(topic, index, sectionMode))
  };
}

function bundleTopic(topic, index, sectionMode) {
  const sections = index.sections.filter((section) => section.topic_id === topic.id);
  if (sectionMode === "full") {
    return { ...topic, sections };
  }
  if (sectionMode === "top-sections") {
    return { ...topic, sections: sections.slice(0, 3) };
  }
  return {
    id: topic.id,
    title: topic.title,
    slug: topic.slug,
    summary: topic.summary
  };
}

function ensureUniqueSlug(baseSlug, topics, currentId) {
  let candidate = baseSlug || `topic-${Date.now()}`;
  let suffix = 1;
  const occupied = new Set(
    topics.filter((topic) => topic.id !== currentId).map((topic) => topic.slug)
  );
  while (occupied.has(candidate)) {
    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }
  return candidate;
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => `${tag}`.trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    return tags
      .split(",")
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

async function appendEvent(event) {
  const events = await readJsonFile(EVENTS_PATH, []);
  events.push(event);
  await atomicWriteFile(EVENTS_PATH, JSON.stringify(events, null, 2));
}

function rebalanceTopics(topics) {
  return assignLayers(
    topics.map((topic) => ({
      ...topic,
      score: computeTopicScore(topic)
    }))
  );
}
