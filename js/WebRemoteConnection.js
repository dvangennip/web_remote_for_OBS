export default class WebRemoteConnection {
	constructor () {
		this.connected              = false;
		this.authenticated          = false;
		this.auth_failure           = false;
		this.latest_connection_data = undefined;
		this.obs                    = new OBSWebSocket();

		this.host                   = localStorage.getItem('host') || 'localhost:4444';
		this.password               = localStorage.getItem('password') || '';
		this.secure                 = false;
		this.secure_host            = false;

		this.edit_pane              = document.getElementById('obs_ws_connection_edit_list');
		this.host_input             = document.getElementById('obs_ws_host');
		this.password_input         = document.getElementById('obs_ws_password');
		this.connect_button         = document.getElementById('obs_ws_connect');
		this.message_output         = document.getElementById('obw_ws_messages');

		this.host_input.value       = this.host;
		this.password_input.value   = this.password;

		// set up event handlers
		this.obs.on('error', e => {
			// this.connected = true;
			console.error('socket error:', e);
			if (e && e.status === undefined)
				e['status']      = 'error';
			if (e && e.description === undefined)
				e['description'] = 'websocket error (check network connection and whether OBS is still responsive)';
			this.latest_connection_data = e;
		});

		this.obs.on('ConnectionOpened', () => {
			this.connect_button.innerHTML = 'Disconnect';
			this.message_output.innerHTML = 'Connection opened.';
			this.message_output.classList.add('good');
			this.message_output.classList.remove('alert');
			this.connected     = true;
			this.authenticated = false;
			this.auth_failure  = false;
		});

		this.obs.on('ConnectionClosed', () => {
			console.log('Disconnected');
			
			if (this.auth_failure) {
				this.message_output.innerHTML = `Not connected (over ${this.secure ? '' : 'in'}secure connection): connection closed after authentication failure.`;
				this.message_output.classList.add('alert');
			} else if (this.latest_connection_data && this.latest_connection_data.status == 'error') {
				this.message_output.innerHTML = `Not connected (over ${this.secure ? '' : 'in'}secure connection): ${this.latest_connection_data.description}`;
				
				if (this.latest_connection_data.code == 'CONNECTION_ERROR'){
					this.message_output.innerHTML += '<br/>If OBS is running on the host, perhaps it cannot be reached on this protocol and/or port.';
					
					if (location.protocol === 'https:' && !this.secure_host) {
						this.message_output.innerHTML += '<br/>Your are connected securely to this page. Connecting to an insecure host may not be allowed by your browser security settings.';

						if (this.secure)
							this.message_output.innerHTML += ' Attempt to enforce a secure connection did not work.';
					}

					if (this.secure)
						this.message_output.innerHTML += '<br/>Suggestion: attempt to prefix the host with <code>ws://</code> to enforce an insecure connection (if the browser allows it). Example: <code>ws://localhost:4444</code>';
					else
						this.message_output.innerHTML += '<br/>Suggestion: attempt to prefix the host with <code>wss://</code> to enforce a secure connection (if the host supports it). Example: <code>wss://localhost:4444</code>';
				}

				this.message_output.classList.add('alert');
			} else {
				this.message_output.innerHTML = 'Not connected: connection closed.';
				this.message_output.classList.remove('alert');
			}
			this.message_output.classList.remove('good');

			this.connected     = false;
			this.authenticated = false;
			this.auth_failure  = false;

			this.connect_button.innerHTML = 'Connect';

			this.edit_pane.classList.remove('hidden');

			wr.on_disconnected();
		});

		this.obs.on('AuthenticationFailure', async () => {
			console.log('Authentication failed.');
			this.message_output.innerHTML = 'Connected but authentication failed.';
			this.message_output.classList.add('alert');
			this.authenticated = false;
			this.auth_failure  = true;

			this.connect_button.innerHTML = 'Connect';

			this.edit_pane.classList.remove('hidden');

			wr.on_disconnected();
		});

		this.obs.on('AuthenticationSuccess', async () => {
			let v = await this.obs.send('GetVersion', {});
			console.log('Connected to obs-websocket v' + v['obs-websocket-version'] + ' on OBS v' + v['obs-studio-version']);
			
			let secureText = 'insecure';
			if (this.secure)
				secureText = 'secure';

			this.message_output.innerHTML = `Connected (over ${secureText} connection) to obs-websocket v${v['obs-websocket-version']} on OBS v${v['obs-studio-version']}.`;
			this.message_output.classList.add('good');
			this.message_output.classList.remove('alert');
			this.authenticated = true;
			this.auth_failure  = false;

			this.edit_pane.classList.add('hidden');
			
			// trigger update processes in WebRemote
			wr.on_connected();
		});

		// set up connection pane
		this.host_input.addEventListener('input',  this.on_host_input_change.bind(this));
		this.host_input.addEventListener('change', this.on_host_input_change.bind(this));
		this.on_host_input_change(); // trigger once to setup proper feedback

		document.getElementById('btn_toggle_connect').addEventListener('click', this.toggle_form.bind(this));
		this.connect_button.addEventListener('click', this.connect_form.bind(this));
	}

	// essentially just pass on to the internal obs.on function
	on (event, func) {
		this.obs.on(event, func);
	}

	toggle_form () {
		this.edit_pane.classList.toggle('hidden');
	}

	on_host_input_change (e) {
		let sec_check = this.check_secure_connection(this.host_input.value);

		this.host_input.parentElement.classList.toggle('secure', sec_check.secure_host);
	}

	check_secure_connection (host) {
		// to figure out whether we ought to connect securely, check details
		//   note that when current connection to page is secure, some browsers will not allow insecure connections
		//   thus, by default enforce secure connection if current page connection is secure
		let secure      = location.protocol === 'https:' || host.endsWith(':443');
		let secure_host = host.endsWith(':443');

		// handle hosts that define the protocol
		if (host.indexOf('://') !== -1) {
			let url = new URL(host);
			
			secure = secure_host = url.protocol === 'wss:' || url.protocol === 'https:';

			host = url.hostname + ':' + (url.port ? url.port : secure ? 443 : 80);
		}

		return {'secure': secure, 'secure_host': secure_host, 'host': host};
	}

	connect_form () {
		if (this.connected) {
			this.disconnect();
		} else {
			let host             = this.host_input.value;
			let password         = this.password_input.value;

			localStorage.setItem('host', host);
			localStorage.setItem('password', password);

			this.connect(host, password);
		}
	}

	async connect (host, password) {
		this.host        = host || this.host;
		this.password    = password || this.password;
		
		let sec_check    = this.check_secure_connection(this.host);
		this.secure      = sec_check.secure;
		this.secure_host = sec_check.secure_host;
		this.host        = sec_check.host;

		console.log(`Connecting to ${this.host} (secure: ${this.secure}, password: ${this.password})`);
		if (this.secure)
			this.message_output.innerHTML = `Connecting (over secure connection) to ${this.host}...`;
		else
			this.message_output.innerHTML = `Connecting (over insecure connection) to ${this.host}...`;
		this.message_output.classList.add('good');
		
		// ensure we're currently disconnected
		await this.disconnect();
		
		try {
			let response = await this.obs.connect({ address: this.host, password: this.password, secure: this.secure });
			this.latest_connection_data = response;
			// if successful, it'll generate a ConnectionOpened event
		} catch (e) {
			this.latest_connection_data = e;
			console.log(e);
		}
	}

	async disconnect () {
		await this.obs.disconnect();
		this.connected = false;
	}

	autoConnect () {
		// only auto connect when a password is set
		if (this.password.length > 0)
			this.connect();
	}

	async sendCommand (command, params) {
		// TODO remove this
		if (!this.connected) return;

		try {
			return await this.obs.send(command, params || {});
		} catch (e) {
			console.log(`Error sending command: ${command}, for item: ${params.item}. Error is:`, e);
			return {'status': 'error', 'command': command, 'params': params, 'error': e.error};
		}
	}
}