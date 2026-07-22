/**
 * Shared storage / migration / matching logic used by both popup.html and
 * options.html.
 *
 * ===========================================================================
 * Storage schema v5 — item-per-key, sync-ready
 * ===========================================================================
 *
 * Earlier versions (v1-v4) stored the whole config as one or two big blobs
 * (channelsV3 / rulesV2). That's fine for a single device, but once this
 * data can also live in chrome.storage.sync (synced across devices via the
 * user's Google/Chrome account), a blob becomes a conflict hazard: device A
 * edits channel 1, device B edits channel 2 a moment later, whichever
 * device's blob-write lands last silently wins and erases the other's
 * change — even though the two edits touched unrelated things.
 *
 * v5 avoids that by giving every entity its own storage key, so
 * chrome.storage's built-in last-write-wins only ever contends with itself
 * *within* a single entity, never across unrelated ones:
 *
 *   schemaVersion            5
 *   defaultChannelId         string
 *   "ch:<channelId>"         { label, serverUrl, channelName, writeKey, readKey }
 *   "rule:<pattern>"         { channelId }
 *
 * `syncEnabled` (boolean) is deliberately NOT part of this schema — it's a
 * per-device choice of which storage area (local vs sync) this particular
 * browser install reads/writes, so it always lives in chrome.storage.local,
 * even while sync is turned on.
 *
 * writeKey: string | null — can upload AND download; null if this device
 *   was only ever given a read-only key.
 * readKey: string | null — can only download; null if this device holds
 *   the full write key instead (the write key already covers reading, so a
 *   separate read key isn't needed on that same device).
 *
 * Why two separate keys instead of one: a single key that can both read and
 * write means every device (or backup copy, or clipboard history) holding
 * it can silently overwrite your cookie data everywhere. Splitting it lets
 * you keep one write key on your main device and hand out read-only keys
 * to anything that should only ever restore, never overwrite.
 *
 * Channel IDs are randomly generated locally and have nothing to do with the
 * channel name itself — different servers can easily have channels that
 * share the same name, so the name alone can't be a unique key.
 */

const SCHEMA_VERSION = 5;
const ENTITY_PREFIXES = ['ch:', 'rule:'];

function genId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'ch_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}

// ---------------------------------------------------------------------------
// Sync toggle (per-device preference, always in local storage)
// ---------------------------------------------------------------------------

async function isSyncEnabled() {
  const { syncEnabled } = await chrome.storage.local.get('syncEnabled');
  return !!syncEnabled;
}

async function backendArea() {
  return (await isSyncEnabled()) ? chrome.storage.sync : chrome.storage.local;
}

// Picks up every key belonging to our schema out of a raw storage.get(null)
// dump, ignoring anything unrelated that might live in the same area.
function pickSchemaKeys(all) {
  const out = {};
  if ('schemaVersion' in all) out.schemaVersion = all.schemaVersion;
  if ('defaultChannelId' in all) out.defaultChannelId = all.defaultChannelId;
  for (const [k, v] of Object.entries(all)) {
    if (ENTITY_PREFIXES.some((p) => k.startsWith(p))) out[k] = v;
  }
  return out;
}

/**
 * Turn cross-device sync on or off for this browser install.
 *
 * Turning ON follows a "first device seeds, later devices adopt" rule:
 *  - If chrome.storage.sync is empty (no other device has enabled sync
 *    yet), this device's local config is pushed up to seed it.
 *  - If chrome.storage.sync already holds a v5 config (another device
 *    enabled sync earlier), this device adopts that as the source of
 *    truth instead of clobbering it with its own local state. The local
 *    copy is left untouched underneath as an offline fallback.
 *
 * Turning OFF snapshots the current *effective* (sync) state down into
 * local storage first, so switching back to local-only doesn't roll back
 * to whatever the local copy last looked like before sync was enabled.
 *
 * Returns a small result object the caller can use to inform the user
 * which branch was taken.
 */
async function setSyncEnabled(enabled) {
  await migrateLocalIfNeeded();

  if (enabled) {
    const syncAll = await chrome.storage.sync.get(null);
    if (syncAll.schemaVersion === SCHEMA_VERSION) {
      await chrome.storage.local.set({ syncEnabled: true });
      return { action: 'adopted' };
    }

    const localAll = await chrome.storage.local.get(null);
    const toPush = pickSchemaKeys(localAll);
    toPush.schemaVersion = SCHEMA_VERSION;
    try {
      await chrome.storage.sync.set(toPush);
    } catch (e) {
      throw new SyncQuotaError(e);
    }
    await chrome.storage.local.set({ syncEnabled: true });
    return { action: 'seeded' };
  }

  const syncAll = await chrome.storage.sync.get(null);
  if (syncAll.schemaVersion === SCHEMA_VERSION) {
    await chrome.storage.local.set(pickSchemaKeys(syncAll));
  }
  await chrome.storage.local.set({ syncEnabled: false });
  return { action: 'disabled' };
}

// chrome.storage.sync enforces per-item (8KB) and total (100KB) quotas that
// chrome.storage.local doesn't. Wrap failures so callers can show a
// specific, actionable message instead of a generic error.
class SyncQuotaError extends Error {
  constructor(cause) {
    super('sync-quota-exceeded');
    this.cause = cause;
  }
}

// ---------------------------------------------------------------------------
// Migration: any pre-v5 local data -> v5 item-per-key shape.
//
// This only ever needs to run against chrome.storage.local, since sync
// storage never held the old blob formats (sync support was added
// alongside v5 itself).
// ---------------------------------------------------------------------------
async function migrateLocalIfNeeded() {
  const all = await chrome.storage.local.get(null);
  if (all.schemaVersion === SCHEMA_VERSION) return;

  // Step 1: get to the v4 blob shape (channelsV3 / rulesV2 / defaultChannelId)
  // if not already there. This collapses every older format Cookie Channel
  // Sync has ever shipped:
  //  - earliest version: a single serverUrl / channelName / channelKey
  //  - v2: multiple channels{name:key} sharing one serverUrl, plus
  //    rules[{pattern,channel}]
  //  - v3: every channel carries its own serverUrl, single channelKey
  //  - v4: channelKey split into writeKey/readKey
  let channelsV3 = all.channelsV3;
  let defaultChannelId = all.defaultChannelId || '';
  let rulesV2 = all.rulesV2 || [];

  if (!channelsV3) {
    let channelsV2 = all.channelsV2;
    const idByOldName = {};

    if (!channelsV2) {
      channelsV2 = {};

      if (all.channels) {
        const serverUrl = all.serverUrl || '';
        for (const [name, key] of Object.entries(all.channels)) {
          const id = genId();
          channelsV2[id] = { label: name, serverUrl, channelName: name, channelKey: key };
          idByOldName[name] = id;
        }
      } else if (all.channelName && all.channelKey) {
        const id = genId();
        channelsV2[id] = {
          label: all.channelName,
          serverUrl: all.serverUrl || '',
          channelName: all.channelName,
          channelKey: all.channelKey,
        };
        idByOldName[all.channelName] = id;
      }

      if (all.defaultChannel && idByOldName[all.defaultChannel]) {
        defaultChannelId = idByOldName[all.defaultChannel];
      } else {
        defaultChannelId = Object.keys(channelsV2)[0] || defaultChannelId;
      }

      rulesV2 = (all.rules || [])
        .filter((r) => idByOldName[r.channel])
        .map((r) => ({ pattern: r.pattern, channelId: idByOldName[r.channel] }));
    }

    channelsV3 = {};
    for (const [id, ch] of Object.entries(channelsV2)) {
      channelsV3[id] = {
        label: ch.label,
        serverUrl: ch.serverUrl,
        channelName: ch.channelName,
        writeKey: ch.writeKey !== undefined ? ch.writeKey : (ch.channelKey || null),
        readKey: ch.readKey !== undefined ? ch.readKey : null,
      };
    }
  }

  // Step 2: v4 blob -> v5 item-per-key.
  const toSet = { schemaVersion: SCHEMA_VERSION, defaultChannelId };
  for (const [id, ch] of Object.entries(channelsV3)) {
    toSet['ch:' + id] = ch;
  }
  for (const rule of rulesV2) {
    toSet['rule:' + rule.pattern] = { channelId: rule.channelId };
  }

  const toRemove = [
    'channelsV3', 'channelsV2', 'rulesV2',
    'channels', 'serverUrl', 'defaultChannel', 'rules',
    'channelName', 'channelKey',
  ];

  await chrome.storage.local.set(toSet);
  await chrome.storage.local.remove(toRemove);
}

// ---------------------------------------------------------------------------
// Public config API — unchanged signatures, now backed by whichever area
// backendArea() resolves to, and by item-per-key storage underneath.
// ---------------------------------------------------------------------------

async function getFullConfig() {
  await migrateLocalIfNeeded();
  const area = await backendArea();
  const all = await area.get(null);

  const channels = {};
  const rules = [];
  for (const [k, v] of Object.entries(all)) {
    if (k.startsWith('ch:')) {
      channels[k.slice(3)] = v;
    } else if (k.startsWith('rule:')) {
      rules.push({ pattern: k.slice(5), channelId: v.channelId });
    }
  }

  return {
    channels,
    defaultChannelId: all.defaultChannelId || '',
    rules,
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
  return cfg.rules.some((r) =>
    r.channelId === channelId &&
    (hostname === r.pattern || hostname.endsWith('.' + r.pattern))
  );
}

// Create or update a channel. Pass an existing id to update it, or an empty
// string/null to create a new one. writeKey and/or readKey may be null —
// a device can hold just one of the two. Returns the id that was used.
async function saveChannel(id, { label, serverUrl, channelName, writeKey, readKey }) {
  const area = await backendArea();
  const finalId = id || genId();

  const entry = {
    label: label || channelName,
    serverUrl,
    channelName,
    writeKey: writeKey || null,
    readKey: readKey || null,
  };

  const toSet = { ['ch:' + finalId]: entry };

  // The first channel ever created becomes the default automatically.
  const existing = await area.get('defaultChannelId');
  if (!existing.defaultChannelId) toSet.defaultChannelId = finalId;

  try {
    await area.set(toSet);
  } catch (e) {
    throw new SyncQuotaError(e);
  }
  return finalId;
}

async function deleteChannel(id) {
  const area = await backendArea();
  const cfg = await getFullConfig();

  await area.remove('ch:' + id);

  const ruleKeys = cfg.rules
    .filter((r) => r.channelId === id)
    .map((r) => 'rule:' + r.pattern);
  if (ruleKeys.length) await area.remove(ruleKeys);

  if (cfg.defaultChannelId === id) {
    const remaining = Object.keys(cfg.channels).filter((cid) => cid !== id);
    await area.set({ defaultChannelId: remaining[0] || '' });
  }
}

async function setDefaultChannel(id) {
  const area = await backendArea();
  await area.set({ defaultChannelId: id });
}

async function addRule(pattern, channelId) {
  const area = await backendArea();
  // Overwriting the same key naturally keeps only the latest entry per
  // pattern — no need to scan/dedupe first the way the old blob did.
  try {
    await area.set({ ['rule:' + pattern]: { channelId } });
  } catch (e) {
    throw new SyncQuotaError(e);
  }
}

async function deleteRule(pattern) {
  const area = await backendArea();
  await area.remove('rule:' + pattern);
}
