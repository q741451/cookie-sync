/**
 * 共享的存储 / 迁移 / 匹配逻辑，popup.html 和 options.html 都会加载这个文件。
 *
 * 存储结构：
 *   serverUrl: string                          服务器地址
 *   channels: { [频道名]: 频道密钥 }             你加入/创建过的所有频道
 *   defaultChannel: string                     默认使用哪个频道（channels 里的某个key）
 *   rules: [{ pattern: "jd.com", channel: "xxx" }]  网站规则，按域名后缀匹配
 */

// 兼容老版本插件（只有单个 serverUrl/channelName/channelKey）：
// 第一次加载时自动把旧数据搬进新结构，不会丢失已有配置。
async function migrateIfNeeded() {
  const old = await chrome.storage.local.get(['channelName', 'channelKey', 'serverUrl', 'channels']);
  if (old.channels) return; // 已经是新格式，不用迁移

  const channels = {};
  let defaultChannel = '';
  if (old.channelName && old.channelKey) {
    channels[old.channelName] = old.channelKey;
    defaultChannel = old.channelName;
  }

  await chrome.storage.local.set({
    serverUrl: old.serverUrl || '',
    channels,
    defaultChannel,
    rules: [],
  });
}

async function getFullConfig() {
  await migrateIfNeeded();
  const cfg = await chrome.storage.local.get(['serverUrl', 'channels', 'defaultChannel', 'rules']);
  return {
    serverUrl: cfg.serverUrl || '',
    channels: cfg.channels || {},
    defaultChannel: cfg.defaultChannel || '',
    rules: cfg.rules || [],
  };
}

// 找到某个 hostname 应该用哪个频道：规则按"域名后缀"匹配，
// 多条规则都匹配时选最长（最精确）的那条；都不匹配就用默认频道。
function matchChannelForHost(hostname, cfg) {
  let best = null;
  for (const rule of cfg.rules) {
    const pattern = rule.pattern;
    if (hostname === pattern || hostname.endsWith('.' + pattern)) {
      if (!best || pattern.length > best.pattern.length) best = rule;
    }
  }
  return best ? best.channel : cfg.defaultChannel;
}

// 当前网站命中的是不是一条具体规则（而不是默认频道），仅用于UI提示
function isRuleMatch(hostname, cfg, channelName) {
  return cfg.rules.some(r =>
    r.channel === channelName &&
    (hostname === r.pattern || hostname.endsWith('.' + r.pattern))
  );
}

async function saveServerUrl(url) {
  await chrome.storage.local.set({ serverUrl: url });
}

async function upsertChannel(name, key) {
  const cfg = await getFullConfig();
  cfg.channels[name] = key;
  if (!cfg.defaultChannel) cfg.defaultChannel = name; // 第一个频道自动成为默认
  await chrome.storage.local.set({ channels: cfg.channels, defaultChannel: cfg.defaultChannel });
}

async function deleteChannel(name) {
  const cfg = await getFullConfig();
  delete cfg.channels[name];
  if (cfg.defaultChannel === name) {
    cfg.defaultChannel = Object.keys(cfg.channels)[0] || '';
  }
  const rules = cfg.rules.filter(r => r.channel !== name);
  await chrome.storage.local.set({
    channels: cfg.channels,
    defaultChannel: cfg.defaultChannel,
    rules,
  });
}

async function setDefaultChannel(name) {
  await chrome.storage.local.set({ defaultChannel: name });
}

async function addRule(pattern, channel) {
  const cfg = await getFullConfig();
  const rules = cfg.rules.filter(r => r.pattern !== pattern); // 同一个pattern只保留最新一条
  rules.push({ pattern, channel });
  await chrome.storage.local.set({ rules });
}

async function deleteRule(pattern) {
  const cfg = await getFullConfig();
  const rules = cfg.rules.filter(r => r.pattern !== pattern);
  await chrome.storage.local.set({ rules });
}
