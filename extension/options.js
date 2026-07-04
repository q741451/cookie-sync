const els = {
  serverUrl: document.getElementById('serverUrl'),
  channelName: document.getElementById('channelName'),
  channelKey: document.getElementById('channelKey'),
  newChannelName: document.getElementById('newChannelName'),
  registerSecret: document.getElementById('registerSecret'),
  save: document.getElementById('save'),
  createNew: document.getElementById('createNew'),
  status: document.getElementById('status'),
};

function normalizeServerUrl(url) {
  return url.trim().replace(/\/+$/, '');
}

async function load() {
  const cfg = await chrome.storage.local.get(['serverUrl', 'channelName', 'channelKey']);
  els.serverUrl.value = cfg.serverUrl || '';
  els.channelName.value = cfg.channelName || '';
  els.channelKey.value = cfg.channelKey || '';
}

els.save.addEventListener('click', async () => {
  const serverUrl = normalizeServerUrl(els.serverUrl.value);
  const channelName = els.channelName.value.trim();
  const channelKey = els.channelKey.value.trim();

  if (!serverUrl || !channelName || !channelKey) {
    els.status.textContent = '请把服务器地址、频道名、频道密钥都填完整';
    return;
  }

  if (!isLikelySecure(serverUrl)) {
    els.status.textContent =
      '警告：服务器地址不是 https:// 开头，Cookie 和频道密钥会在网络上明文传输，' +
      '强烈建议改用 HTTPS。仍然保存的话请自行承担风险。';
    // 仍然保存，但明确警告，不做强制拦截（本地调试场景可能确实用的是http）
  }

  await chrome.storage.local.set({ serverUrl, channelName, channelKey });
  if (isLikelySecure(serverUrl)) {
    els.status.textContent = '已保存配置';
  }
});

function isLikelySecure(url) {
  return /^https:\/\//i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url);
}

els.createNew.addEventListener('click', async () => {
  const serverUrl = normalizeServerUrl(els.serverUrl.value);
  const name = els.newChannelName.value.trim();

  if (!serverUrl) {
    els.status.textContent = '请先在上面填写服务器地址';
    return;
  }
  if (!name) {
    els.status.textContent = '请填写新频道名';
    return;
  }

  els.status.textContent = '创建中...';
  try {
    const headers = { 'Content-Type': 'application/json' };
    const secret = els.registerSecret.value.trim();
    if (secret) headers['X-Register-Secret'] = secret;

    const res = await fetch(`${serverUrl}/api/create_channel.php`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ channel_name: name }),
    });
    const json = await res.json();

    if (!res.ok) {
      els.status.textContent = '创建失败：' + (json.error || res.status);
      return;
    }

    els.channelName.value = json.channel_name;
    els.channelKey.value = json.channel_key;

    await chrome.storage.local.set({
      serverUrl,
      channelName: json.channel_name,
      channelKey: json.channel_key,
    });

    els.status.textContent =
      `创建成功！\n频道名：${json.channel_name}\n频道密钥：${json.channel_key}\n\n` +
      `密钥已自动保存到本插件，但强烈建议你自己再抄一份到安全的地方（比如密码管理器），` +
      `因为服务器不会再次显示这个明文密钥，一旦本地插件数据丢失就无法找回。`;
  } catch (e) {
    els.status.textContent = '请求出错：' + e.message;
  }
});

load();
