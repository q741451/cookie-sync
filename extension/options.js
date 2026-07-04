const els = {
  serverUrl: document.getElementById('serverUrl'),
  saveServer: document.getElementById('saveServer'),
  channelTbody: document.getElementById('channelTbody'),
  joinName: document.getElementById('joinName'),
  joinKey: document.getElementById('joinKey'),
  joinBtn: document.getElementById('joinBtn'),
  newChannelName: document.getElementById('newChannelName'),
  registerSecret: document.getElementById('registerSecret'),
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
  if (key.length <= 8) return '••••';
  return key.slice(0, 4) + '…' + key.slice(-4);
}

async function render() {
  const cfg = await getFullConfig();
  els.serverUrl.value = cfg.serverUrl;

  // 频道表格
  els.channelTbody.innerHTML = '';
  const names = Object.keys(cfg.channels);
  for (const name of names) {
    const tr = document.createElement('tr');

    const tdName = document.createElement('td');
    tdName.textContent = name;

    const tdKey = document.createElement('td');
    tdKey.textContent = maskKey(cfg.channels[name]);
    tdKey.title = '点击显示完整密钥';
    tdKey.style.cursor = 'pointer';
    tdKey.addEventListener('click', () => { tdKey.textContent = cfg.channels[name]; });

    const tdDefault = document.createElement('td');
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'defaultChannel';
    radio.style.width = 'auto';
    radio.checked = cfg.defaultChannel === name;
    radio.addEventListener('change', async () => {
      await setDefaultChannel(name);
      render();
    });
    tdDefault.appendChild(radio);

    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.textContent = '删除';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', async () => {
      if (!confirm(`确定删除频道 "${name}" 吗？（只是从本插件移除记录，服务器上的数据不受影响）`)) return;
      await deleteChannel(name);
      render();
    });
    tdDel.appendChild(delBtn);

    tr.append(tdName, tdKey, tdDefault, tdDel);
    els.channelTbody.appendChild(tr);
  }

  // 规则里的频道下拉框
  els.ruleChannelSelect.innerHTML = '';
  for (const name of names) {
    const opt = document.createElement('option');
    opt.value = name;
    opt.textContent = name;
    els.ruleChannelSelect.appendChild(opt);
  }

  // 规则表格
  els.ruleTbody.innerHTML = '';
  for (const rule of cfg.rules) {
    const tr = document.createElement('tr');

    const tdPattern = document.createElement('td');
    tdPattern.textContent = rule.pattern;

    const tdChannel = document.createElement('td');
    tdChannel.textContent = rule.channel;

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

els.saveServer.addEventListener('click', async () => {
  const url = normalizeServerUrl(els.serverUrl.value);
  if (!url) {
    els.status.textContent = '请填写服务器地址';
    return;
  }
  await saveServerUrl(url);
  els.status.textContent = isLikelySecure(url)
    ? '已保存'
    : '警告：不是 https:// 开头，Cookie和频道密钥会在网络上明文传输，强烈建议改用HTTPS。已按你填的地址保存。';
});

els.joinBtn.addEventListener('click', async () => {
  const name = els.joinName.value.trim();
  const key = els.joinKey.value.trim();
  if (!name || !key) {
    els.status.textContent = '请把频道名和密钥都填上';
    return;
  }
  await upsertChannel(name, key);
  els.joinName.value = '';
  els.joinKey.value = '';
  els.status.textContent = `已加入频道 "${name}"`;
  render();
});

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

    await upsertChannel(json.channel_name, json.channel_key);
    els.newChannelName.value = '';
    els.registerSecret.value = '';

    els.status.textContent =
      `创建成功！\n频道名：${json.channel_name}\n频道密钥：${json.channel_key}\n\n` +
      `密钥已自动保存到本插件，但强烈建议你自己再抄一份到安全的地方（比如密码管理器），` +
      `因为服务器不会再次显示这个明文密钥。`;
    render();
  } catch (e) {
    els.status.textContent = '请求出错：' + e.message;
  }
});

els.addRuleBtn.addEventListener('click', async () => {
  const pattern = els.ruleDomain.value.trim().replace(/^\.+/, '').toLowerCase();
  const channel = els.ruleChannelSelect.value;

  if (!pattern) {
    els.status.textContent = '请填写域名';
    return;
  }
  if (!channel) {
    els.status.textContent = '请先创建/加入至少一个频道';
    return;
  }

  await addRule(pattern, channel);
  els.ruleDomain.value = '';
  els.status.textContent = `已添加规则：${pattern} → ${channel}`;
  render();
});

render();
