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
    window.wrc = new WebRemoteConnection();
    window.wr  = new WebRemote();

    window.setTimeout(wrc.autoConnect.bind(wrc), 1000);
}, false);