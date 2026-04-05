import crypto from "node:crypto";
import path from "node:path";
import { atomicWriteFile } from "./fs-utils.mjs";
import { initializeDatabase, queryJson, runSql, sqlString } from "./db.mjs";
import { INGEST_NORMALIZED_DIR, INGEST_RAW_DIR } from "./paths.mjs";
import { saveTopic } from "./store.mjs";
import { slugifyTitle } from "./topic-format.mjs";

export async function previewWebImport({ url }) {
  validateUrl(url);
  await initializeDatabase();
  const fetched = await fetchPage(url);
  const extraction = extractArticle(fetched.html, fetched.finalUrl);
  const duplicate = await findDuplicateTopic(fetched.finalUrl, extraction.hash);
  return {
    title: extraction.title,
    siteName: extraction.siteName,
    extractedMarkdown: extraction.markdown,
    summary: extraction.summary,
    duplicateTopicId: duplicate?.id ?? null
  };
}

export async function importWebPage({
  url,
  mode = "create",
  saveRawHtml = true,
  saveNormalizedArtifacts = true
}) {
  validateUrl(url);
  await initializeDatabase();
  const fetched = await fetchPage(url);
  const extraction = extractArticle(fetched.html, fetched.finalUrl);
  const duplicate = await findDuplicateTopic(fetched.finalUrl, extraction.hash);

  if (duplicate && mode === "create") {
    return {
      topicId: duplicate.id,
      path: duplicate.path,
      status: "duplicate",
      sourceUrl: extraction.canonicalUrl,
      title: duplicate.title
    };
  }

  const now = new Date().toISOString();
  const slugBase = slugifyTitle(`${extraction.siteName}-${extraction.title}`);
  const body = buildWebTopicBody(extraction, now);
  const existingFrontmatter = duplicate && mode === "update-if-exists"
    ? { id: duplicate.id, slug: duplicate.slug, created_at: duplicate.created_at }
    : undefined;
  const saved = await saveTopic({
    frontmatter: {
      ...existingFrontmatter,
      title: extraction.title,
      slug: existingFrontmatter?.slug ?? slugBase,
      summary: extraction.summary,
      tags: extraction.tags,
      source_type: "web",
      source_url: extraction.canonicalUrl,
      site_name: extraction.siteName,
      source_hash: extraction.hash,
      fetched_at: now,
      author: extraction.author
    },
    body
  });

  const rawPath = saveRawHtml ? path.join(INGEST_RAW_DIR, `${saved.slug}.html`) : null;
  const normalizedPath = saveNormalizedArtifacts
    ? path.join(INGEST_NORMALIZED_DIR, `${saved.slug}.md`)
    : null;
  if (rawPath) {
    await atomicWriteFile(rawPath, fetched.html);
  }
  if (normalizedPath) {
    await atomicWriteFile(normalizedPath, extraction.markdown);
  }

  await runSql(`
    INSERT INTO source_fetches (
      id, source_type, source_url, canonical_url, site_name, request_url, final_url,
      status, http_status, content_type, raw_path, normalized_path, extracted_title,
      extracted_author, extracted_summary, source_hash, error_message, created_at
    ) VALUES (
      ${sqlString(crypto.randomUUID())},
      'web',
      ${sqlString(url)},
      ${sqlString(extraction.canonicalUrl)},
      ${sqlString(extraction.siteName)},
      ${sqlString(url)},
      ${sqlString(fetched.finalUrl)},
      ${sqlString(duplicate && mode === "update-if-exists" ? "updated" : "created")},
      ${sqlString(fetched.status)},
      ${sqlString(fetched.contentType)},
      ${sqlString(rawPath)},
      ${sqlString(normalizedPath)},
      ${sqlString(extraction.title)},
      ${sqlString(extraction.author)},
      ${sqlString(extraction.summary)},
      ${sqlString(extraction.hash)},
      NULL,
      ${sqlString(now)}
    );
  `);

  return {
    topicId: saved.id,
    path: saved.path,
    status: duplicate && mode === "update-if-exists" ? "updated" : "created",
    sourceUrl: extraction.canonicalUrl,
    title: extraction.title
  };
}

function validateUrl(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http/https URLs are supported");
  }
}

async function fetchPage(url) {
  const response = await fetch(url, {
    headers: {
      "user-agent": "Kirevo/0.2"
    }
  });
  const html = await response.text();
  return {
    finalUrl: response.url,
    html,
    status: response.status,
    contentType: response.headers.get("content-type")
  };
}

function extractArticle(html, finalUrl) {
  const canonicalUrl = canonicalizeUrl(extractMetaContent(html, "og:url") || finalUrl);
  const siteName = decodeHtmlEntities(
    extractMetaContent(html, "og:site_name") || hostnameLabel(canonicalUrl)
  );
  const title = decodeHtmlEntities(
    extractMetaContent(html, "og:title") ||
    extractMetaContent(html, "twitter:title") ||
    matchHeading(bestContentRoot(html)) ||
    matchTag(html, "title") ||
    hostnameLabel(canonicalUrl)
  ).trim();
  const author = decodeHtmlEntities(
    extractMetaContent(html, "author") ||
    extractMetaContent(html, "article:author") ||
    ""
  ) || null;
  const root = bestContentRoot(html);
  const markdown = htmlToMarkdown(root, canonicalUrl);
  const summary = decodeHtmlEntities(
    extractMetaContent(html, "description") ||
    extractMetaContent(html, "og:description") ||
    summarizeMarkdown(markdown)
  ).trim();
  const hash = `sha256:${crypto.createHash("sha256").update(markdown).digest("hex")}`;

  return {
    canonicalUrl,
    siteName,
    title: title || "Imported Web Topic",
    author,
    markdown: markdown || "Content extraction failed. Source metadata retained.",
    summary: summary || summarizeMarkdown(markdown),
    tags: buildTags(canonicalUrl, title, siteName),
    hash
  };
}

function buildWebTopicBody(extraction, fetchedAt) {
  const insights = buildInsights(extraction.markdown);
  return [
    `# ${extraction.title}`,
    "",
    "## Source",
    `- URL: ${extraction.canonicalUrl}`,
    `- Site: ${extraction.siteName}`,
    `- Fetched At: ${fetchedAt}`,
    extraction.author ? `- Author: ${extraction.author}` : null,
    "",
    "## Summary",
    extraction.summary,
    "",
    "## Content",
    extraction.markdown.trim(),
    "",
    "## Extracted Insights",
    ...insights.map((item) => `- ${item}`)
  ].filter(Boolean).join("\n");
}

async function findDuplicateTopic(url, hash) {
  const canonicalUrl = canonicalizeUrl(url);
  const rows = await queryJson(`
    SELECT id, slug, title, path, created_at
    FROM topics
    WHERE canonical_url = ${sqlString(canonicalUrl)}
       OR source_url = ${sqlString(canonicalUrl)}
       OR source_hash = ${sqlString(hash)}
    ORDER BY updated_at DESC
    LIMIT 1;
  `);
  return rows[0] ?? null;
}

function bestContentRoot(html) {
  const cleaned = stripNonContent(html);
  const candidates = ["article", "main", "[role=\"main\"]", ".content", ".post", ".entry-content"];
  for (const selector of candidates) {
    const block = extractSelectorBlock(cleaned, selector);
    if (block && stripTags(block).trim().length > 120) {
      return block;
    }
  }
  const body = matchTag(cleaned, "body");
  return body || cleaned;
}

function extractSelectorBlock(html, selector) {
  if (selector.startsWith(".")) {
    const className = selector.slice(1).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`<([a-z0-9]+)[^>]*class=["'][^"']*${className}[^"']*["'][^>]*>([\\s\\S]*?)<\\/\\1>`, "i");
    const match = regex.exec(html);
    return match ? match[0] : "";
  }
  if (selector.startsWith("[")) {
    const regex = /<([a-z0-9]+)[^>]*role=["']main["'][^>]*>([\s\S]*?)<\/\1>/i;
    const match = regex.exec(html);
    return match ? match[0] : "";
  }
  return matchTagWithWrapper(html, selector);
}

function matchTagWithWrapper(html, tagName) {
  const regex = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = regex.exec(html);
  return match ? match[0] : "";
}

function htmlToMarkdown(html, baseUrl) {
  const withProtectedCode = html.replace(/<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/gi, (_, code) => {
    return `\nKIREVO_CODE_BLOCK_START\n${escapeFence(decodeHtmlEntities(stripTags(code)).trim())}\nKIREVO_CODE_BLOCK_END\n`;
  });

  const normalized = withProtectedCode
    .replace(/<(h[1-6])[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, content) => {
      return `\n${"#".repeat(Number(tag.slice(1)))} ${inlineText(content, baseUrl)}\n`;
    })
    .replace(/<(ul|ol)[^>]*>([\s\S]*?)<\/\1>/gi, (_, tag, content) => {
      const items = [...content.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)];
      return `\n${items.map((item, index) => `${tag === "ol" ? `${index + 1}.` : "-"} ${inlineText(item[1], baseUrl)}`).join("\n")}\n`;
    })
    .replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, content) => {
      return `\n> ${inlineText(content, baseUrl)}\n`;
    })
    .replace(/<(p|div|section|article|main)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, content) => {
      return `\n${inlineText(content, baseUrl)}\n`;
    })
    .replace(/<br\s*\/?>/gi, "\n");

  return decodeHtmlEntities(stripTags(normalized))
    .replace(/KIREVO_CODE_BLOCK_START\n([\s\S]*?)\nKIREVO_CODE_BLOCK_END/g, (_, code) => `\n\`\`\`\n${code}\n\`\`\`\n`)
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function inlineText(content, baseUrl) {
  return content
    .replace(/<a[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href, label) => {
      const absolute = toAbsoluteUrl(baseUrl, href);
      return `[${decodeHtmlEntities(stripTags(label)).trim() || absolute}](${absolute})`;
    })
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, text) => `**${decodeHtmlEntities(stripTags(text)).trim()}**`)
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/\1>/gi, (_, __, text) => `*${decodeHtmlEntities(stripTags(text)).trim()}*`)
    .replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, text) => `\`${decodeHtmlEntities(stripTags(text)).trim()}\``);
}

function stripNonContent(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<svg[\s\S]*?<\/svg>/gi, " ")
    .replace(/<nav[\s\S]*?<\/nav>/gi, " ")
    .replace(/<aside[\s\S]*?<\/aside>/gi, " ")
    .replace(/<footer[\s\S]*?<\/footer>/gi, " ")
    .replace(/<header[\s\S]*?<\/header>/gi, " ")
    .replace(/<form[\s\S]*?<\/form>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
}

function stripTags(value) {
  return value.replace(/<[^>]+>/g, " ");
}

function matchTag(html, tagName) {
  const match = new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(html);
  return match ? match[1].trim() : "";
}

function matchHeading(html) {
  const match = /<h1[^>]*>([\s\S]*?)<\/h1>/i.exec(html);
  return match ? stripTags(match[1]).trim() : "";
}

function extractMetaContent(html, name) {
  const regex = new RegExp(`<meta[^>]+(?:name|property)=["']${name}["'][^>]+content=["']([^"]+)["'][^>]*>`, "i");
  const match = regex.exec(html);
  return match ? match[1].trim() : "";
}

function decodeHtmlEntities(value) {
  return `${value || ""}`
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ");
}

function canonicalizeUrl(url) {
  const parsed = new URL(url);
  parsed.hash = "";
  const sorted = [...parsed.searchParams.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  parsed.search = "";
  for (const [key, value] of sorted) {
    parsed.searchParams.append(key, value);
  }
  return parsed.toString();
}

function hostnameLabel(url) {
  const hostname = new URL(url).hostname.replace(/^www\./, "");
  return hostname.split(".").slice(0, -1).join(".") || hostname;
}

function toAbsoluteUrl(baseUrl, href) {
  try {
    return new URL(href, baseUrl).toString();
  } catch {
    return href;
  }
}

function summarizeMarkdown(markdown) {
  return markdown.replace(/\s+/g, " ").trim().slice(0, 180);
}

function buildInsights(markdown) {
  const lines = markdown
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !line.startsWith("#"))
    .slice(0, 3);
  return lines.length ? lines : ["Imported for later review."];
}

function buildTags(url, title, siteName) {
  const candidates = [
    hostnameLabel(url),
    siteName,
    ...`${title}`.toLowerCase().split(/[^a-z0-9]+/g)
  ];
  return [...new Set(candidates.map((item) => `${item}`.trim().toLowerCase()).filter(Boolean))].slice(0, 6);
}

function escapeFence(code) {
  return code.replace(/```/g, "``");
}
