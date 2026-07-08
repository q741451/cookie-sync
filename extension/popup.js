const domainEl = document.getElementById('domain');
const channelEl = document.getElementById('channel');
const statusEl = document.getElementById('status');
const uploadBtn = document.getElementById('upload');

function authHeaders(channelName, key) {
  return {
    'X-Channel-Name': channelName,
    'X-Channel-Key': key,
  };
}

async function getCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  return tab;
}

// In the default "spanning" incognito mode, this popup script always runs in
// the extension's regular (non-incognito) context, even when opened from an
// incognito window. chrome.cookies.set/getAll default to that context's
// cookie store if no storeId is given — meaning they'd silently read/write
// the *normal* cookie jar instead of the incognito tab's own memory-only
// store. We look up the store that actually contains this tab's id and pass
// it explicitly so cookie reads/writes land in the right place.
async function getStoreIdForTab(tab) {
  const stores = await chrome.cookies.getAllCookieStores();
  const match = stores.find((s) => s.tabIds.includes(tab.id));
  return match ? match.id : undefined;
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
      const suffix = canUpload(resolvedChannel) ? '' : t('popup_readOnlySuffix');
      channelEl.textContent = (viaRule
        ? t('popup_usingChannelRule', [resolvedChannel.label, resolvedChannel.serverUrl])
        : t('popup_usingChannelDefault', [resolvedChannel.label, resolvedChannel.serverUrl])) + suffix;
    }

    // A device holding only a read-only key can never upload — hide the
    // button entirely instead of letting the user hit a permission error.
    uploadBtn.style.display = (resolvedChannel && !canUpload(resolvedChannel)) ? 'none' : '';
  } catch (e) {
    domainEl.textContent = t('popup_cannotGetSite');
  }
}

const initPromise = init();

document.getElementById('settingsLink').addEventListener('click', () => {
  chrome.runtime.openOptionsPage();
});

uploadBtn.addEventListener('click', async () => {
  await initPromise;

  if (!resolvedChannel) {
    statusEl.textContent = t('popup_needSetup');
    return;
  }
  if (!canUpload(resolvedChannel)) {
    // Shouldn't normally be reachable since the button is hidden, but
    // guard anyway in case resolvedChannel changed between render and click.
    statusEl.textContent = t('popup_readOnlyCannotUpload');
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
    const storeId = await getStoreIdForTab(tab);
    const cookies = await chrome.cookies.getAll({ url: tab.url, storeId });

    const res = await fetch(`${resolvedChannel.serverUrl}/api/upload`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(resolvedChannel.channelName, resolvedChannel.writeKey),
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
    const tab = await getCurrentTab();
    const key = credentialFor(resolvedChannel, 'download');
    const res = await fetch(
      `${resolvedChannel.serverUrl}/api/download?domain=${encodeURIComponent(currentHostname)}`,
      { headers: authHeaders(resolvedChannel.channelName, key) }
    );
    const json = await res.json();

    if (!res.ok) {
      statusEl.textContent = t('popup_downloadFailed', [json.error]);
      return;
    }

    let okCount = 0;
    const storeId = await getStoreIdForTab(tab);
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
          storeId,
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
