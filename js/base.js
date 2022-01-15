/**
 * OBS_web_remote code
 */

import OBS from './OBS.js';
import OBSRemote from './OBSRemote.js';

// ----------------------------------------------------------------------------

/**
 * Wait for whole page to load before setting up.
 * Prevents problems with objects not loaded yet while trying to assign these.
 */
window.addEventListener('pageshow', function () {
    window.obs  = new OBS();
    window.obsr = new OBSRemote();

    window.setTimeout(obs.autoConnect.bind(obs), 1000);
}, false);