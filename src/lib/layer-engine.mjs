export function computeRecencyScore(dateValue) {
  if (!dateValue) {
    return 0;
  }
  const date = new Date(dateValue);
  if (Number.isNaN(date.valueOf())) {
    return 0;
  }
  const ageDays = (Date.now() - date.valueOf()) / (1000 * 60 * 60 * 24);
  return 1 / (1 + Math.max(ageDays, 0));
}

export function computeTopicScore(topic) {
  const pinnedBonus = topic.pinned ? 1 : 0;
  return (
    computeRecencyScore(topic.updated_at) * 0.25 +
    computeRecencyScore(topic.last_read_at) * 0.25 +
    Math.log1p(topic.read_count ?? 0) * 0.2 +
    Math.log1p(topic.inbound_link_count ?? 0) * 0.15 +
    Math.log1p(topic.outbound_link_count ?? 0) * 0.05 +
    pinnedBonus * 0.1
  );
}

export function assignLayers(topics) {
  const sorted = [...topics].sort((a, b) => b.score - a.score);
  const total = sorted.length;

  return sorted.map((topic, index) => {
    if (topic.manual_layer) {
      return { ...topic, layer: topic.manual_layer };
    }

    const percentile = total <= 1 ? 1 : index / total;
    let layer = 4;
    if (percentile < 0.1) {
      layer = 1;
    } else if (percentile < 0.3) {
      layer = 2;
    } else if (percentile < 0.6) {
      layer = 3;
    }

    if (total < 4) {
      if (index === 0) {
        layer = 1;
      } else if (index === 1) {
        layer = 2;
      } else if (index === 2) {
        layer = 3;
      } else {
        layer = 4;
      }
    }

    return { ...topic, layer };
  });
}
