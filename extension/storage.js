/**
 * Shared storage / migration / matching logic used by both popup.html and
 * options.html.
 *
 * Storage shape (v4, read and write are separate credentials):
 *   channelsV3: {
 *     [channelId]: {
 *       label, serverUrl, channelName,
 *       writeKey,  // string | null — can upload AND download; null if this
 *                  // device was only ever given a read-only key
 *       readKey,   // string | null — can only download; null if this
 *                  // device holds the full write key instead (the write
 *                  // key already covers reading, so a separate read key
 *                  // isn't needed on that same device)
 *     }
 *   }
 *   defaultChannelId: string          which channel is used by default
 *   rulesV2: [{ pattern: "jd.com", channelId: "..." }]   site rules, matched by domain suffix
 *
 * Channel IDs are randomly generated locally and have nothing to do with the
 * channel name itself — different servers can easily have channels that
 * share the same name, so the name alone can't be a unique key.
 *
 * Why two separate keys instead of one: a single key that can both read and
 * write means every device (or backup copy, or clipboard history) holding
 * it can silently overwrite your cookie data everywhere. Splitting it lets
 * you keep one write key on your main device and hand out read-only keys
 * to anything that should only ever restore, never overwrite.
 */

function genId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'ch_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}

// Migrate older extension data formats so nothing gets lost:
//  - earliest version: a single serverUrl / channelName / channelKey
//  - v2: multiple channels{name:key} sharing one serverUrl, plus
//    rules[{pattern,channel}]
//  - v3: every channel carries its own serverUrl, single channelKey
//  - this version (v4): channelKey is split into writeKey/readKey. A
//    key from any pre-v4 install had full read+write access on the server,
//    so it's carried forward as writeKey (no capability is lost); readKey
//    starts empty until the user separately requests a read-only key.
async function migrateIfNeeded() {
  const data = await chrome.storage.local.get([
    'channelsV3', 'defaultChannelId', 'rulesV2',
    'channelsV2',
    'channels', 'serverUrl', 'defaultChannel', 'rules',
    'channelName', 'channelKey',
  ]);
  if (data.channelsV3) return; // already on the latest format

  // Step 1: get to v3 shape (channelsV2) if not already there.
  let channelsV2 = data.channelsV2;
  let defaultChannelId = data.defaultChannelId || '';
  let rulesV2 = data.rulesV2 || [];

  if (!channelsV2) {
    channelsV2 = {};
    const idByOldName = {};

    if (data.channels) {
      // v2: multiple channels sharing one serverUrl
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

    if (data.defaultChannel && idByOldName[data.defaultChannel]) {
      defaultChannelId = idByOldName[data.defaultChannel];
    } else {
      defaultChannelId = Object.keys(channelsV2)[0] || '';
    }

    rulesV2 = (data.rules || [])
      .filter(r => idByOldName[r.channel])
      .map(r => ({ pattern: r.pattern, channelId: idByOldName[r.channel] }));
  }

  // Step 2: v3 -> v4, splitting channelKey into writeKey/readKey.
  const channelsV3 = {};
  for (const [id, ch] of Object.entries(channelsV2)) {
    channelsV3[id] = {
      label: ch.label,
      serverUrl: ch.serverUrl,
      channelName: ch.channelName,
      writeKey: ch.writeKey !== undefined ? ch.writeKey : (ch.channelKey || null),
      readKey: ch.readKey !== undefined ? ch.readKey : null,
    };
  }

  await chrome.storage.local.set({ channelsV3, defaultChannelId, rulesV2 });
}

async function getFullConfig() {
  await migrateIfNeeded();
  const cfg = await chrome.storage.local.get(['channelsV3', 'defaultChannelId', 'rulesV2']);
  return {
    channels: cfg.channelsV3 || {},
    defaultChannelId: cfg.defaultChannelId || '',
    rules: cfg.rulesV2 || [],
  };
}

// A channel can upload only if this device holds its write key.
function canUpload(channel) {
  return !!(channel && channel.writeKey);
}

// A channel can download if this device holds either key (write implies
// read on the server side too).
function canDownload(channel) {
  return !!(channel && (channel.writeKey || channel.readKey));
}

// The single credential to send for a given action: prefer the write key
// (since it also authenticates reads), falling back to the read key for
// downloads on a read-only device.
function credentialFor(channel, action) {
  if (channel.writeKey) return channel.writeKey;
  if (action === 'download' && channel.readKey) return channel.readKey;
  return null;
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
// string/null to create a new one. writeKey and/or readKey may be null —
// a device can hold just one of the two. Returns the id that was used.
async function saveChannel(id, { label, serverUrl, channelName, writeKey, readKey }) {
  const cfg = await getFullConfig();
  const finalId = id || genId();

  cfg.channels[finalId] = {
    label: label || channelName,
    serverUrl,
    channelName,
    writeKey: writeKey || null,
    readKey: readKey || null,
  };

  let defaultChannelId = cfg.defaultChannelId;
  if (!defaultChannelId) defaultChannelId = finalId; // first channel becomes default automatically

  await chrome.storage.local.set({ channelsV3: cfg.channels, defaultChannelId });
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
    channelsV3: cfg.channels,
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
