/**
 * OBS_web_remote code
 */

import WebRemoteConnection from './WebRemoteConnection.js';
import WebRemote from './WebRemote.js';

// ----------------------------------------------------------------------------

/**
 * Wait for whole page to load before setting up.
 * Prevents problems with objects not loaded yet while trying to assign these.
 */
window.addEventListener('pageshow', function () {
    // 'pageshow' fires on the initial load and again on every bfcache restore.
    // A restore brings the JS heap back with the document, so the live pair is
    // already correct and building a second one is never what the page wants:
    // it orphans an open socket plus its reconnect timer and the old clock /
    // poll chain, and the module latches in SourceAudio, ObsResolve and
    // SourceScene stay bound to the old socket. A genuine reload starts with a
    // fresh heap, so window.wrc is undefined and this guard is a no-op.
    if (window.wrc)
        return;

    window.wrc = new WebRemoteConnection();
    window.wr  = new WebRemote();

    // Lifecycle wiring. The latch keeps one polling chain per connection: a
    // duplicate 'connected' is dropped, and a late 'disconnected' from an
    // already-replaced socket cannot tear down the new chain.
    let is_connected = false;

    wrc.on('connected', function () {
        if (is_connected)
            return;

        is_connected = true;
        wr.on_connected();
    });

    wrc.on('disconnected', function () {
        if (!is_connected)
            return;

        is_connected = false;
        wr.on_disconnected();
    });

    window.setTimeout(wrc.autoConnect.bind(wrc), 1000);
}, false);
