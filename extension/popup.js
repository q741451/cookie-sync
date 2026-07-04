const domainEl = document.getElementById('domain');
const channelEl = document.getElementById('channel');
const statusEl = document.getElementById('status');

async function getConfig() {
  return chrome.storage.local.get(['serverUrl', 'channelName', 'channelKey']);
}

function authHeaders(cfg) {
  return {
    'X-Channel-Name': cfg.channelName,
    'X-Channel-Key': cfg.channelKey,
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

async function init() {
  const cfg = await getConfig();

  if (cfg.serverUrl && cfg.channelName) {
    channelEl.textContent = `频道：${cfg.channelName} @ ${cfg.serverUrl}`;
  } else {
    channelEl.textContent = '尚未配置服务器/频道，请点击下方“设置”';
  }

  try {
    const tab = await getCurrentTab();
    const url = new URL(tab.url);
    if (!/^https?:$/.test(url.protocol)) {
      domainEl.textContent = '当前页面不是普通网页，无法读取Cookie';
      return null;
    }
    domainEl.textContent = `当前网站：${url.hostname}`;
    return url.hostname;
  } catch (e) {
    domainEl.textContent = '无法获取当前网站信息';
    return null;
  }
}

const domainPromise = init();

document.getElementById('settingsLink').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('upload').addEventListener('click', async () => {
  const cfg = await getConfig();
  if (!cfg.serverUrl || !cfg.channelName || !cfg.channelKey) {
    statusEl.textContent = '请先完成设置（服务器地址 / 频道名 / 频道密钥）';
    return;
  }

  const domain = await domainPromise;
  if (!domain) return;

  statusEl.textContent = '上传中...';
  try {
    const cookies = await chrome.cookies.getAll({ domain });

    const res = await fetch(`${cfg.serverUrl}/api/upload.php`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders(cfg) },
      body: JSON.stringify({ domain, cookies }),
    });
    const json = await res.json();

    statusEl.textContent = res.ok
      ? `已上传 ${json.count} 个 Cookie（${domain}）`
      : '上传失败：' + json.error;
  } catch (e) {
    statusEl.textContent = '请求出错：' + e.message;
  }
});

document.getElementById('download').addEventListener('click', async () => {
  const cfg = await getConfig();
  if (!cfg.serverUrl || !cfg.channelName || !cfg.channelKey) {
    statusEl.textContent = '请先完成设置（服务器地址 / 频道名 / 频道密钥）';
    return;
  }

  const domain = await domainPromise;
  if (!domain) return;

  statusEl.textContent = '下载中...';
  try {
    const res = await fetch(
      `${cfg.serverUrl}/api/download.php?domain=${encodeURIComponent(domain)}`,
      { headers: authHeaders(cfg) }
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
    statusEl.textContent = `已恢复 ${okCount}/${json.cookies.length} 个 Cookie\n（服务器数据更新于 ${updatedAt}）`;
  } catch (e) {
    statusEl.textContent = '请求出错：' + e.message;
  }
});
