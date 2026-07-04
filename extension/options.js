const els = {
  channelTbody: document.getElementById('channelTbody'),

  joinServerUrl: document.getElementById('joinServerUrl'),
  joinName: document.getElementById('joinName'),
  joinKey: document.getElementById('joinKey'),
  joinLabel: document.getElementById('joinLabel'),
  joinBtn: document.getElementById('joinBtn'),

  createServerUrl: document.getElementById('createServerUrl'),
  newChannelName: document.getElementById('newChannelName'),
  registerSecret: document.getElementById('registerSecret'),
  createLabel: document.getElementById('createLabel'),
  createNew: document.getElementById('createNew'),

  ruleTbody: document.getElementById('ruleTbody'),
  ruleDomain: document.getElementById('ruleDomain'),
  ruleChannelSelect: document.getElementById('ruleChannelSelect'),
  addRuleBtn: document.getElementById('addRuleBtn'),

  status: document.getElementById('status'),
};

function normalizeServerUrl(url) {
  return url.trim().replace(/\/+$/, '');
}

function isLikelySecure(url) {
  return /^https:\/\//i.test(url) || /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?/i.test(url);
}

function maskKey(key) {
  if (!key || key.length <= 8) return '••••';
  return key.slice(0, 4) + '…' + key.slice(-4);
}

async function render() {
  const cfg = await getFullConfig();
  const ids = Object.keys(cfg.channels);

  // 频道表格
  els.channelTbody.innerHTML = '';
  for (const id of ids) {
    const ch = cfg.channels[id];
    const tr = document.createElement('tr');

    const tdLabel = document.createElement('td');
    tdLabel.textContent = ch.label;

    const tdServer = document.createElement('td');
    tdServer.textContent = ch.serverUrl;

    const tdName = document.createElement('td');
    tdName.textContent = ch.channelName;

    const tdKey = document.createElement('td');
    tdKey.textContent = maskKey(ch.channelKey);
    tdKey.title = '点击显示完整密钥';
    tdKey.style.cursor = 'pointer';
    tdKey.addEventListener('click', () => { tdKey.textContent = ch.channelKey; });

    const tdDefault = document.createElement('td');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'defaultChannel';
    radio.style.width = 'auto';
    radio.checked = cfg.defaultChannelId === id;
    radio.addEventListener('change', async () => {
      await setDefaultChannel(id);
      render();
    });
    tdDefault.appendChild(radio);

    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`确定删除频道 "${ch.label}" 吗？（只是从本插件移除记录，服务器上的数据不受影响）`)) return;
      await deleteChannel(id);
      render();
    });
    tdDel.appendChild(delBtn);

    tr.append(tdLabel, tdServer, tdName, tdKey, tdDefault, tdDel);
    els.channelTbody.appendChild(tr);
  }

  // 规则里的频道下拉框
  els.ruleChannelSelect.innerHTML = '';
  for (const id of ids) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${cfg.channels[id].label}（${cfg.channels[id].serverUrl}）`;
    els.ruleChannelSelect.appendChild(opt);
  }

  // 规则表格
  els.ruleTbody.innerHTML = '';
  for (const rule of cfg.rules) {
    const tr = document.createElement('tr');

    const tdPattern = document.createElement('td');
    tdPattern.textContent = rule.pattern;

    const tdChannel = document.createElement('td');
    const ch = cfg.channels[rule.channelId];
    tdChannel.textContent = ch ? `${ch.label}（${ch.serverUrl}）` : '（频道已被删除）';

    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', async () => {
      await deleteRule(rule.pattern);
      render();
    });
    tdDel.appendChild(delBtn);

    tr.append(tdPattern, tdChannel, tdDel);
    els.ruleTbody.appendChild(tr);
  }
}

function warnIfInsecure(url) {
  if (!isLikelySecure(url)) {
    els.status.textContent = '警告：服务器地址不是 https:// 开头，Cookie和频道密钥会在网络上明文传输，强烈建议改用HTTPS。';
    return true;
  }
  return false;
}

els.joinBtn.addEventListener('click', async () => {
  const serverUrl = normalizeServerUrl(els.joinServerUrl.value);
  const name = els.joinName.value.trim();
  const key = els.joinKey.value.trim();
  const label = els.joinLabel.value.trim();

  if (!serverUrl || !name || !key) {
    els.status.textContent = '请把服务器地址、频道名、频道密钥都填上';
    return;
  }

  const warned = warnIfInsecure(serverUrl);

  await saveChannel(null, { label, serverUrl, channelName: name, channelKey: key });

  els.joinServerUrl.value = '';
  els.joinName.value = '';
  els.joinKey.value = '';
  els.joinLabel.value = '';

  if (!warned) els.status.textContent = `已加入频道 "${label || name}"`;
  render();
});

els.createNew.addEventListener('click', async () => {
  const serverUrl = normalizeServerUrl(els.createServerUrl.value);
  const name = els.newChannelName.value.trim();
  const label = els.createLabel.value.trim();

  if (!serverUrl) {
    els.status.textContent = '请填写服务器地址';
    return;
  }
  if (!name) {
    els.status.textContent = '请填写新频道名';
    return;
  }

  const warned = warnIfInsecure(serverUrl);
  if (!warned) els.status.textContent = '创建中...';

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

    await saveChannel(null, {
      label,
      serverUrl,
      channelName: json.channel_name,
      channelKey: json.channel_key,
    });

    els.newChannelName.value = '';
    els.registerSecret.value = '';
    els.createLabel.value = '';

    els.status.textContent =
      `创建成功！\n服务器：${serverUrl}\n频道名：${json.channel_name}\n频道密钥：${json.channel_key}\n\n` +
      `密钥已自动保存到本插件，但强烈建议你自己再抄一份到安全的地方（比如密码管理器），` +
      `因为服务器不会再次显示这个明文密钥。`;
    render();
  } catch (e) {
    els.status.textContent = '请求出错：' + e.message;
  }
});

els.addRuleBtn.addEventListener('click', async () => {
  const pattern = els.ruleDomain.value.trim().replace(/^\.+/, '').toLowerCase();
  const channelId = els.ruleChannelSelect.value;

  if (!pattern) {
    els.status.textContent = '请填写域名';
    return;
  }
  if (!channelId) {
    els.status.textContent = '请先创建/加入至少一个频道';
    return;
  }

  await addRule(pattern, channelId);
  els.ruleDomain.value = '';
  els.status.textContent = `已添加规则：${pattern}`;
  render();
});

render();
