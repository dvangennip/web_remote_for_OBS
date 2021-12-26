# obs_web_remote
Web remote UI for controlling OBS Studio via websockets

## Features
- Switch between scenes
- Scene previews
    - Updates every 2 seconds for Program and Preview scenes
    - Updates every 10 seconds for inactive scenes
- Control audio sources
    - Mute/unmute
    - Volume
    - Filter settings (not all filters are supported)
- A few custom adjustments to known scene elements (not generic)

## How to use
1. Start OBS. Make sure [obs-websocket plugin](https://github.com/obsproject/obs-websocket) is installed (v4.9.1).
2. Start a local webserver in the root folder for this repo, for example using `python3 -m http.server`
3. Point browser to `localhost:8000` (or any other port your server indicates)
4. Control OBS via the webpage.
    - You'll have to enter the obs-websocket on the page before connecting.
    - Code relies on [obs-websocket-js](https://github.com/obs-websocket-community-projects/obs-websocket-js) (included here)

## Known issues
- Start/stop streaming and recording buttons are not functional yet.
- Audio filter settings don't pick up changes made in OBS directly (or any made via other obs-websocket clients).
- Basic class for Camera Control included that's not functional in any way.
- For more, see [Issues](/issues)

## License
- [Unlicense](https://unlicense.org/): This is free and unencumbered software released into the public domain.
- Icons used are from [lucide.dev](https://lucide.dev/) (see [their license](https://github.com/lucide-icons/lucide/blob/master/LICENSE))
