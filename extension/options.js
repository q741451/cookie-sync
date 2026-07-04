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
  if (!key || key.length <= 8) return '\u2022\u2022\u2022\u2022';
  return key.slice(0, 4) + '\u2026' + key.slice(-4);
}

async function render() {
  const cfg = await getFullConfig();
  const ids = Object.keys(cfg.channels);

  // Channel table
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
    tdKey.title = t('options_clickToRevealKey');
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
    delBtn.textContent = t('options_deleteBtn');
    delBtn.className = 'danger';
    delBtn.addEventListener('click', async () => {
      if (!confirm(t('options_confirmDeleteChannel', [ch.label]))) return;
      await deleteChannel(id);
      render();
    });
    tdDel.appendChild(delBtn);

    tr.append(tdLabel, tdServer, tdName, tdKey, tdDefault, tdDel);
    els.channelTbody.appendChild(tr);
  }

  // Channel dropdown for the rule form
  els.ruleChannelSelect.innerHTML = '';
  for (const id of ids) {
    const opt = document.createElement('option');
    opt.value = id;
    opt.textContent = `${cfg.channels[id].label} (${cfg.channels[id].serverUrl})`;
    els.ruleChannelSelect.appendChild(opt);
  }

  // Rule table
  els.ruleTbody.innerHTML = '';
  for (const rule of cfg.rules) {
    const tr = document.createElement('tr');

    const tdPattern = document.createElement('td');
    tdPattern.textContent = rule.pattern;

    const tdChannel = document.createElement('td');
    const ch = cfg.channels[rule.channelId];
    tdChannel.textContent = ch ? `${ch.label} (${ch.serverUrl})` : t('options_ruleChannelDeleted');

    const tdDel = document.createElement('td');
    const delBtn = document.createElement('button');
    delBtn.textContent = t('options_deleteBtn');
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
    els.status.textContent = t('options_insecureWarning');
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
    els.status.textContent = t('options_joinFillAll');
    return;
  }

  const warned = warnIfInsecure(serverUrl);

  await saveChannel(null, { label, serverUrl, channelName: name, channelKey: key });

  els.joinServerUrl.value = '';
  els.joinName.value = '';
  els.joinKey.value = '';
  els.joinLabel.value = '';

  if (!warned) els.status.textContent = t('options_joinSuccess', [label || name]);
  render();
});

els.createNew.addEventListener('click', async () => {
  const serverUrl = normalizeServerUrl(els.createServerUrl.value);
  const name = els.newChannelName.value.trim();
  const label = els.createLabel.value.trim();

  if (!serverUrl) {
    els.status.textContent = t('options_needServerUrl');
    return;
  }
  if (!name) {
    els.status.textContent = t('options_needChannelName');
    return;
  }

  const warned = warnIfInsecure(serverUrl);
  if (!warned) els.status.textContent = t('options_creating');

  try {
    const headers = { 'Content-Type': 'application/json' };
    const secret = els.registerSecret.value.trim();
    if (secret) headers['X-Register-Secret'] = secret;

    const res = await fetch(`${serverUrl}/api/create_channel`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ channel_name: name }),
    });
    const json = await res.json();

    if (!res.ok) {
      els.status.textContent = t('options_createFailed', [json.error || String(res.status)]);
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

    els.status.textContent = t('options_createSuccess', [serverUrl, json.channel_name, json.channel_key]);
    render();
  } catch (e) {
    els.status.textContent = t('options_requestError', [e.message]);
  }
});

els.addRuleBtn.addEventListener('click', async () => {
  const pattern = els.ruleDomain.value.trim().replace(/^\.+/, '').toLowerCase();
  const channelId = els.ruleChannelSelect.value;

  if (!pattern) {
    els.status.textContent = t('options_needDomain');
    return;
  }
  if (!channelId) {
    els.status.textContent = t('options_needChannelForRule');
    return;
  }

  await addRule(pattern, channelId);
  els.ruleDomain.value = '';
  els.status.textContent = t('options_ruleAdded', [pattern]);
  render();
});

render();
