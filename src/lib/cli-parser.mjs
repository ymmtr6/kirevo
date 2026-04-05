export function parseCliArgs(argv) {
  const positionals = [];
  const flags = {};

  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      positionals.push(token);
      continue;
    }

    const eqIndex = token.indexOf("=");
    if (eqIndex !== -1) {
      const key = normalizeFlag(token.slice(2, eqIndex));
      const value = token.slice(eqIndex + 1);
      pushFlagValue(flags, key, value);
      continue;
    }

    const key = normalizeFlag(token.slice(2));
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      pushFlagValue(flags, key, true);
      continue;
    }

    pushFlagValue(flags, key, next);
    index += 1;
  }

  return { positionals, flags };
}

export function getFlag(flags, name, fallback = undefined) {
  const value = flags[normalizeFlag(name)];
  if (Array.isArray(value)) {
    return value[value.length - 1] ?? fallback;
  }
  return value ?? fallback;
}

export function getFlagList(flags, name) {
  const value = flags[normalizeFlag(name)];
  if (value === undefined) {
    return [];
  }
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => `${item}`.split(","))
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeFlag(value) {
  return value.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
}

function pushFlagValue(flags, key, value) {
  if (!(key in flags)) {
    flags[key] = value;
    return;
  }
  if (!Array.isArray(flags[key])) {
    flags[key] = [flags[key]];
  }
  flags[key].push(value);
}
