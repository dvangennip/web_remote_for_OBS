# obs_web_remote
Web remote UI for controlling OBS Studio via websockets

This version is suitable even for very old browsers (tested on a HP Pre3 with webOS 2.2, a 2011 device).

## How to use
1. Start OBS. Make sure [obs-websocket plugin](https://github.com/obsproject/obs-websocket) is installed (v4.9.0).
2. Adjust settings in `sws_http_config.ini`, in particular the obs-websocket connection address and password.
3. Run `sws_http_server.py`
    - This provides a server from which pages and socket commands are served.
    - It's essentially the [simpleobsws](https://github.com/IRLToolkit/simpleobsws) code with a few minor tweaks to also serve static pages.
4. Point browser to `localhost:4445`
5. Control OBS via the webpage.