/**
 * Shared i18n helper for popup.html and options.html.
 *
 * Chrome automatically translates manifest.json fields (name/description)
 * via _locales/<lang>/messages.json + "__MSG_key__" syntax. Regular HTML
 * pages don't get that for free, so this walks the DOM once on load and
 * fills in text for any element tagged with data-i18n / data-i18n-placeholder
 * / data-i18n-title.
 */
function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => {
    const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n'));
    if (msg) el.textContent = msg;
  });

  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => {
    const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-placeholder'));
    if (msg) el.setAttribute('placeholder', msg);
  });

  root.querySelectorAll('[data-i18n-title]').forEach((el) => {
    const msg = chrome.i18n.getMessage(el.getAttribute('data-i18n-title'));
    if (msg) el.setAttribute('title', msg);
  });
}

// Thin wrapper so callers don't need to remember chrome.i18n.getMessage's
// slightly awkward substitutions argument shape.
function t(key, substitutions) {
  return chrome.i18n.getMessage(key, substitutions);
}

document.addEventListener('DOMContentLoaded', () => applyI18n());
