const state = {
  topics: [],
  selectedTopicId: null,
  graph: { nodes: [], edges: [] }
};

const elements = {
  topicList: document.querySelector("#topic-list"),
  graphCanvas: document.querySelector("#graph-canvas"),
  searchInput: document.querySelector("#search-input"),
  tagFilterInput: document.querySelector("#tag-filter-input"),
  layerFilter: document.querySelector("#layer-filter"),
  sourceFilter: document.querySelector("#source-filter"),
  titleInput: document.querySelector("#title-input"),
  slugInput: document.querySelector("#slug-input"),
  summaryInput: document.querySelector("#summary-input"),
  tagsInput: document.querySelector("#tags-input"),
  pinnedInput: document.querySelector("#pinned-input"),
  manualLayerInput: document.querySelector("#manual-layer-input"),
  bodyInput: document.querySelector("#body-input"),
  metadataList: document.querySelector("#metadata-list"),
  backlinksList: document.querySelector("#backlinks-list"),
  missingLinksList: document.querySelector("#missing-links-list"),
  contextPanel: document.querySelector("#context-panel"),
  editorTitle: document.querySelector("#editor-title"),
  importUrlInput: document.querySelector("#import-url-input"),
  importModeSelect: document.querySelector("#import-mode-select"),
  importPreview: document.querySelector("#import-preview"),
  topicCount: document.querySelector("#topic-count"),
  activeLayerStat: document.querySelector("#active-layer-stat"),
  runtimeBadge: document.querySelector("#runtime-badge"),
  topicListCaption: document.querySelector("#topic-list-caption")
};

document.querySelector("#new-topic-button").addEventListener("click", () => {
  state.selectedTopicId = null;
  loadEditor({
    frontmatter: {
      id: "",
      title: "Untitled Topic",
      slug: "",
      summary: "",
      tags: [],
      pinned: false,
      manual_layer: ""
    },
    body: "# Untitled Topic\n\n## Summary\n"
  });
});

document.querySelector("#save-button").addEventListener("click", saveCurrentTopic);
document.querySelector("#delete-button").addEventListener("click", deleteCurrentTopic);
document.querySelector("#reindex-button").addEventListener("click", async () => {
  await fetchJson("/api/reindex", { method: "POST" });
  await refresh();
});
document.querySelector("#preview-import-button").addEventListener("click", previewImport);
document.querySelector("#run-import-button").addEventListener("click", runImport);

for (const element of [
  elements.searchInput,
  elements.tagFilterInput,
  elements.layerFilter,
  elements.sourceFilter
]) {
  element.addEventListener("input", refresh);
  element.addEventListener("change", refresh);
}

elements.titleInput.addEventListener("input", () => {
  elements.editorTitle.textContent = elements.titleInput.value || "Untitled Topic";
});

await refresh();
syncRuntimeBadge();

async function refresh() {
  const queryString = buildFilterQuery();
  const topicsResponse = await fetchJson(`/api/topics?${queryString}`);
  state.topics = topicsResponse.items;
  renderSummaryStats();
  renderTopicList();

  state.graph = await fetchJson(`/api/graph?${queryString}`);
  renderGraph();

  if (state.selectedTopicId) {
    const selectedStillExists = state.topics.some((topic) => topic.id === state.selectedTopicId);
    if (selectedStillExists) {
      await selectTopic(state.selectedTopicId);
      return;
    }
  }

  if (state.topics[0]) {
    await selectTopic(state.topics[0].id);
  } else {
    state.selectedTopicId = null;
    loadEditor({
      frontmatter: { title: "Untitled Topic", tags: [], pinned: false, manual_layer: "" },
      body: ""
    });
  }
}

function renderSummaryStats() {
  elements.topicCount.textContent = String(state.topics.length);
  const minLayer = state.topics.reduce((acc, topic) => Math.min(acc, Number(topic.layer || 4)), 4);
  elements.activeLayerStat.textContent = `L${minLayer || 4}`;
  elements.topicListCaption.textContent = state.topics.length
    ? `${state.topics.length} visible topics`
    : "No topics match current filters";
}

async function selectTopic(topicId) {
  state.selectedTopicId = topicId;
  renderTopicList();
  const topic = await fetchJson(`/api/topics/${encodeURIComponent(topicId)}`);
  loadEditor(topic);
  const context = await fetchJson(`/api/context?topicId=${encodeURIComponent(topicId)}`);
  elements.contextPanel.textContent = JSON.stringify(context, null, 2);
}

function loadEditor(topic) {
  const frontmatter = topic.frontmatter ?? {};
  elements.titleInput.value = frontmatter.title ?? "";
  elements.slugInput.value = frontmatter.slug ?? "";
  elements.summaryInput.value = frontmatter.summary ?? "";
  elements.tagsInput.value = Array.isArray(frontmatter.tags) ? frontmatter.tags.join(", ") : "";
  elements.pinnedInput.checked = Boolean(frontmatter.pinned);
  elements.manualLayerInput.value = frontmatter.manual_layer ?? "";
  elements.bodyInput.value = topic.body ?? "";
  elements.editorTitle.textContent = frontmatter.title ?? "Untitled Topic";

  renderMetadata(topic.metadata ?? frontmatter);
  renderBacklinks(topic.backlinks ?? []);
  renderMissingLinks(topic.unresolvedLinks ?? []);
}

function renderMetadata(metadata) {
  elements.metadataList.innerHTML = "";
  const rows = {
    id: metadata.id,
    slug: metadata.slug,
    layer: metadata.layer,
    manual_layer: metadata.manual_layer,
    source_type: metadata.source_type,
    updated_at: metadata.updated_at,
    read_count: metadata.read_count,
    write_count: metadata.write_count,
    inbound: metadata.inbound_link_count,
    outbound: metadata.outbound_link_count
  };
  for (const [key, value] of Object.entries(rows)) {
    const dt = document.createElement("dt");
    dt.textContent = key;
    const dd = document.createElement("dd");
    dd.textContent = value ?? "-";
    elements.metadataList.append(dt, dd);
  }
}

function renderBacklinks(backlinks) {
  elements.backlinksList.innerHTML = "";
  for (const backlink of backlinks) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.className = "ghost-button";
    button.textContent = backlink.title;
    button.addEventListener("click", () => selectTopic(backlink.id));
    item.append(button);
    elements.backlinksList.append(item);
  }
}

function renderMissingLinks(links) {
  elements.missingLinksList.innerHTML = "";
  for (const link of links) {
    const item = document.createElement("li");
    item.className = "inline-action";
    const text = document.createElement("span");
    text.textContent = link.target;
    const button = document.createElement("button");
    button.className = "ghost-button";
    button.textContent = "Create";
    button.addEventListener("click", async () => {
      const result = await fetchJson("/api/topics/create-from-link", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ sourceTopicId: state.selectedTopicId, target: link.target })
      });
      await refresh();
      if (result.id) {
        await selectTopic(result.id);
      }
    });
    item.append(text, button);
    elements.missingLinksList.append(item);
  }
}

function renderTopicList() {
  elements.topicList.innerHTML = "";
  for (const topic of state.topics) {
    const card = document.createElement("button");
    card.className = `topic-item ${topic.id === state.selectedTopicId ? "is-active" : ""}`;
    card.addEventListener("click", () => selectTopic(topic.id));
    card.innerHTML = `
      <h3>${escapeHtml(topic.title)}</h3>
      <p>${escapeHtml(topic.summary ?? "")}</p>
      <div class="topic-meta-row">
        <span class="badge layer-${topic.layer}">L${topic.layer}</span>
        <span class="badge">${escapeHtml(topic.source_type)}</span>
        <span class="badge">${escapeHtml(topic.slug)}</span>
      </div>
    `;
    elements.topicList.append(card);
  }
}

function renderGraph() {
  const svg = elements.graphCanvas;
  svg.innerHTML = "";
  const nodeById = new Map(state.graph.nodes.map((node) => [node.id, node]));
  const selectedId = state.selectedTopicId;

  renderGraphBackdrop(svg);

  for (const edge of state.graph.edges) {
    const from = nodeById.get(edge.source);
    const to = nodeById.get(edge.target);
    if (!from || !to) continue;
    const isConnected = selectedId && (edge.source === selectedId || edge.target === selectedId);
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    const startX = from.x + 78;
    const startY = from.y;
    const endX = to.x - 78;
    const endY = to.y;
    const controlX = startX + (endX - startX) / 2;
    path.setAttribute(
      "d",
      `M ${startX} ${startY} C ${controlX} ${startY}, ${controlX} ${endY}, ${endX} ${endY}`
    );
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", isConnected ? "rgba(181, 84, 54, 0.42)" : "rgba(88, 67, 44, 0.16)");
    path.setAttribute("stroke-width", isConnected ? "2.4" : "1.6");
    path.setAttribute("stroke-linecap", "round");
    svg.append(path);

    const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    marker.setAttribute("cx", endX);
    marker.setAttribute("cy", endY);
    marker.setAttribute("r", isConnected ? "3.2" : "2.4");
    marker.setAttribute("fill", isConnected ? "rgba(181, 84, 54, 0.75)" : "rgba(88, 67, 44, 0.28)");
    svg.append(marker);
  }

  for (const node of state.graph.nodes) {
    const group = document.createElementNS("http://www.w3.org/2000/svg", "g");
    group.style.cursor = "pointer";
    group.addEventListener("click", () => selectTopic(node.id));
    const isSelected = node.id === selectedId;
    const cardWidth = 154;
    const cardHeight = 72;
    const left = node.x - cardWidth / 2;
    const top = node.y - cardHeight / 2;

    if (isSelected) {
      const glow = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      glow.setAttribute("x", left - 6);
      glow.setAttribute("y", top - 6);
      glow.setAttribute("width", cardWidth + 12);
      glow.setAttribute("height", cardHeight + 12);
      glow.setAttribute("rx", "24");
      glow.setAttribute("fill", "rgba(181, 84, 54, 0.08)");
      group.append(glow);
    }

    const shadow = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    shadow.setAttribute("x", left);
    shadow.setAttribute("y", top + 4);
    shadow.setAttribute("width", cardWidth);
    shadow.setAttribute("height", cardHeight);
    shadow.setAttribute("rx", "20");
    shadow.setAttribute("fill", "rgba(76, 48, 21, 0.08)");
    group.append(shadow);

    const card = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    card.setAttribute("x", left);
    card.setAttribute("y", top);
    card.setAttribute("width", cardWidth);
    card.setAttribute("height", cardHeight);
    card.setAttribute("rx", "20");
    card.setAttribute("fill", "rgba(255, 251, 245, 0.96)");
    card.setAttribute("stroke", isSelected ? "rgba(181, 84, 54, 0.68)" : "rgba(101, 74, 46, 0.12)");
    card.setAttribute("stroke-width", isSelected ? "2.2" : "1.4");
    group.append(card);

    const layerBand = document.createElementNS("http://www.w3.org/2000/svg", "rect");
    layerBand.setAttribute("x", left + 10);
    layerBand.setAttribute("y", top + 10);
    layerBand.setAttribute("width", "46");
    layerBand.setAttribute("height", "16");
    layerBand.setAttribute("rx", "8");
    layerBand.setAttribute("fill", layerTint(node.layer));
    group.append(layerBand);

    const layerText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    layerText.setAttribute("x", left + 20);
    layerText.setAttribute("y", top + 21.5);
    layerText.setAttribute("font-size", "10");
    layerText.setAttribute("font-weight", "700");
    layerText.setAttribute("letter-spacing", "0.12em");
    layerText.setAttribute("fill", layerColor(node.layer));
    layerText.textContent = `L${node.layer}`;
    group.append(layerText);

    const sourceText = document.createElementNS("http://www.w3.org/2000/svg", "text");
    sourceText.setAttribute("x", left + cardWidth - 12);
    sourceText.setAttribute("y", top + 22);
    sourceText.setAttribute("text-anchor", "end");
    sourceText.setAttribute("font-size", "10");
    sourceText.setAttribute("letter-spacing", "0.08em");
    sourceText.setAttribute("fill", node.sourceType === "web" ? "#546b86" : "#655946");
    sourceText.textContent = node.sourceType.toUpperCase();
    group.append(sourceText);

    const title = document.createElementNS("http://www.w3.org/2000/svg", "text");
    title.setAttribute("x", left + 14);
    title.setAttribute("y", top + 46);
    title.setAttribute("font-size", "14");
    title.setAttribute("font-weight", "600");
    title.setAttribute("fill", "#211910");
    title.textContent = truncate(node.label, 20);
    group.append(title);

    const slug = document.createElementNS("http://www.w3.org/2000/svg", "text");
    slug.setAttribute("x", left + 14);
    slug.setAttribute("y", top + 62);
    slug.setAttribute("font-size", "11");
    slug.setAttribute("fill", "rgba(101, 89, 70, 0.86)");
    slug.textContent = truncate(node.slug, 24);
    group.append(slug);

    svg.append(group);
  }
}

async function saveCurrentTopic() {
  const payload = {
    frontmatter: {
      id: state.selectedTopicId || undefined,
      title: elements.titleInput.value.trim(),
      slug: elements.slugInput.value.trim(),
      summary: elements.summaryInput.value.trim(),
      tags: elements.tagsInput.value,
      pinned: elements.pinnedInput.checked,
      manual_layer: elements.manualLayerInput.value || null
    },
    body: elements.bodyInput.value
  };
  const saved = await fetchJson("/api/topics", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
  state.selectedTopicId = saved.id;
  await refresh();
}

async function deleteCurrentTopic() {
  if (!state.selectedTopicId) return;
  await fetchJson(`/api/topics/${encodeURIComponent(state.selectedTopicId)}`, { method: "DELETE" });
  state.selectedTopicId = null;
  await refresh();
}

async function previewImport() {
  const url = elements.importUrlInput.value.trim();
  if (!url) return;
  const preview = await fetchJson("/api/import/preview", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ url })
  });
  elements.importPreview.textContent = JSON.stringify(preview, null, 2);
}

async function runImport() {
  const url = elements.importUrlInput.value.trim();
  if (!url) return;
  const result = await fetchJson("/api/import", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      url,
      mode: elements.importModeSelect.value
    })
  });
  elements.importPreview.textContent = JSON.stringify(result, null, 2);
  await refresh();
  if (result.topicId) {
    await selectTopic(result.topicId);
  }
}

function buildFilterQuery() {
  const params = new URLSearchParams();
  if (elements.searchInput.value.trim()) {
    params.set("query", elements.searchInput.value.trim());
  }
  const selectedLayers = selectedValues(elements.layerFilter);
  if (selectedLayers.length) {
    params.set("layers", selectedLayers.join(","));
  }
  const selectedSources = selectedValues(elements.sourceFilter);
  if (selectedSources.length) {
    params.set("sourceTypes", selectedSources.join(","));
  }
  const tags = elements.tagFilterInput.value.split(",").map((item) => item.trim()).filter(Boolean);
  if (tags.length) {
    params.set("tags", tags.join(","));
  }
  return params.toString();
}

function selectedValues(select) {
  return [...select.selectedOptions].map((option) => option.value).filter(Boolean);
}

async function fetchJson(url, options) {
  const response = await fetch(url, options);
  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.error || "Request failed");
  }
  return json;
}

function escapeHtml(value) {
  return `${value}`.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function layerColor(layer) {
  if (layer === 1) return "#c84d31";
  if (layer === 2) return "#df8f38";
  if (layer === 3) return "#7d9663";
  return "#7a7f96";
}

function layerTint(layer) {
  if (layer === 1) return "rgba(196, 76, 46, 0.12)";
  if (layer === 2) return "rgba(215, 139, 42, 0.14)";
  if (layer === 3) return "rgba(105, 131, 93, 0.14)";
  return "rgba(120, 131, 154, 0.14)";
}

function truncate(value, length) {
  const stringValue = `${value}`;
  return stringValue.length > length ? `${stringValue.slice(0, length - 1)}…` : stringValue;
}

function renderGraphBackdrop(svg) {
  const layerLabels = [
    { layer: 1, x: 116, label: "L1 Active Context" },
    { layer: 2, x: 336, label: "L2 Working Memory" },
    { layer: 3, x: 556, label: "L3 Reference Memory" },
    { layer: 4, x: 776, label: "L4 Archive" }
  ];

  for (const item of layerLabels) {
    const text = document.createElementNS("http://www.w3.org/2000/svg", "text");
    text.setAttribute("x", item.x);
    text.setAttribute("y", "34");
    text.setAttribute("font-size", "12");
    text.setAttribute("letter-spacing", "0.12em");
    text.setAttribute("fill", layerColor(item.layer));
    text.textContent = item.label.toUpperCase();
    svg.append(text);
  }
}

function syncRuntimeBadge() {
  const runtime = window.kirevoDesktop?.runtime === "electron" ? "Desktop" : "Web";
  elements.runtimeBadge.textContent = runtime;
}
