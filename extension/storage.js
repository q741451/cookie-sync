/**
 * 共享的存储 / 迁移 / 匹配逻辑，popup.html 和 options.html 都会加载这个文件。
 *
 * 存储结构（v3，服务器地址跟着频道走）：
 *   channelsV2: {
 *     [频道ID]: { label, serverUrl, channelName, channelKey }
 *   }
 *   defaultChannelId: string          默认使用哪个频道（channelsV2 里的某个ID）
 *   rulesV2: [{ pattern: "jd.com", channelId: "..." }]   网站规则，按域名后缀匹配
 *
 * 频道ID是内部随机生成的，跟频道名本身没有关系——因为不同服务器上完全可能
 * 存在同名频道，不能用频道名当唯一标识。
 */

function genId() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return 'ch_' + Date.now() + '_' + Math.random().toString(16).slice(2);
}

// 兼容老版本插件数据，自动迁移到新结构，不会丢失已有配置：
//  - 最早版本：单个 serverUrl / channelName / channelKey
//  - 上一版：共享一个 serverUrl，多个 channels{name:key} + rules[{pattern,channel}]
//  - 本版：每个频道自带各自的 serverUrl
async function migrateIfNeeded() {
  const data = await chrome.storage.local.get([
    'channelsV2', 'defaultChannelId', 'rulesV2',
    'channels', 'serverUrl', 'defaultChannel', 'rules',
    'channelName', 'channelKey',
  ]);
  if (data.channelsV2) return; // 已经是最新格式

  const channelsV2 = {};
  const idByOldName = {};

  if (data.channels) {
    // 上一版：多频道，共享一个 serverUrl
    const serverUrl = data.serverUrl || '';
    for (const [name, key] of Object.entries(data.channels)) {
      const id = genId();
      channelsV2[id] = { label: name, serverUrl, channelName: name, channelKey: key };
      idByOldName[name] = id;
    }
  } else if (data.channelName && data.channelKey) {
    // 最早版本：单频道
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

// 找到某个 hostname 应该用哪个频道ID：规则按"域名后缀"匹配，
// 多条规则都匹配时选最长（最精确）的那条；都不匹配就用默认频道。
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

// 当前网站命中的是不是一条具体规则（而不是默认频道），仅用于UI提示
function isRuleMatch(hostname, cfg, channelId) {
  return cfg.rules.some(r =>
    r.channelId === channelId &&
    (hostname === r.pattern || hostname.endsWith('.' + r.pattern))
  );
}

// 新增或更新一个频道。传 id 为已有频道时是更新，传空字符串/null 时新建。
// 返回最终使用的频道ID。
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
  if (!defaultChannelId) defaultChannelId = finalId; // 第一个频道自动成为默认

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
  const rules = cfg.rules.filter(r => r.pattern !== pattern); // 同一个pattern只保留最新一条
  rules.push({ pattern, channelId });
  await chrome.storage.local.set({ rulesV2: rules });
}

async function deleteRule(pattern) {
  const cfg = await getFullConfig();
  const rules = cfg.rules.filter(r => r.pattern !== pattern);
  await chrome.storage.local.set({ rulesV2: rules });
}
