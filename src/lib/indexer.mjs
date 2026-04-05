import crypto from "node:crypto";
import fs from "node:fs/promises";
import { listMarkdownFiles } from "./fs-utils.mjs";
import { assignLayers, computeTopicScore } from "./layer-engine.mjs";
import { initializeDatabase, queryJson, runSql, sqlBoolean, sqlNumber, sqlString } from "./db.mjs";
import { TOPICS_DIR } from "./paths.mjs";
import {
  buildDefaultFrontmatter,
  extractSections,
  extractWikiLinks,
  parseTopicFile,
  summarizeBody
} from "./topic-format.mjs";

export async function rebuildIndex() {
  await initializeDatabase();
  const files = await listMarkdownFiles(TOPICS_DIR);
  const previousTopics = await queryJson(`
    SELECT id, read_count, write_count, last_read_at, manual_layer, pinned
    FROM topics;
  `);
  const previousMap = new Map(previousTopics.map((topic) => [topic.id, topic]));

  const topicRecords = [];
  const linkCandidates = [];
  const sectionRecords = [];
  const currentTopicIds = new Set();
  const now = new Date().toISOString();

  for (const filePath of files) {
    const raw = await fs.readFile(filePath, "utf8");
    const parsed = parseTopicFile(raw);
    const frontmatter = buildDefaultFrontmatter(parsed.frontmatter);
    const previous = previousMap.get(frontmatter.id);
    const stats = await fs.stat(filePath);
    const body = parsed.body ?? "";
    const tags = Array.isArray(frontmatter.tags) ? frontmatter.tags : [];
    const links = extractWikiLinks(body);
    const sections = extractSections(body);

    currentTopicIds.add(frontmatter.id);
    topicRecords.push({
      ...frontmatter,
      path: filePath,
      body,
      summary: frontmatter.summary || summarizeBody(body),
      read_count: previous?.read_count ?? 0,
      write_count: previous?.write_count ?? 0,
      pinned: previous?.pinned ?? (frontmatter.pinned ? 1 : 0),
      manual_layer: previous?.manual_layer ?? frontmatter.manual_layer ?? null,
      file_mtime: stats.mtime.toISOString(),
      tags
    });

    for (const link of links) {
      linkCandidates.push({
        from_topic_id: frontmatter.id,
        target: link.target,
        link_type: "wiki",
        created_at: now
      });
    }

    sections.forEach((section, index) => {
      sectionRecords.push({
        id: section.id ?? crypto.randomUUID(),
        topic_id: frontmatter.id,
        ord: index,
        heading: section.heading,
        level: section.level,
        content: section.content || ""
      });
    });
  }

  const bySlug = new Map(topicRecords.map((topic) => [topic.slug, topic.id]));
  const byId = new Map(topicRecords.map((topic) => [topic.id, topic.id]));
  const links = [];
  const inboundMap = new Map();
  const outboundMap = new Map();

  for (const candidate of linkCandidates) {
    const targetId = byId.get(candidate.target) ?? bySlug.get(candidate.target);
    if (!targetId) {
      continue;
    }
    const key = `${candidate.from_topic_id}:${targetId}:${candidate.link_type}`;
    if (links.some((item) => `${item.from_topic_id}:${item.to_topic_id}:${item.link_type}` === key)) {
      continue;
    }
    links.push({
      from_topic_id: candidate.from_topic_id,
      to_topic_id: targetId,
      link_type: candidate.link_type,
      created_at: candidate.created_at
    });
    inboundMap.set(targetId, (inboundMap.get(targetId) ?? 0) + 1);
    outboundMap.set(candidate.from_topic_id, (outboundMap.get(candidate.from_topic_id) ?? 0) + 1);
  }

  const scoredTopics = assignLayers(
    topicRecords.map((topic) => {
      const next = {
        ...topic,
        inbound_link_count: inboundMap.get(topic.id) ?? 0,
        outbound_link_count: outboundMap.get(topic.id) ?? 0
      };
      return {
        ...next,
        score: computeTopicScore(next)
      };
    })
  );

  const statements = ["BEGIN;"];
  const idsSql = [...currentTopicIds].map(sqlString).join(", ");
  if (idsSql) {
    statements.push(`
      PRAGMA foreign_keys = ON;
      DELETE FROM topic_sections WHERE topic_id NOT IN (${idsSql});
      DELETE FROM topic_tags WHERE topic_id NOT IN (${idsSql});
      DELETE FROM topic_links WHERE from_topic_id NOT IN (${idsSql}) OR to_topic_id NOT IN (${idsSql});
      DELETE FROM topic_events WHERE topic_id NOT IN (${idsSql});
      DELETE FROM topics WHERE id NOT IN (${idsSql});
    `);
  } else {
    statements.push(`
      DELETE FROM topic_sections;
      DELETE FROM topic_tags;
      DELETE FROM topic_links;
      DELETE FROM topic_events;
      DELETE FROM topics;
    `);
  }

  statements.push(`
    DELETE FROM topic_sections;
    DELETE FROM topic_sections_fts;
    DELETE FROM topic_tags;
    DELETE FROM topic_links;
  `);

  for (const topic of scoredTopics) {
    statements.push(`
      INSERT INTO topics (
          id, slug, title, path, summary, body, layer, manual_layer, pinned,
          source_type, source_url, canonical_url, site_name, source_hash, author,
          created_at, updated_at, fetched_at, last_read_at, read_count, write_count,
          inbound_link_count, outbound_link_count, score, file_mtime
        ) VALUES (
          ${sqlString(topic.id)},
          ${sqlString(topic.slug)},
          ${sqlString(topic.title)},
          ${sqlString(topic.path)},
          ${sqlString(topic.summary)},
          ${sqlString(topic.body)},
          ${sqlNumber(topic.layer, 4)},
          ${topic.manual_layer == null ? "NULL" : sqlNumber(topic.manual_layer)},
          ${sqlBoolean(Boolean(topic.pinned))},
          ${sqlString(topic.source_type)},
          ${sqlString(topic.source_url)},
          ${sqlString(canonicalizeUrl(topic.source_url))},
          ${sqlString(topic.site_name)},
          ${sqlString(topic.source_hash)},
          ${sqlString(topic.author)},
          ${sqlString(topic.created_at)},
          ${sqlString(topic.updated_at)},
          ${sqlString(topic.fetched_at)},
          ${sqlString(topic.last_read_at)},
          ${sqlNumber(topic.read_count)},
          ${sqlNumber(topic.write_count)},
          ${sqlNumber(topic.inbound_link_count)},
          ${sqlNumber(topic.outbound_link_count)},
          ${sqlNumber(topic.score)},
          ${sqlString(topic.file_mtime)}
        )
      ON CONFLICT(id) DO UPDATE SET
          slug=excluded.slug,
          title=excluded.title,
          path=excluded.path,
          summary=excluded.summary,
          body=excluded.body,
          layer=excluded.layer,
          manual_layer=excluded.manual_layer,
          pinned=excluded.pinned,
          source_type=excluded.source_type,
          source_url=excluded.source_url,
          canonical_url=excluded.canonical_url,
          site_name=excluded.site_name,
          source_hash=excluded.source_hash,
          author=excluded.author,
          created_at=excluded.created_at,
          updated_at=excluded.updated_at,
          fetched_at=excluded.fetched_at,
          last_read_at=excluded.last_read_at,
          read_count=excluded.read_count,
          write_count=excluded.write_count,
          inbound_link_count=excluded.inbound_link_count,
          outbound_link_count=excluded.outbound_link_count,
          score=excluded.score,
          file_mtime=excluded.file_mtime;
    `);

    for (const tag of topic.tags) {
      statements.push(`
        INSERT OR REPLACE INTO topic_tags (topic_id, tag)
        VALUES (${sqlString(topic.id)}, ${sqlString(tag)});
      `);
    }
  }

  for (const section of sectionRecords) {
    statements.push(`
      INSERT INTO topic_sections (id, topic_id, ord, heading, level, content)
      VALUES (
        ${sqlString(section.id)},
        ${sqlString(section.topic_id)},
        ${sqlNumber(section.ord)},
        ${sqlString(section.heading)},
        ${section.level == null ? "NULL" : sqlNumber(section.level)},
        ${sqlString(section.content)}
      );
      INSERT INTO topic_sections_fts (topic_id, heading, content)
      VALUES (
        ${sqlString(section.topic_id)},
        ${sqlString(section.heading)},
        ${sqlString(section.content)}
      );
    `);
  }

  for (const link of links) {
    statements.push(`
      INSERT OR REPLACE INTO topic_links (from_topic_id, to_topic_id, link_type, created_at)
      VALUES (
        ${sqlString(link.from_topic_id)},
        ${sqlString(link.to_topic_id)},
        ${sqlString(link.link_type)},
        ${sqlString(link.created_at)}
      );
    `);
  }

  statements.push("COMMIT;");
  await runSql(statements.join("\n"));

  return getIndexSnapshot();
}

export async function getIndexSnapshot() {
  await initializeDatabase();
  const topics = await queryJson(`
    SELECT
      t.*,
      COALESCE((SELECT json_group_array(tag) FROM topic_tags tt WHERE tt.topic_id = t.id), '[]') AS tags_json
    FROM topics t
    ORDER BY updated_at DESC;
  `);
  const links = await queryJson(`
    SELECT from_topic_id, to_topic_id, link_type, created_at
    FROM topic_links
    ORDER BY created_at DESC;
  `);
  const sections = await queryJson(`
    SELECT id, topic_id, ord, heading, level, content
    FROM topic_sections
    ORDER BY topic_id, ord;
  `);
  const fetches = await queryJson(`
    SELECT *
    FROM source_fetches
    ORDER BY created_at DESC;
  `);

  return {
    generated_at: new Date().toISOString(),
    topics: topics.map((topic) => ({
      ...Object.fromEntries(Object.entries(topic).filter(([key]) => key !== "tags_json")),
      tags: safeParseJsonArray(topic.tags_json),
      pinned: Boolean(Number(topic.pinned))
    })),
    links,
    sections,
    fetches
  };
}

export async function buildGraph(filters = {}) {
  const where = buildTopicWhere(filters);
  const topics = await queryJson(`
    SELECT
      t.id, t.title, t.slug, t.layer, t.source_type,
      COALESCE((SELECT json_group_array(tag) FROM topic_tags tt WHERE tt.topic_id = t.id), '[]') AS tags_json
    FROM topics t
    ${where.sql}
    ORDER BY t.layer ASC, t.score DESC, t.updated_at DESC;
  `);

  const topicIds = topics.map((topic) => topic.id);
  const edges = topicIds.length
    ? await queryJson(`
        SELECT from_topic_id AS source, to_topic_id AS target,
               from_topic_id || ':' || to_topic_id AS id
        FROM topic_links
        WHERE from_topic_id IN (${topicIds.map(sqlString).join(", ")})
          AND to_topic_id IN (${topicIds.map(sqlString).join(", ")});
      `)
    : [];

  const columns = new Map([[1, []], [2, []], [3, []], [4, []]]);
  for (const topic of topics) {
    columns.get(Number(topic.layer))?.push(topic);
  }

  const nodes = [];
  for (const [layer, items] of columns.entries()) {
    items.forEach((topic, index) => {
      nodes.push({
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

  return { nodes, edges };
}

function buildTopicWhere(filters) {
  const clauses = [];
  if (filters.query) {
    const q = filters.query.toLowerCase();
    clauses.push(`(
      lower(t.title) LIKE '%' || ${sqlString(q)} || '%'
      OR lower(COALESCE(t.summary, '')) LIKE '%' || ${sqlString(q)} || '%'
      OR t.id IN (
        SELECT topic_id
        FROM topic_sections_fts
        WHERE topic_sections_fts MATCH ${sqlString(escapeFtsQuery(filters.query))}
      )
    )`);
  }
  if (filters.layers?.length) {
    clauses.push(`t.layer IN (${filters.layers.map((item) => sqlNumber(item)).join(", ")})`);
  }
  if (filters.sourceTypes?.length) {
    clauses.push(`t.source_type IN (${filters.sourceTypes.map(sqlString).join(", ")})`);
  }
  if (filters.tags?.length) {
    for (const tag of filters.tags) {
      clauses.push(`EXISTS (
        SELECT 1 FROM topic_tags tt
        WHERE tt.topic_id = t.id AND tt.tag = ${sqlString(tag)}
      )`);
    }
  }

  return {
    sql: clauses.length ? `WHERE ${clauses.join(" AND ")}` : ""
  };
}

function safeParseJsonArray(value) {
  try {
    return JSON.parse(value ?? "[]");
  } catch {
    return [];
  }
}

function escapeFtsQuery(query) {
  return query
    .trim()
    .split(/\s+/)
    .map((part) => `"${part.replace(/"/g, '""')}"`)
    .join(" ");
}

function canonicalizeUrl(url) {
  if (!url) {
    return null;
  }
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    const params = [...parsed.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    parsed.search = "";
    for (const [key, value] of params) {
      parsed.searchParams.append(key, value);
    }
    return parsed.toString();
  } catch {
    return url;
  }
}
