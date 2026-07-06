# Privacy Policy / 隐私权政策

**Cookie Channel Sync ("Cookie 频道同步")**

Last updated: 2026-07-06 / 最后更新：2026-07-06

---

## English

### What this extension does

Cookie Channel Sync lets you manually back up your own browser cookies to a
server you control, and restore them later. Every upload and download is
triggered by you clicking a button in the extension popup — there is no
background or automatic syncing.

### What data is accessed

- **Cookies** for the website you are currently viewing, read and written
  via Chrome's `cookies` API, only when you click "Upload" or "Download."
- **The URL of your active tab**, used only to determine which website's
  cookies to act on.
- **Your channel configuration** (server address, channel name, and the
  write/read-only key you were given when the channel was created), stored
  locally in your browser via `chrome.storage.local`.

### Where your data goes

When you click **Upload**, the extension sends the current site's cookies
to the server address configured for that channel — a server that you (or
someone you trust) deployed yourself, using the open-source companion
server in this project's repository. When you click **Download**, the
extension requests cookies back from that same server and writes them into
your browser.

**The developer of this extension does not operate any server, does not
receive your cookies or configuration data, and has no access to any data
you sync.** All data goes directly from your browser to the server address
you typed in — nowhere else.

### What this extension does not do

- It does not collect analytics, telemetry, or usage statistics.
- It does not read or transmit page content, browsing history, passwords,
  payment information, health information, or location data.
- It does not share, sell, or transfer any data to third parties.
- It does not run any remote or dynamically-loaded code; all code ships
  inside the extension package.

### Your responsibility as a self-hoster

Because this extension talks to a server you deploy yourself, the security
and privacy of your synced cookies also depend on how you configure and
secure that server (e.g., using HTTPS, keeping your keys secret, and
following the guidance in the project's README). The developer of the
extension is not responsible for servers operated by users.

### Data retention and deletion

Cookie data you upload is stored on your own server until you delete it
there (see the server's README for how). Local configuration stored by the
extension (server address, channel name, keys) can be removed at any time
from the extension's options page, or by uninstalling the extension.

### Changes to this policy

If this policy changes, the updated version will be posted at this same
URL with a new "Last updated" date.

### Contact

Questions about this policy or the extension can be raised via the GitHub
repository's Issues page: `https://github.com/q741451/cookie-sync/issues`

---

## 中文

### 这个插件做什么

Cookie 频道同步可以让你把自己浏览器里的 Cookie，手动备份到你自己控制的服
务器上，并在需要时恢复回来。每一次上传和下载都是你在插件弹出窗口里主动点
击按钮触发的——没有任何后台自动同步。

### 会访问哪些数据

- **当前网站的 Cookie**：仅在你点击"上传"或"下载"按钮时，通过 Chrome 的
  `cookies` API 读取或写入。
- **当前标签页的网址**：仅用于判断要操作哪个网站的 Cookie。
- **你的频道配置**（服务器地址、频道名，以及创建频道时获得的读写密钥/只
  读密钥）：通过 `chrome.storage.local` 保存在你本地浏览器中。

### 数据会去哪里

当你点击**上传**时，插件会把当前网站的 Cookie 发送到你为该频道配置的服务
器地址——这个服务器由你自己（或你信任的人）部署，使用的是本项目仓库中开
源的配套服务端程序。当你点击**下载**时，插件会向同一台服务器请求取回
Cookie，并写回你的浏览器。

**本插件的开发者不运营任何服务器，不会收到你的 Cookie 或配置数据，对你同
步的任何数据都没有访问权限。** 所有数据都是从你的浏览器直接发送到你自己
填写的服务器地址，不会经过其他任何地方。

### 这个插件不会做什么

- 不收集任何统计分析、使用数据或遥测信息。
- 不读取或传输网页内容、浏览历史、密码、支付信息、健康信息或位置信息。
- 不会向任何第三方分享、出售或转让任何数据。
- 不运行任何远程代码或动态加载的代码，所有代码都打包在插件安装包内。

### 作为自建服务器使用者需要承担的责任

因为本插件对接的是你自己部署的服务器，所以你同步的 Cookie 数据的安全性和
隐私性，也取决于你如何配置和保护这台服务器（例如是否启用 HTTPS、是否妥善
保管密钥、是否遵循项目 README 中的安全建议）。插件开发者对用户自行运营的
服务器不承担责任。

### 数据保留与删除

你上传的 Cookie 数据保存在你自己的服务器上，直到你在服务器端将其删除（具
体方法见服务端项目的 README）。插件本地保存的配置信息（服务器地址、频道
名、密钥）可以随时在插件的设置页面中删除，或者通过卸载插件移除。

### 政策变更

如果本政策有更新，最新版本会发布在同一个网址上，并更新"最后更新"日期。

### 联系方式

对本政策或插件有任何疑问，可以通过 GitHub 仓库的 Issues 页面反馈：
`https://github.com/q741451/cookie-sync/issues`
