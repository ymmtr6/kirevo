import http from "node:http";
import nodeFs from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildGraph, rebuildIndex } from "./lib/indexer.mjs";
import {
  createMissingTopic,
  deleteTopic,
  initializeStore,
  listTopics,
  readTopic,
  readTopicContext,
  saveTopic
} from "./lib/store.mjs";
import { importWebPage, previewWebImport } from "./lib/web-import.mjs";
import { TOPICS_DIR } from "./lib/paths.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, "..", "public");

export async function startAppServer({ port = 4312, host = "127.0.0.1", quiet = false } = {}) {
  await initializeStore();
  await rebuildIndex();

  const server = http.createServer(async (req, res) => {
    try {
      if (req.url.startsWith("/api/")) {
        await handleApi(req, res);
        return;
      }
      await serveStatic(req, res);
    } catch (error) {
      sendJson(res, 500, { error: error.message });
    }
  });

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => {
      server.off("error", reject);
      resolve();
    });
  });

  const address = server.address();
  const resolvedPort =
    address && typeof address === "object" && "port" in address ? address.port : port;

  if (!quiet) {
    console.log(`Kirevo running at http://${host}:${resolvedPort}`);
  }

  let watchTimer = null;
  const watcher = nodeFs.watch(TOPICS_DIR, () => {
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      rebuildIndex().catch((error) => {
        console.error("Reindex failed", error);
      });
    }, 120);
  });

  return {
    port: resolvedPort,
    host,
    url: `http://${host}:${resolvedPort}`,
    server,
    close: async () => {
      watcher.close();
      await new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      });
    }
  };
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === "GET" && url.pathname === "/api/topics") {
    const tags = url.searchParams.get("tags")?.split(",").map((item) => item.trim()).filter(Boolean);
    const layers = url.searchParams.get("layers")?.split(",").map(Number).filter(Boolean);
    const sourceTypes = url.searchParams.get("sourceTypes")?.split(",").map((item) => item.trim()).filter(Boolean);
    const result = await listTopics({
      query: url.searchParams.get("query") ?? undefined,
      tags,
      layer: layers,
      sourceType: sourceTypes
    });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname.startsWith("/api/topics/")) {
    const topicId = decodeURIComponent(url.pathname.split("/").pop());
    const result = await readTopic(topicId);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/topics") {
    const body = await readBody(req);
    const result = await saveTopic(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/topics/")) {
    const topicId = decodeURIComponent(url.pathname.split("/").pop());
    const result = await deleteTopic(topicId);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/graph") {
    const graph = await buildGraph({
      query: url.searchParams.get("query") ?? undefined,
      tags: url.searchParams.get("tags")?.split(",").map((item) => item.trim()).filter(Boolean),
      layers: url.searchParams.get("layers")?.split(",").map(Number).filter(Boolean),
      sourceTypes: url.searchParams.get("sourceTypes")?.split(",").map((item) => item.trim()).filter(Boolean)
    });
    sendJson(res, 200, graph);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/context") {
    const topicId = url.searchParams.get("topicId");
    const result = await readTopicContext({ topicId });
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/preview") {
    const body = await readBody(req);
    const result = await previewWebImport(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const body = await readBody(req);
    const result = await importWebPage(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/topics/create-from-link") {
    const body = await readBody(req);
    const result = await createMissingTopic(body);
    sendJson(res, 200, result);
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/reindex") {
    const result = await rebuildIndex();
    sendJson(res, 200, { generated_at: result.generated_at, topics: result.topics.length });
    return;
  }

  sendJson(res, 404, { error: "Not found" });
}

async function serveStatic(req, res) {
  let requestPath = req.url === "/" ? "/index.html" : req.url;
  requestPath = requestPath.split("?")[0];
  const targetPath = path.join(PUBLIC_DIR, requestPath);

  if (!targetPath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 403, { error: "Forbidden" });
    return;
  }

  try {
    const content = await fs.readFile(targetPath);
    res.writeHead(200, { "content-type": contentTypeFor(targetPath) });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: "Not found" });
  }
}

function sendJson(res, statusCode, body) {
  res.writeHead(statusCode, {
    "content-type": "application/json; charset=utf-8"
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      try {
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve(raw ? JSON.parse(raw) : {});
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function contentTypeFor(filePath) {
  if (filePath.endsWith(".html")) {
    return "text/html; charset=utf-8";
  }
  if (filePath.endsWith(".js")) {
    return "text/javascript; charset=utf-8";
  }
  if (filePath.endsWith(".css")) {
    return "text/css; charset=utf-8";
  }
  return "text/plain; charset=utf-8";
}
