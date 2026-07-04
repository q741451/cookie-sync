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

// Current site's hostname, and the channel resolved via "site rules -> default
// channel" (the channel object carries its own serverUrl/channelName/channelKey,
// no global server address involved anymore).
let currentHostname = null;
let resolvedChannel = null;

async function init() {
  const cfg = await getFullConfig();

  try {
    const tab = await getCurrentTab();
    const url = new URL(tab.url);
    if (!/^https?:$/.test(url.protocol)) {
      domainEl.textContent = t('popup_notWebPage');
      channelEl.textContent = '';
      return;
    }

    currentHostname = url.hostname;
    const channelId = matchChannelForHost(currentHostname, cfg);
    resolvedChannel = channelId ? cfg.channels[channelId] : null;

    domainEl.textContent = t('popup_currentSite', [currentHostname]);

    if (!resolvedChannel) {
      channelEl.textContent = t('popup_noChannelHint');
    } else {
      const viaRule = isRuleMatch(currentHostname, cfg, channelId);
      channelEl.textContent = viaRule
        ? t('popup_usingChannelRule', [resolvedChannel.label, resolvedChannel.serverUrl])
        : t('popup_usingChannelDefault', [resolvedChannel.label, resolvedChannel.serverUrl]);
    }
  } catch (e) {
    domainEl.textContent = t('popup_cannotGetSite');
  }
}

const initPromise = init();

document.getElementById('settingsLink').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

document.getElementById('upload').addEventListener('click', async () => {
  await initPromise;

  if (!resolvedChannel) {
    statusEl.textContent = t('popup_needSetup');
    return;
  }

  const tab = await getCurrentTab();
  statusEl.textContent = t('popup_uploading');
  try {
    // Query by URL rather than by domain string:
    // chrome.cookies.getAll({domain}) only matches that domain and its
    // subdomains, so it misses cookies set on a parent domain. Querying by
    // {url: full page address} matches what the browser would actually send
    // for that page, which naturally includes parent-domain cookies.
    const cookies = await chrome.cookies.getAll({ url: tab.url });

    const res = await fetch(`${resolvedChannel.serverUrl}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(resolvedChannel.channelName, resolvedChannel.channelKey),
      },
      body: JSON.stringify({ domain: currentHostname, cookies }),
    });
    const json = await res.json();

    statusEl.textContent = res.ok
      ? t('popup_uploadSuccess', [String(json.count), resolvedChannel.label])
      : t('popup_uploadFailed', [json.error]);
  } catch (e) {
    statusEl.textContent = t('popup_requestError', [e.message]);
  }
});

document.getElementById('download').addEventListener('click', async () => {
  await initPromise;

  if (!resolvedChannel) {
    statusEl.textContent = t('popup_needSetup');
    return;
  }

  statusEl.textContent = t('popup_downloading');
  try {
    const res = await fetch(
      `${resolvedChannel.serverUrl}/api/download?domain=${encodeURIComponent(currentHostname)}`,
      { headers: authHeaders(resolvedChannel.channelName, resolvedChannel.channelKey) }
    );
    const json = await res.json();

    if (!res.ok) {
      statusEl.textContent = t('popup_downloadFailed', [json.error]);
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
        console.warn('failed to set cookie:', c.name, err);
      }
    }

    const updatedAt = new Date(json.updated_at * 1000).toLocaleString();
    statusEl.textContent = t('popup_restoreSuccess', [
      String(okCount),
      String(json.cookies.length),
      resolvedChannel.label,
      updatedAt,
    ]);
  } catch (e) {
    statusEl.textContent = t('popup_requestError', [e.message]);
  }
});
