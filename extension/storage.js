/**
 * Shared storage / migration / matching logic used by both popup.html and
 * options.html.
 *
 * Storage shape (v3, server address travels with the channel):
 *   channelsV2: {
 *     [channelId]: { label, serverUrl, channelName, channelKey }
 *   }
 *   defaultChannelId: string          which channel is used by default
 *   rulesV2: [{ pattern: "jd.com", channelId: "..." }]   site rules, matched by domain suffix
 *
 * Channel IDs are randomly generated locally and have nothing to do with the
 * channel name itself — different servers can easily have channels that
 * share the same name, so the name alone can't be a unique key.
 */

function genId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'ch_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}

// Migrate older extension data formats so nothing gets lost:
//  - earliest version: a single serverUrl / channelName / channelKey
//  - previous version: multiple channels{name:key} sharing one serverUrl,
//    plus rules[{pattern,channel}]
//  - this version: every channel carries its own serverUrl
async function migrateIfNeeded() {
  const data = await chrome.storage.local.get([
    'channelsV2', 'defaultChannelId', 'rulesV2',
    'channels', 'serverUrl', 'defaultChannel', 'rules',
    'channelName', 'channelKey',
  ]);
  if (data.channelsV2) return; // already on the latest format

  const channelsV2 = {};
  const idByOldName = {};

  if (data.channels) {
    // previous version: multiple channels sharing one serverUrl
    const serverUrl = data.serverUrl || '';
    for (const [name, key] of Object.entries(data.channels)) {
      const id = genId();
      channelsV2[id] = { label: name, serverUrl, channelName: name, channelKey: key };
      idByOldName[name] = id;
    }
  } else if (data.channelName && data.channelKey) {
    // earliest version: a single channel
    const id = genId();
    channelsV2[id] = {
      label: data.channelName,
      serverUrl: data.serverUrl || '',
      channelName: data.channelName,
      channelKey: data.channelKey,
    };
    idByOldName[data.channelName] = id;
  }

  let defaultChannelId = '';
  if (data.defaultChannel && idByOldName[data.defaultChannel]) {
    defaultChannelId = idByOldName[data.defaultChannel];
  } else {
    defaultChannelId = Object.keys(channelsV2)[0] || '';
  }

  const rulesV2 = (data.rules || [])
    .filter(r => idByOldName[r.channel])
    .map(r => ({ pattern: r.pattern, channelId: idByOldName[r.channel] }));

  await chrome.storage.local.set({ channelsV2, defaultChannelId, rulesV2 });
}

async function getFullConfig() {
  await migrateIfNeeded();
  const cfg = await chrome.storage.local.get(['channelsV2', 'defaultChannelId', 'rulesV2']);
  return {
    channels: cfg.channelsV2 || {},
    defaultChannelId: cfg.defaultChannelId || '',
    rules: cfg.rulesV2 || [],
  };
}

// Resolve which channel ID a hostname should use: rules match by domain
// suffix, and when multiple rules match, the longest (most specific) one
// wins; otherwise fall back to the default channel.
function matchChannelForHost(hostname, cfg) {
  let best = null;
  for (const rule of cfg.rules) {
    const pattern = rule.pattern;
    if (hostname === pattern || hostname.endsWith('.' + pattern)) {
      if (!best || pattern.length > best.pattern.length) best = rule;
    }
  }
  return best ? best.channelId : cfg.defaultChannelId;
}

// Whether the current site matched a specific rule (as opposed to falling
// back to the default channel) — used only for UI display.
function isRuleMatch(hostname, cfg, channelId) {
  return cfg.rules.some(r =>
    r.channelId === channelId &&
    (hostname === r.pattern || hostname.endsWith('.' + r.pattern))
  );
}

// Create or update a channel. Pass an existing id to update it, or an empty
// string/null to create a new one. Returns the id that was used.
async function saveChannel(id, { label, serverUrl, channelName, channelKey }) {
  const cfg = await getFullConfig();
  const finalId = id || genId();

  cfg.channels[finalId] = {
    label: label || channelName,
    serverUrl,
    channelName,
    channelKey,
  };

  let defaultChannelId = cfg.defaultChannelId;
  if (!defaultChannelId) defaultChannelId = finalId; // first channel becomes default automatically

  await chrome.storage.local.set({ channelsV2: cfg.channels, defaultChannelId });
  return finalId;
}

async function deleteChannel(id) {
  const cfg = await getFullConfig();
  delete cfg.channels[id];

  let defaultChannelId = cfg.defaultChannelId;
  if (defaultChannelId === id) {
    defaultChannelId = Object.keys(cfg.channels)[0] || '';
  }

  const rules = cfg.rules.filter(r => r.channelId !== id);

  await chrome.storage.local.set({
    channelsV2: cfg.channels,
    defaultChannelId,
    rulesV2: rules,
  });
}

async function setDefaultChannel(id) {
  await chrome.storage.local.set({ defaultChannelId: id });
}

async function addRule(pattern, channelId) {
  const cfg = await getFullConfig();
  const rules = cfg.rules.filter(r => r.pattern !== pattern); // keep only the latest entry per pattern
  rules.push({ pattern, channelId });
  await chrome.storage.local.set({ rulesV2: rules });
}

async function deleteRule(pattern) {
  const cfg = await getFullConfig();
  const rules = cfg.rules.filter(r => r.pattern !== pattern);
  await chrome.storage.local.set({ rulesV2: rules });
}
