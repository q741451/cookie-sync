const domainEl = document.getElementById('domain');
const channelEl = document.getElementById('channel');
const statusEl = document.getElementById('status');

function authHeaders(channelName, channelKey) {
  return {
    'X-Channel-Name': channelName,
    'X-Channel-Key': channelKey,
  };
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

function normalizeSameSite(v) {
  const allowed = ['no_restriction', 'lax', 'strict', 'unspecified'];
  return allowed.includes(v) ? v : 'lax';
}

// 当前网站的 hostname，以及按"网站规则→默认频道"解析出来要用的频道名
let currentHostname = null;
let resolvedChannelName = null;

async function init() {
  const cfg = await getFullConfig();

  try {
    const tab = await getCurrentTab();
    const url = new URL(tab.url);
    if (!/^https?:$/.test(url.protocol)) {
      domainEl.textContent = '当前页面不是普通网页，无法读取Cookie';
      channelEl.textContent = '';
      return;
    }

    currentHostname = url.hostname;
    resolvedChannelName = matchChannelForHost(currentHostname, cfg);

    domainEl.textContent = `当前网站：${currentHostname}`;

    if (!resolvedChannelName) {
      channelEl.textContent = '没有可用频道，请先点击下方"设置"创建/加入一个';
    } else {
      const viaRule = isRuleMatch(currentHostname, cfg, resolvedChannelName);
      channelEl.textContent = `使用频道：${resolvedChannelName}${viaRule ? '（按规则匹配）' : '（默认频道）'}`;
    }
  } catch (e) {
    domainEl.textContent = '无法获取当前网站信息';
  }
}

const initPromise = init();

document.getElementById('settingsLink').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('upload').addEventListener('click', async () => {
  await initPromise;
  const cfg = await getFullConfig();

  if (!cfg.serverUrl || !resolvedChannelName || !cfg.channels[resolvedChannelName]) {
    statusEl.textContent = '没有可用频道，请先完成设置';
    return;
  }
  const channelKey = cfg.channels[resolvedChannelName];

  const tab = await getCurrentTab();
  statusEl.textContent = '上传中...';
  try {
    // 用 URL 查询而不是用域名字符串查询：
    // chrome.cookies.getAll({domain}) 只会匹配该域名"及其子域名"的cookie，
    // 查不到设在父域上的cookie。用 {url: 完整页面地址} 查询，
    // 等价于"浏览器打开这个页面时实际会带上哪些cookie"，天然包含父域cookie。
    const cookies = await chrome.cookies.getAll({ url: tab.url });

    const res = await fetch(`${cfg.serverUrl}/api/upload.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(resolvedChannelName, channelKey) },
      body: JSON.stringify({ domain: currentHostname, cookies }),
    });
    const json = await res.json();

    statusEl.textContent = res.ok
      ? `已上传 ${json.count} 个 Cookie（频道：${resolvedChannelName}）`
      : '上传失败：' + json.error;
  } catch (e) {
    statusEl.textContent = '请求出错：' + e.message;
  }
});

document.getElementById('download').addEventListener('click', async () => {
  await initPromise;
  const cfg = await getFullConfig();

  if (!cfg.serverUrl || !resolvedChannelName || !cfg.channels[resolvedChannelName]) {
    statusEl.textContent = '没有可用频道，请先完成设置';
    return;
  }
  const channelKey = cfg.channels[resolvedChannelName];

  statusEl.textContent = '下载中...';
  try {
    const res = await fetch(
      `${cfg.serverUrl}/api/download.php?domain=${encodeURIComponent(currentHostname)}`,
      { headers: authHeaders(resolvedChannelName, channelKey) }
    );
    const json = await res.json();

    if (!res.ok) {
      statusEl.textContent = '下载失败：' + json.error;
      return;
    }

    let okCount = 0;
    for (const c of json.cookies) {
      try {
        const bareDomain = c.domain.replace(/^\./, '');
        await chrome.cookies.set({
          url: `https://${bareDomain}${c.path}`,
          name: c.name,
          value: c.value,
          domain: c.domain,
          path: c.path,
          secure: c.secure,
          httpOnly: c.httpOnly,
          sameSite: normalizeSameSite(c.sameSite),
          expirationDate: c.expirationDate,
        });
        okCount++;
      } catch (err) {
        console.warn('设置 cookie 失败:', c.name, err);
      }
    }

    const updatedAt = new Date(json.updated_at * 1000).toLocaleString();
    statusEl.textContent = `已恢复 ${okCount}/${json.cookies.length} 个 Cookie\n（频道：${resolvedChannelName}，更新于 ${updatedAt}）`;
  } catch (e) {
    statusEl.textContent = '请求出错：' + e.message;
  }
});
