# OBS web remote
Web remote UI for controlling OBS Studio via the obs-websocket plugin

[Use it online now](https://dvangennip.github.io/obs_web_remote/)

## How to use
1. Start OBS. Make sure [obs-websocket plugin](https://github.com/obsproject/obs-websocket) is installed (v4.9.1).
2. Point browser to [`index.html`](/index.html) (or use the link above)
3. Control OBS via the webpage.
    - You'll have to enter the obs-websocket connection details on the page before connecting.
    - Code relies on [obs-websocket-js](https://github.com/obs-websocket-community-projects/obs-websocket-js) (included here)

## Features
- Enable/disable Studio Mode (hotkey: `S`)
- Switch between scenes
    - Transition hotkey: `T` (only when in Studio Mode)
    - Left click to switch to scene or (when in Studio Mode) set Preview scene
    - Use `0-9` to set numbered scene (only available for the first ten scenes)
    - Right click (or `ctrl + [0-9]`) to immediately set scene as Program (when in Studio Mode)
- Scene previews
    - Updates every 2 seconds for Program and Preview scenes
    - Updates every 10 seconds for inactive scenes
- Control audio sources
    - Mute/unmute
    - Volume
    - Filter settings (not all filters are supported)
- Fullscreen toggle hotkey: `F`
- A few custom adjustments to known scene elements (not generic, so this would need omitting)

## Notes and known issues
- Any scenes with `hidden` or `subscene` in their name are ignored and not shown in the scene list.
- Start/stop streaming and recording buttons are not functional yet.
- Audio filter settings don't pick up changes made in OBS directly (nor any changes made via other obs-websocket clients).
- Audio list has space dedicated for visual audio volume meters, functionality not yet available in obs-websocket.
- Basic class for Camera Control included that's not functional besides a UI mock-up.
- For more, see [Issues](https://github.com/dvangennip/obs_web_remote/issues)

## License
- [Unlicense](https://unlicense.org/): This is free and unencumbered software released into the public domain.
- Icons used are from [lucide.dev](https://lucide.dev/) (see [their license](https://github.com/lucide-icons/lucide/blob/master/LICENSE))
