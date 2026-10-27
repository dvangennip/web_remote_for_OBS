# OBS 30 + legacy Web Remote on Ubuntu 24.04

[Leia este guia em português (Brasil)](obs30-ubuntu2404-pt-BR.md).

Tested with OBS Studio `30.0.2+dfsg-3build1` and `obs-websocket-compat` `4.9.1` on Ubuntu 24.04 (amd64). This [remote](https://github.com/dvangennip/web_remote_for_OBS) uses the WebSocket **v4** protocol; OBS 30's built-in server on port `4455` uses **v5**. Use a separate v4 compatibility server instead. This guide does not add v5 support to the remote.

## 1. Install the v4 compatibility plugin

Download the **4.9.1-compat Qt6 Ubuntu 64-bit `.deb`** from the [official obs-websocket releases](https://github.com/obsproject/obs-websocket/releases#release-4.9.1-compat). In the download directory, check the filename and run:

```bash
sudo apt install ./obs-websocket-4.9.1-compat-Qt6-Ubuntu64.deb
```

The release's Ubuntu package was built for an older Ubuntu version; other installations may need a different solution.

## 2. Fix the plugin path if OBS does not load it

Restart OBS and look for separate legacy WebSocket settings under **Tools**. If they do not appear, check the installed file:

```bash
dpkg -L obs-websocket-compat | grep '\.so$'
```

On the tested system it was `/usr/obs-plugins/64bit/obs-websocket-compat.so`, outside the directory used by the distribution's OBS plugins. **Close OBS**, then create a symlink in your user plugin directory:

```bash
mkdir -p "$HOME/.config/obs-studio/plugins/obs-websocket-compat/bin/64bit"
ln -s /usr/obs-plugins/64bit/obs-websocket-compat.so \
  "$HOME/.config/obs-studio/plugins/obs-websocket-compat/bin/64bit/obs-websocket-compat.so"
```

Adjust the source path if `dpkg -L` shows a different one. Do not overwrite an existing destination. Restart OBS. If the legacy settings still do not appear, inspect the current OBS log for plugin-loading errors or missing libraries; a symlink cannot fix an incompatible binary.

## 3. Connect the remote

Enable the **legacy/compat** WebSocket server in OBS, set its password, and note its port (usually `4444`). Do not use the built-in v5 server on `4455`.

Serve the remote from the directory containing its `index.html`:

```bash
python3 -m http.server 8000
```

Open `http://localhost:8000/` and enter the OBS machine's IP and **legacy** port, for example `192.168.15.71:4444`, and the legacy server's password. Replace the example IP with yours. For this local HTTP setup, use `ws://` rather than `wss://` unless TLS has been configured separately. A page served over HTTPS may block `ws://` connections.

## If it does not connect

```bash
ss -ltnp | grep -E ':(4444|4455)\b'
```

- Only `4455` is listening: check whether the compat plugin loaded and its separate server is enabled.
- OBS logs `pre-5.0.0 protocol` / `4010`: the v4 client is connecting to the v5 server; use the legacy port.
- The legacy menu is missing: in OBS, open **Help → Log Files → View Current Log** and check for `obs-websocket-compat` loading errors.

Do not expose an OBS WebSocket server without authentication to the public Internet. The paths above describe one tested setup, not every Ubuntu installation.