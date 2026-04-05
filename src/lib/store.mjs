import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { atomicWriteFile, ensureAppDirs } from "./fs-utils.mjs";
import { initializeDatabase, queryJson, runSql, sqlBoolean, sqlNumber, sqlString } from "./db.mjs";
import { getIndexSnapshot, rebuildIndex } from "./indexer.mjs";
import { assignLayers, computeTopicScore } from "./layer-engine.mjs";
import { TOPICS_DIR } from "./paths.mjs";
import {
  buildDefaultFrontmatter,
  extractWikiLinks,
  parseTopicFile,
  serializeTopic,
  slugifyTitle
} from "./topic-format.mjs";

export async function initializeStore() {
  await ensureStoreReady();
  return rebuildIndex();
}

export async function ensureStoreReady() {
  await ensureAppDirs();
  await initializeDatabase();
  await ensureSampleTopic("welcome-to-kirevo.md", {
    title: "Welcome to Kirevo",
    slug: "welcome-to-kirevo",
    tags: ["welcome", "manual"],
    summary: "Kirevo workspace bootstrap topic."
  }, [
    "# Welcome to Kirevo",
    "",
    "## Summary",
    "Kirevo stores knowledge as Markdown topics.",
    "",
    "## Related",
    "- [[kirevo-usage-guide]]"
  ]);
  await ensureSampleTopic("kirevo-usage-guide.md", {
    title: "Kirevo Usage Guide",
    slug: "kirevo-usage-guide",
    tags: ["guide"],
    summary: "Basic usage for topics, links, and imports."
  }, [
    "# Kirevo Usage Guide",
    "",
    "## Create",
    "Use the New Topic button to create a topic.",
    "",
    "## Link",
    "Use wiki links like [[welcome-to-kirevo]]."
  ]);
}

export async function getIndex() {
  return getIndexSnapshot();
}

export async function listTopics({
  query,
  layer,
  tags,
  sourceType,
  offset = 0,
  limit = 100
} = {}) {
  await initializeDatabase();
  const conditions = [];
  if (query?.trim()) {
    const normalized = query.trim().toLowerCase();
    const ftsQuery = query
      .trim()
      .split(/\s+/)
      .map((part) => `"${part.replace(/"/g, '""')}"`)
      .join(" ");
    conditions.push(`(
      lower(t.title) LIKE '%' || ${sqlString(normalized)} || '%'
      OR lower(COALESCE(t.summary, '')) LIKE '%' || ${sqlString(normalized)} || '%'
      OR EXISTS (
        SELECT 1 FROM topic_sections_fts
        WHERE topic_sections_fts.topic_id = t.id
          AND topic_sections_fts MATCH ${sqlString(ftsQuery)}
      )
    )`);
  }
  if (layer?.length) {
    conditions.push(`t.layer IN (${layer.map((value) => sqlNumber(value)).join(", ")})`);
  }
  if (sourceType?.length) {
    conditions.push(`t.source_type IN (${sourceType.map(sqlString).join(", ")})`);
  }
  if (tags?.length) {
    for (const tag of tags) {
      conditions.push(`EXISTS (
        SELECT 1 FROM topic_tags tt
        WHERE tt.topic_id = t.id AND tt.tag = ${sqlString(tag)}
      )`);
    }
  }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";

  const totalRows = await queryJson(`SELECT COUNT(*) AS count FROM topics t ${where};`);
  const rows = await queryJson(`
    SELECT
      t.*,
      COALESCE((SELECT json_group_array(tag) FROM topic_tags tt WHERE tt.topic_id = t.id), '[]') AS tags_json
    FROM topics t
    ${where}
    ORDER BY t.layer ASC, t.score DESC, t.updated_at DESC
    LIMIT ${sqlNumber(limit, 100)}
    OFFSET ${sqlNumber(offset, 0)};
  `);

  return {
    total: Number(totalRows[0]?.count ?? 0),
    items: rows.map(mapTopicRow)
  };
}

export async function readTopic(topicId) {
  await initializeDatabase();
  const topic = await getTopicByIdOrSlug(topicId);
  if (!topic) {
    throw new Error("Topic not found");
  }

  const raw = await fs.readFile(topic.path, "utf8");
  const parsed = parseTopicFile(raw);
  const now = new Date().toISOString();
  const nextFrontmatter = {
    ...buildDefaultFrontmatter(parsed.frontmatter),
    last_read_at: now
  };

  await runSql(`
    INSERT INTO topic_events (id, topic_id, event_type, actor_type, actor_id, payload_json, created_at)
    VALUES (
      ${sqlString(crypto.randomUUID())},
      ${sqlString(topic.id)},
      'read',
      'user',
      'local-ui',
      NULL,
      ${sqlString(now)}
    );
    UPDATE topics
    SET last_read_at = ${sqlString(now)},
        read_count = read_count + 1,
        updated_at = updated_at
    WHERE id = ${sqlString(topic.id)};
  `);

  await recomputeTopicScores();

  const metadata = await getTopicByIdOrSlug(topic.id);
  const backlinks = await queryJson(`
    SELECT t.id, t.slug, t.title
    FROM topic_links l
    JOIN topics t ON t.id = l.from_topic_id
    WHERE l.to_topic_id = ${sqlString(topic.id)}
    ORDER BY t.score DESC, t.updated_at DESC;
  `);
  const sections = await queryJson(`
    SELECT id, topic_id, ord, heading, level, content
    FROM topic_sections
    WHERE topic_id = ${sqlString(topic.id)}
    ORDER BY ord ASC;
  `);
  const unresolvedLinks = extractWikiLinks(parsed.body)
    .map((link) => link.target)
    .filter((target, index, all) => all.indexOf(target) === index)
    .filter(asyncNoop);
  const unresolved = [];
  for (const target of unresolvedLinks) {
    const existing = await getTopicByIdOrSlug(target);
    if (!existing) {
      unresolved.push({
        target,
        title: humanizeSlug(target)
      });
    }
  }

  return {
    frontmatter: nextFrontmatter,
    body: parsed.body,
    metadata,
    backlinks,
    sections,
    unresolvedLinks: unresolved
  };
}

export async function saveTopic(input) {
  await initializeDatabase();
  const existing = input.frontmatter?.id
    ? await getTopicByIdOrSlug(input.frontmatter.id)
    : null;
  const title = input.frontmatter?.title?.trim() || "Untitled Topic";
  const requestedSlug = input.frontmatter?.slug?.trim() || slugifyTitle(title);
  const slug = await ensureUniqueSlug(requestedSlug, existing?.id);
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
    manual_layer: normalizeManualLayer(input.frontmatter?.manual_layer ?? existing?.manual_layer ?? null)
  });

  const destination = path.join(TOPICS_DIR, `${slug}.md`);
  await atomicWriteFile(destination, serializeTopic({ frontmatter, body: input.body ?? "" }));
  if (existing?.path && existing.path !== destination) {
    await fs.rm(existing.path, { force: true });
  }

  await rebuildIndex();
  await runSql(`
    UPDATE topics
    SET write_count = write_count + 1,
        manual_layer = ${frontmatter.manual_layer == null ? "NULL" : sqlNumber(frontmatter.manual_layer)},
        pinned = ${sqlBoolean(Boolean(frontmatter.pinned))}
    WHERE id = ${sqlString(frontmatter.id)};
    INSERT INTO topic_events (id, topic_id, event_type, actor_type, actor_id, payload_json, created_at)
    VALUES (
      ${sqlString(crypto.randomUUID())},
      ${sqlString(frontmatter.id)},
      ${sqlString(existing ? "update" : "create")},
      'user',
      'local-ui',
      NULL,
      ${sqlString(now)}
    );
  `);
  await recomputeTopicScores();

  return { id: frontmatter.id, slug, path: destination };
}

export async function deleteTopic(topicId) {
  const existing = await getTopicByIdOrSlug(topicId);
  if (!existing) {
    throw new Error("Topic not found");
  }
  await fs.rm(existing.path, { force: true });
  await rebuildIndex();
  return { deleted: true, id: existing.id };
}

export async function createMissingTopic({ sourceTopicId, target }) {
  const existing = await getTopicByIdOrSlug(target);
  if (existing) {
    return { id: existing.id, slug: existing.slug, path: existing.path, status: "existing" };
  }
  const title = humanizeSlug(target);
  return saveTopic({
    frontmatter: {
      title,
      slug: slugifyTitle(target),
      tags: ["stub"],
      summary: `Auto-created from [[${target}]] in ${sourceTopicId}.`
    },
    body: [`# ${title}`, "", "## Summary", `Auto-created from [[${target}]].`, "", "## Notes", ""].join("\n")
  }).then((saved) => ({ ...saved, status: "created" }));
}

export async function readTopicContext({
  topicId,
  depth = 1,
  maxTopics = 5,
  sectionMode = "summary"
}) {
  const primary = await getTopicByIdOrSlug(topicId);
  if (!primary) {
    throw new Error("Topic not found");
  }

  const visited = new Set([primary.id]);
  let frontier = [primary.id];
  const related = [];

  for (let currentDepth = 0; currentDepth < depth; currentDepth += 1) {
    if (!frontier.length || related.length >= maxTopics) {
      break;
    }
    const rows = await queryJson(`
      SELECT DISTINCT t.*
      FROM topic_links l
      JOIN topics t ON t.id = l.to_topic_id
      WHERE l.from_topic_id IN (${frontier.map(sqlString).join(", ")})
      ORDER BY t.layer ASC, t.score DESC
      LIMIT ${sqlNumber(maxTopics)};
    `);
    const next = [];
    for (const row of rows) {
      if (visited.has(row.id)) {
        continue;
      }
      visited.add(row.id);
      related.push(mapTopicRow(row));
      next.push(row.id);
      if (related.length >= maxTopics) {
        break;
      }
    }
    frontier = next;
  }

  return {
    query: primary.title,
    primaryTopics: [await bundleTopic(primary, sectionMode)],
    relatedTopics: await Promise.all(related.slice(0, maxTopics).map((topic) => bundleTopic(topic, sectionMode)))
  };
}

async function bundleTopic(topic, sectionMode) {
  if (sectionMode === "summary") {
    return {
      id: topic.id,
      title: topic.title,
      slug: topic.slug,
      summary: topic.summary
    };
  }
  const sections = await queryJson(`
    SELECT id, topic_id, ord, heading, level, content
    FROM topic_sections
    WHERE topic_id = ${sqlString(topic.id)}
    ORDER BY ord ASC;
  `);
  if (sectionMode === "top-sections") {
    return { ...topic, sections: sections.slice(0, 3) };
  }
  return { ...topic, sections };
}

async function ensureSampleTopic(fileName, frontmatterInput, bodyLines) {
  const targetPath = path.join(TOPICS_DIR, fileName);
  try {
    await fs.access(targetPath);
  } catch {
    const frontmatter = buildDefaultFrontmatter(frontmatterInput);
    await atomicWriteFile(
      targetPath,
      serializeTopic({ frontmatter, body: bodyLines.join("\n") })
    );
  }
}

async function getTopicByIdOrSlug(topicId) {
  const rows = await queryJson(`
    SELECT
      t.*,
      COALESCE((SELECT json_group_array(tag) FROM topic_tags tt WHERE tt.topic_id = t.id), '[]') AS tags_json
    FROM topics t
    WHERE t.id = ${sqlString(topicId)} OR t.slug = ${sqlString(topicId)}
    LIMIT 1;
  `);
  return rows[0] ? mapTopicRow(rows[0]) : null;
}

async function ensureUniqueSlug(baseSlug, currentId) {
  let candidate = baseSlug || `topic-${Date.now()}`;
  let suffix = 1;
  while (true) {
    const rows = await queryJson(`
      SELECT id
      FROM topics
      WHERE slug = ${sqlString(candidate)}
      LIMIT 1;
    `);
    if (!rows[0] || rows[0].id === currentId) {
      return candidate;
    }
    suffix += 1;
    candidate = `${baseSlug}-${suffix}`;
  }
}

async function recomputeTopicScores() {
  const rows = await queryJson(`
    SELECT
      t.*,
      COALESCE((SELECT json_group_array(tag) FROM topic_tags tt WHERE tt.topic_id = t.id), '[]') AS tags_json
    FROM topics t;
  `);
  const layered = rows.map(mapTopicRow);
  const scored = layered.map((topic) => ({
    ...topic,
    score: computeTopicScoreSafe(topic)
  }));
  const reassigned = reassignLayers(scored);
  const statements = ["BEGIN;"];

  for (const topic of reassigned) {
    statements.push(`
      UPDATE topics
      SET score = ${sqlNumber(topic.score)},
          layer = ${sqlNumber(topic.layer)},
          read_count = ${sqlNumber(topic.read_count)},
          write_count = ${sqlNumber(topic.write_count)},
          last_read_at = ${sqlString(topic.last_read_at)},
          manual_layer = ${topic.manual_layer == null ? "NULL" : sqlNumber(topic.manual_layer)},
          pinned = ${sqlBoolean(Boolean(topic.pinned))}
      WHERE id = ${sqlString(topic.id)};
    `);
  }
  statements.push("COMMIT;");
  await runSql(statements.join("\n"));
}

function computeTopicScoreSafe(topic) {
  return computeTopicScore({
    ...topic,
    pinned: Boolean(topic.pinned)
  });
}

function reassignLayers(topics) {
  return assignLayers(topics);
}

function normalizeTags(tags) {
  if (Array.isArray(tags)) {
    return tags.map((tag) => `${tag}`.trim()).filter(Boolean);
  }
  if (typeof tags === "string") {
    return tags.split(",").map((tag) => tag.trim()).filter(Boolean);
  }
  return [];
}

function normalizeManualLayer(value) {
  const normalized = Number(value);
  return [1, 2, 3, 4].includes(normalized) ? normalized : null;
}

function mapTopicRow(row) {
  const { tags_json, ...rest } = row;
  return {
    ...rest,
    tags: safeParse(tags_json),
    pinned: Boolean(Number(row.pinned))
  };
}

function safeParse(value) {
  try {
    return JSON.parse(value ?? "[]");
  } catch {
    return [];
  }
}

function humanizeSlug(value) {
  return `${value}`.replace(/[-_]+/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
}

function asyncNoop(value) {
  return Boolean(value);
}
