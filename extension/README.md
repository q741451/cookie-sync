# Cookie Channel Sync - Chrome Extension

Works together with `go-server/` in this repo. Manually upload/download
cookies for the current site, grouped and isolated by channel.

The UI follows your browser's language automatically (English and Chinese
are included; see "Adding a language" below to add more).

## Install (developer mode)

1. Open `chrome://extensions`
2. Turn on "Developer mode" (top right)
3. Click "Load unpacked" and select this `extension/` folder

## Usage

1. Click the extension icon, then click "Settings: server / channel"
2. Add a channel. **The server address belongs to the channel itself** —
   different channels can point to entirely different servers:
   - **Join an existing channel**: enter the server address plus the
     channel name and key someone shared with you; optionally give it a
     label just for your own reference
   - **Create a new channel**: enter the server address and a new channel
     name; the server generates a key for you automatically
   - The first channel you add becomes the default automatically; you can
     switch the default anytime from the channel table
3. (Optional) Add a site rule if some sites should use a specific channel
   instead of the default — e.g. domain `jd.com` mapped to a channel will
   automatically match every subdomain like `order.jd.com` and `www.jd.com`.
   Sites without a matching rule always use the default channel.
4. On any site, click the extension icon — it shows which channel and
   server will be used:
   - "Upload cookies for this site": pushes this site's cookies to that
     channel
   - "Download cookies for this site": pulls cookies for this site from
     that channel and writes them back into the browser

## Notes

- Everyone who has a channel's name + key can read and write its data —
  only share these with people you trust
- The channel key is shown in plaintext only once, at creation time —
  back it up somewhere safe (e.g. a password manager)
- Downloading overwrites same-name cookies already set for that domain in
  your browser — make sure that's what you want
- Site rules match by domain **suffix** (`jd.com` matches all `*.jd.com`);
  when multiple rules match, the most specific (longest) one wins
- Older versions of this extension's local data (single channel, or
  multiple channels sharing one server) are migrated automatically the
  first time you open the extension — nothing to redo by hand

## Adding a language

Translations live under `_locales/<lang>/messages.json`
(see [Chrome's i18n docs](https://developer.chrome.com/docs/extensions/reference/api/i18n)
for supported language codes). To add one:

1. Copy `_locales/en/messages.json` into a new `_locales/<lang>/messages.json`
2. Translate the `message` values (keep the `$PLACEHOLDER$` tokens and the
   `placeholders` blocks exactly as they are)
3. Reload the extension — Chrome picks the locale automatically based on
   your browser's language settings
