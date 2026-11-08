/**
 * Connection to OBS through obs-websocket (protocol v5).
 *
 * Protocol surface used by the rest of the app:
 *	call(requestType, requestData)  -> Promise<responseData>
 *	safeCall(requestType, data)     -> Promise<responseData|null>
 *	batch(requests, options)        -> Promise<Array<{ok, requestType, data, error}>>
 *	on(eventName, handler) / off(eventName, handler)
 *	connect() / disconnect()
 */

const DEFAULT_PORT          = 4455;
const RECONNECT_BASE_DELAY  = 1000;
const RECONNECT_MAX_DELAY   = 30000;

const LIFECYCLE_EVENTS = new Set(['connected', 'disconnected', 'error', 'identifyFailed']);

// All subscription categories plus the high-volume meters and per-input active state.
const EVENT_SUBSCRIPTIONS = (typeof OBSWebSocket.EventSubscription === 'object')
	? OBSWebSocket.EventSubscription.All
		| OBSWebSocket.EventSubscription.InputVolumeMeters
		| OBSWebSocket.EventSubscription.InputActiveStateChanged
	: 4095 | 65536 | 131072; // All | InputVolumeMeters | InputActiveStateChanged

export default class WebRemoteConnection {
	constructor () {
		this.connected              = false;
		this.authenticated          = false;
		this.latest_connection_data = undefined;

		this.obs                    = new OBSWebSocket();

		this.host                   = localStorage.getItem('host') || 'localhost:' + DEFAULT_PORT;
		this.password               = localStorage.getItem('password') || '';
		this.secure                 = false;
		this.secure_host            = false;

		this._obs_version           = null;
		this._websocket_version     = null;
		this._rpc_version           = null;
		this._available_requests    = [];
		this._identified            = false;
		this._identified_promise    = null;
		this._close_seen            = false;
		this._reconnect_timer       = null;
		this._reconnect_attempts    = 0;
		this._manual_disconnect     = false;
		this._listeners             = new Map();

		this.edit_pane              = document.getElementById('obs_ws_connection_edit_list');
		this.host_input             = document.getElementById('obs_ws_host');
		this.password_input         = document.getElementById('obs_ws_password');
		this.connect_button         = document.getElementById('obs_ws_connect');
		this.message_output         = document.getElementById('obw_ws_messages');

		this.host_input.value       = this.host;
		this.password_input.value   = this.password;

		this.obs.on('Identified', data => this.on_identified(data));
		this.obs.on('ConnectionClosed', e => this.on_connection_closed(e));
		this.obs.on('ConnectionError', e => this.on_connection_error(e));
		this.obs.on('error', e => this.on_connection_error(e));

		// set up connection pane
		this.host_input.addEventListener('input',  this.on_host_input_change.bind(this));
		this.host_input.addEventListener('change', this.on_host_input_change.bind(this));
		this.on_host_input_change(); // trigger once to setup proper feedback

		document.getElementById('btn_toggle_connect').addEventListener('click', this.toggle_form.bind(this));
		this.connect_button.addEventListener('click', this.connect_form.bind(this));
	}

	// --- protocol surface ----------------------------------------------------

	async call (requestType, requestData) {
		return await this.obs.call(requestType, requestData);
	}

	async safeCall (requestType, requestData) {
		try {
			return await this.call(requestType, requestData);
		} catch (e) {
			const code = (e && e.code !== undefined) ? e.code : 'unknown';
			const text = (e && e.message) ? e.message : String(e);
			console.warn(`[obs] ${requestType} failed with code ${code}: ${text}`);

			return null;
		}
	}

	/**
	 * Run a batch, one entry per request in request order.
	 * A rejected individual request becomes {ok: false, error: {code, comment}}; the
	 * promise only rejects when the batch itself cannot be delivered.
	 */
	async batch (requests, options) {
		const settings = options || {};
		const batch_options = { haltOnFailure: settings.haltOnFailure === true };

		if (settings.executionType !== null && settings.executionType !== undefined)
			batch_options.executionType = settings.executionType;

		const results = await this.obs.callBatch(requests, batch_options);

		return results.map((res, i) => ({
			ok:          res.requestStatus.result === true,
			requestType: requests[i].requestType,
			data:        res.responseData === undefined ? null : res.responseData,
			error:       res.requestStatus.result === true
				? null
				: { code: res.requestStatus.code, comment: res.requestStatus.comment },
		}));
	}

	on (eventName, handler) {
		if (LIFECYCLE_EVENTS.has(eventName)) {
			if (!this._listeners.has(eventName))
				this._listeners.set(eventName, new Set());
			this._listeners.get(eventName).add(handler);
			return;
		}

		this.obs.on(eventName, handler);
	}

	off (eventName, handler) {
		if (LIFECYCLE_EVENTS.has(eventName)) {
			const set = this._listeners.get(eventName);
			if (set)
				set.delete(handler);
			return;
		}

		this.obs.off(eventName, handler);
	}

	async connect () {
		this._manual_disconnect = false;
		this._close_seen        = false;
		this.clear_reconnect_timer();

		const target = this.check_secure_connection(this.host);
		this.host    = target.host;
		this.host_input.value = this.host;
		this.secure      = target.secure;
		this.secure_host = target.secure_host;

		// a fresh attempt always starts from a closed socket
		if (this._identified || this.obs.socket) {
			this._manual_disconnect = true;
			try {
				await this.obs.disconnect();
			} catch (e) {
				// already closed; nothing to clean up
			}
			this._manual_disconnect = false;
			this._close_seen        = false;
		}

		this.message_output.innerHTML = 'Connecting to ' + target.url + '…';
		this.message_output.classList.remove('good');
		this.message_output.classList.remove('alert');

		try {
			await this.obs.connect(target.url, this.password || undefined, { eventSubscriptions: EVENT_SUBSCRIPTIONS });

			// let the version lookup finish so callers see obsVersion right after connect()
			if (this._identified_promise)
				await this._identified_promise;

			return true;
		} catch (e) {
			this.latest_connection_data = e;
			if (!this._close_seen)
				this.report_connection_failure(e);
			return false;
		}
	}

	async disconnect () {
		this._manual_disconnect  = true;
		this._reconnect_attempts = 0;
		this.clear_reconnect_timer();

		try {
			await this.obs.disconnect();
		} catch (e) {
			// already closed
		}

		this.connected      = false;
		this.authenticated  = false;
		this._identified    = false;
		this.connect_button.innerHTML = 'Connect';

		this.message_output.innerHTML = 'Disconnected.';
		this.message_output.classList.remove('good');
		this.message_output.classList.remove('alert');
	}

	get isConnected () {
		return this.connected && this._identified;
	}

	get obsVersion () {
		return this._obs_version;
	}

	get obsWebSocketVersion () {
		return this._websocket_version;
	}

	get rpcVersion () {
		return this._rpc_version;
	}

	get availableRequests () {
		return this._available_requests;
	}

	// --- server lifecycle ----------------------------------------------------

	on_identified (data) {
		this.connected     = true;
		this.authenticated = true;
		this._identified   = true;
		this._close_seen   = false;

		if (data && data.negotiatedRpcVersion !== undefined)
			this._rpc_version = data.negotiatedRpcVersion;

		this._reconnect_attempts = 0;

		this.connect_button.innerHTML = 'Disconnect';
		this.message_output.innerHTML = 'Connected.';
		this.message_output.classList.add('good');
		this.message_output.classList.remove('alert');
		this.edit_pane.classList.add('hidden');

		this._identified_promise = this.after_identified(data);
	}

	async after_identified (data) {
		await this.load_version();
		this.emit('connected', data);
	}

	async load_version () {
		const v = await this.safeCall('GetVersion');
		if (!v)
			return;

		this._obs_version        = v.obsVersion;
		this._websocket_version  = v.obsWebSocketVersion;
		this._rpc_version        = v.rpcVersion;
		this._available_requests = Array.isArray(v.availableRequests) ? v.availableRequests : [];

		const secureText = this.secure ? 'secure' : 'insecure';
		this.message_output.innerHTML = `Connected (over ${secureText} connection) to obs-websocket v${v.obsWebSocketVersion} on OBS v${v.obsVersion}.`;
	}

	on_connection_error (e) {
		console.error('socket error:', e);
		this.latest_connection_data = e;
		this.emit('error', e);
	}

	on_connection_closed (e) {
		this._close_seen   = true;
		this.connected     = false;
		this.authenticated = false;
		this._identified   = false;

		this.emit('disconnected', e);

		if (this._manual_disconnect) {
			// disconnect() reports the state itself, a new connect() reports its own attempt
			this.connect_button.innerHTML = 'Connect';
			return;
		}

		console.log('Disconnected');
		this.latest_connection_data = e;
		this.report_connection_failure(e);

		if (e && (e.code === 4009 || e.code === 4010))
			return; // do not hammer a server that rejects us

		this.schedule_reconnect();
	}

	report_connection_failure (e) {
		const code = e && e.code;
		const secureText = this.secure ? '' : 'in';

		if (code === 4009) {
			this.message_output.innerHTML = `Not connected (over ${secureText}secure connection): authentication failed. The obs-websocket password is wrong.`;
			this.message_output.classList.add('alert');
			this.message_output.classList.remove('good');
			this.emit('identifyFailed', e);
			return;
		}

		if (code === 4010) {
			this.message_output.innerHTML = `Not connected (over ${secureText}secure connection): the OBS server does not support rpcVersion 1. Update OBS / obs-websocket.`;
			this.message_output.classList.add('alert');
			this.message_output.classList.remove('good');
			this.emit('identifyFailed', e);
			return;
		}

		if (code === 4008) {
			this.message_output.innerHTML = `Not connected (over ${secureText}secure connection): the OBS server rejected the session (already identified).`;
		} else {
			const description = (e && e.message) ? e.message : 'websocket error (check network connection and whether OBS is still responsive)';
			this.message_output.innerHTML = `Not connected (over ${secureText}secure connection): ${description}`;
		}

		this.message_output.classList.add('alert');
		this.message_output.classList.remove('good');

		if (code === 1006 || code === undefined) {
			this.message_output.innerHTML += '<br/>If OBS is running on the host, perhaps it cannot be reached on this protocol and/or port.';

			if (location.protocol === 'https:' && !this.secure_host) {
				this.message_output.innerHTML += '<br/>You are connected securely to this page. Connecting to an insecure host may not be allowed by your browser security settings.';
			}
		}
	}

	schedule_reconnect () {
		if (this._manual_disconnect || this._reconnect_timer !== null)
			return;

		const delay = Math.min(RECONNECT_BASE_DELAY * Math.pow(2, this._reconnect_attempts), RECONNECT_MAX_DELAY);
		this._reconnect_attempts += 1;

		this._reconnect_timer = window.setTimeout(() => {
			this._reconnect_timer = null;
			if (!this._manual_disconnect)
				this.connect();
		}, delay);
	}

	clear_reconnect_timer () {
		if (this._reconnect_timer !== null) {
			window.clearTimeout(this._reconnect_timer);
			this._reconnect_timer = null;
		}
	}

	emit (eventName, payload) {
		const set = this._listeners.get(eventName);
		if (!set)
			return;

		for (const handler of set) {
			try {
				handler(payload);
			} catch (e) {
				console.error(`error in "${eventName}" handler:`, e);
			}
		}
	}

	// --- UI ------------------------------------------------------------------

	autoConnect () {
		if (this.password)
			this.connect();
	}

	connect_form () {
		let host     = this.host_input.value.trim();
		let password = this.password_input.value;

		if (!host)
			host = 'localhost:' + DEFAULT_PORT;

		this.host     = host;
		this.password = password;

		localStorage.setItem('host', host);
		localStorage.setItem('password', password);

		if (this.isConnected)
			this.disconnect();
		else
			this.connect();
	}

	toggle_form () {
		this.edit_pane.classList.toggle('hidden');
	}

	on_host_input_change (e) {
		let sec_check = this.check_secure_connection(this.host_input.value);

		this.host_input.parentElement.classList.toggle('secure', sec_check.secure_host);
	}

	/**
	 * Turn the host field into a websocket URL.
	 * Accepts a bare host, host:port, or a full ws:// / wss:// (or http:// / https://) URL.
	 * Missing ports default to 4455, the obs-websocket v5 default.
	 */
	check_secure_connection (host) {
		let input = (host || '').trim();
		if (!input)
			input = 'localhost';

		let secure      = location.protocol === 'https:';
		let secure_host = false;

		if (/^(wss?|https?):\/\//i.test(input)) {
			let url = new URL(input);

			secure      = url.protocol === 'wss:' || url.protocol === 'https:';
			secure_host = secure;

			let port = url.port || (secure ? '443' : String(DEFAULT_PORT));
			let path = (url.pathname && url.pathname !== '/') ? url.pathname : '';

			return {
				secure:      secure,
				secure_host: secure_host,
				host:        `${url.hostname}:${port}`,
				url:         `${secure ? 'wss' : 'ws'}://${url.hostname}:${port}${path}`,
			};
		}

		secure_host = input.endsWith(':443');
		secure      = secure || secure_host;

		let match  = input.match(/^(.+):(\d+)$/);
		let name   = match ? match[1] : input;
		let port   = match ? match[2] : String(DEFAULT_PORT);

		return {
			secure:      secure,
			secure_host: secure_host,
			host:        `${name}:${port}`,
			url:         `${secure ? 'wss' : 'ws'}://${name}:${port}`,
		};
	}
}
