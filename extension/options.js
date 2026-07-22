const els = {
  syncToggle: document.getElementById('syncToggle'),
  syncStatus: document.getElementById('syncStatus'),

  channelTbody: document.getElementById('channelTbody'),

  joinServerUrl: document.getElementById('joinServerUrl'),
  joinName: document.getElementById('joinName'),
  joinKey: document.getElementById('joinKey'),
  joinKeyType: document.getElementById('joinKeyType'),
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

async function renderSyncSection() {
  const enabled = await isSyncEnabled();
  els.syncToggle.checked = enabled;
  els.syncStatus.textContent = enabled
    ? t('options_syncStatusOn')
    : t('options_syncStatusOff');
}

els.syncToggle.addEventListener('change', async () => {
  const wantEnabled = els.syncToggle.checked;
  els.syncToggle.disabled = true;
  els.syncStatus.textContent = t('options_syncWorking');

  try {
    const result = await setSyncEnabled(wantEnabled);
    if (result.action === 'seeded') {
      els.syncStatus.textContent = t('options_syncSeeded');
    } else if (result.action === 'adopted') {
      els.syncStatus.textContent = t('options_syncAdopted');
    } else {
      els.syncStatus.textContent = t('options_syncStatusOff');
    }
  } catch (e) {
    els.syncToggle.checked = !wantEnabled; // revert the visual toggle
    els.syncStatus.textContent = (e instanceof SyncQuotaError)
      ? t('options_syncQuotaExceeded')
      : t('options_requestError', [e.message]);
  } finally {
    els.syncToggle.disabled = false;
  }

  render();
});

// If another device pushes a change through chrome.storage.sync while this
// options page is open, reflect it immediately instead of showing a stale
// table until the next manual action.
chrome.storage.onChanged.addListener(async (changes, areaName) => {
  const enabled = await isSyncEnabled();
  const relevantArea = enabled ? 'sync' : 'local';
  if (areaName !== relevantArea) return;

  const touchesSchema = Object.keys(changes).some(
    (k) => k === 'defaultChannelId' || k.startsWith('ch:') || k.startsWith('rule:')
  );
  if (touchesSchema) render();
});

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

    const tdPerm = document.createElement('td');
    tdPerm.textContent = canUpload(ch) ? t('options_permWrite') : t('options_permRead');

    // A channel may hold a write key, a read key, or (rarely, if the user
    // saved both on the same device) both. The "权限" column already says
    // read-write/read-only, so here just show the key itself — only add a
    // short prefix when both are present and need telling apart.
    const tdKey = document.createElement('td');
    const keyEntries = [];
    if (ch.writeKey) keyEntries.push({ prefix: t('options_keyPrefixWrite'), value: ch.writeKey });
    if (ch.readKey) keyEntries.push({ prefix: t('options_keyPrefixRead'), value: ch.readKey });
    const showPrefix = keyEntries.length > 1;
    for (const entry of keyEntries) {
      const line = document.createElement('div');
      line.textContent = (showPrefix ? entry.prefix : '') + maskKey(entry.value);
      line.title = t('options_clickToRevealKey');
      line.style.cursor = 'pointer';
      line.addEventListener('click', () => {
        line.textContent = (showPrefix ? entry.prefix : '') + entry.value;
      });
      tdKey.appendChild(line);
    }

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

    tr.append(tdLabel, tdServer, tdName, tdPerm, tdKey, tdDefault, tdDel);
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
  const keyType = els.joinKeyType.value; // 'write' or 'read'
  const label = els.joinLabel.value.trim();

  if (!serverUrl || !name || !key) {
    els.status.textContent = t('options_joinFillAll');
    return;
  }

  const warned = warnIfInsecure(serverUrl);

  try {
    await saveChannel(null, {
      label,
      serverUrl,
      channelName: name,
      writeKey: keyType === 'write' ? key : null,
      readKey: keyType === 'read' ? key : null,
    });
  } catch (e) {
    els.status.textContent = (e instanceof SyncQuotaError)
      ? t('options_syncQuotaExceeded')
      : t('options_requestError', [e.message]);
    return;
  }

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

    // This device becomes the "main" device for the new channel and keeps
    // the write key (full access). The read_key is shown below so the user
    // can separately set it up on another device via "Join an existing
    // channel" → "Read-only key" if they want a restore-only copy.
    await saveChannel(null, {
      label,
      serverUrl,
      channelName: json.channel_name,
      writeKey: json.write_key,
      readKey: null,
    });

    els.newChannelName.value = '';
    els.registerSecret.value = '';
    els.createLabel.value = '';

    els.status.textContent = t('options_createSuccess', [
      serverUrl, json.channel_name, json.write_key, json.read_key,
    ]);
    render();
  } catch (e) {
    els.status.textContent = (e instanceof SyncQuotaError)
      ? t('options_syncQuotaExceeded')
      : t('options_requestError', [e.message]);
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

  try {
    await addRule(pattern, channelId);
  } catch (e) {
    els.status.textContent = (e instanceof SyncQuotaError)
      ? t('options_syncQuotaExceeded')
      : t('options_requestError', [e.message]);
    return;
  }
  els.ruleDomain.value = '';
  els.status.textContent = t('options_ruleAdded', [pattern]);
  render();
});

renderSyncSection();
render();
