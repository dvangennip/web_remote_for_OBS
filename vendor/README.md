# Vendored client

- Package: `obs-websocket-js`
- Version: `5.0.8` (exact)
- File: `dist/obs-ws.global.js`
- Source: https://cdn.jsdelivr.net/npm/obs-websocket-js@5.0.8/dist/obs-ws.global.js
- sha256: `4389e834e49f8eb73d79460b696ef0886c19f3755463ce1f7db85bd9b9d03343`

The browser bundle is checked in because this repo has no build step: `index.html` loads it
as a classic script and the app uses the global `OBSWebSocket` (plus `OBSWebSocket.EventSubscription`).
License: MIT, see `obs-websocket-js.LICENSE`.
