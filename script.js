/**
 * OBS_web_remote code
 */

/**
 * Extends Element to ease creating new elements (based on EnyoJS v1)
 */
if (!Element.make) {
	Element.make = function (_nodeType, _attributes) { // my own concoction
		let nodeType = (_nodeType !== undefined && typeof _nodeType === 'string') ? _nodeType : 'div',
			attr = (_attributes !== undefined && typeof _attributes === 'object') ? _attributes : {},
			el = document.createElement(nodeType),
			key, skey;
		for (key in attr) {
			if (key === 'innerHTML')
				el.innerHTML += attr[key];
			else if (key === 'className')
				el.className = attr[key];
			else if (key === 'events' && typeof attr[key] === 'object')
				for (skey in attr[key])
					el.addEventListener(skey, attr[key][skey], false);
			else if (key === 'elements') // best to list these first
				for (let index in attr[key])
					el.appendChild(attr[key][index]);
			else el.setAttribute(key, attr[key]);
		}
		return el;
	}
}

var get_slug = function (inString) {
	// using replaceAll is apparently too new (Safari 13+, Chrome 85+), so use replace with regex //global modifier
	return inString.toLowerCase().replace(/\s/g, '_').replace(/\+/g,'_').replace(/\//g,'_');
}

var mul_to_decibel = function (inMul) {
	// assumption mul is in range [0,1], dB [-94.5,0]
	return ((0.212 * Math.log10(inMul) + 1) * 94.5) - 94.5;

	// from obs-ws
	// volDb = round(20 * math.log10(volMul[1])) + 100 if volMul[1] and volMul[2] != 0 else 0
	// from OBS
	// return (mul == 0.0f) ? -INFINITY : (20.0f * log10f(mul));
}

var round = function (value, precision) {
	let multiplier = Math.pow(10, precision || 0);
	return Math.round(value * multiplier) / multiplier;
}


class OBS {
	constructor () {
		this.connected = false;
		this.obs       = new OBSWebSocket();

		this.host      = localStorage.getItem('host') || 'localhost:4444';
		this.password  = localStorage.getItem('password') || '';

		document.getElementById('obs_ws_host').value = this.host;
		document.getElementById('obs_ws_password').value = this.password;

		// set up basic event handlers
		this.obs.on('error', err => {
			console.error('socket error:', err);
		});

		this.obs.on('ConnectionOpened', () => {
			document.getElementById('obs_ws_connect').innerHTML = 'Disconnect';
		});

		this.obs.on('ConnectionClosed', () => {
			console.log('Disconnected');
			this.connected = false;

			document.getElementById('obs_ws_connect').innerHTML = 'Connect';

			document.getElementById('obs_ws_connection').classList.remove('hidden');

			obsr.on_disconnected();
		});

		this.obs.on('AuthenticationFailure', async () => {
			// TODO give error message
		});

		this.obs.on('AuthenticationSuccess', async () => {
			let v = await this.obs.send('GetVersion', {});
			console.log('Connected to obs-websocket v' + v['obs-websocket-version'] + ' on OBS v' + v['obs-studio-version']);
			this.connected = true;

			document.getElementById('obs_ws_connection').classList.add('hidden');
			
			// kickstart update processes in OBSRemote
			obsr.on_connected();
		});

		// set up connection pane
		document.getElementById('btn_toggle_connect').addEventListener('click', this.toggle_form.bind(this));
		document.getElementById('obs_ws_connect').addEventListener('click', this.connect_form.bind(this));
	}

	// essentially just passed on to the internal obs.on function
	on (event, func) {
		this.obs.on(event, func);
	}

	toggle_form () {
		document.getElementById('obs_ws_connection').classList.toggle('hidden');
	}

	connect_form () {
		if (this.connected) {
			this.disconnect();
		} else {
			let host     = document.getElementById('obs_ws_host').value;
			let password = document.getElementById('obs_ws_password').value;

			localStorage.setItem('host', host);
			localStorage.setItem('password', password);

			this.connect(host, password);
		}
	}

	async connect (host, password) {
		this.host      = host || this.host;
		this.password  = password || this.password;
		
		let secure     = location.protocol === 'https:' || this.host.endsWith(':443');
		
		if (this.host.indexOf('://') !== -1) {
			let url = new URL(this.host);
			secure = url.protocol === 'wss:' || url.protocol === 'https:';
			this.host = url.hostname + ':' + (url.port ? url.port : secure ? 443 : 80);
		}
		console.log('Connecting to:', this.host, '- secure:', secure, '- using password:', this.password);
		
		await this.disconnect();
		this.connected = false;
		
		try {
			await this.obs.connect({ address: this.host, password: this.password, secure });
		} catch (e) {
			console.log(e);
		}
	}

	async disconnect () {
		await this.obs.disconnect();
		this.connected = false;
	}

	async sendCommand (command, params) {
		// TODO remove this
		if (!this.connected) return;

		try {
			return await this.obs.send(command, params || {});
		} catch (e) {
			console.log('Error sending command', command, ', for item:', params.item, ' - error is:', e);
			return {};
		}
	}
}


class OBSRemote {
	constructor () {
		this.studio_mode        = false;
		this.scene_list         = [];
		this.scenes             = {};
		this.scene_program      = '';
		this.scene_preview      = '';
		this.audio_list         = [];
		this.tick               = 0;

		this.video_width        = 1920;
		this.video_height       = 1080;
		this.aspect_ratio       = '16/9';
		this.video_fps          = 30;

		this.clock              = document.getElementById('status_clock');
		this.clock_text         = document.getElementById('status_clock_time');

		this.streaming          = false;
		this.stream_starting    = false;
		this.stream_stopping    = false;
		this.recording          = false;
		this.recording_starting = false;
		this.recording_stopping = false;
		this.recording_paused   = false;
		this.virtualcam_active  = false;
		this.outputs            = [];

		// set event listeners
		this.button_transition = document.getElementById('btn_transition');
		this.button_transition.addEventListener('click', this.transition.bind(this), false);

		this.button_toggle_mode = document.getElementById('btn_toggle_mode');
		this.button_toggle_text = document.getElementById('btn_toggle_mode_text');
		this.button_toggle_mode.addEventListener('click', this.toggle_studio_mode.bind(this), false);

		this.button_fullscreen = document.getElementById('btn_toggle_fullscreen');
		// if fullscreen functionallity is available, set it up, otherwise hide button
		if (this.button_fullscreen.requestFullscreen) {
			this.button_fullscreen.addEventListener('click', this.toggle_fullscreen.bind(this), false);
			window.addEventListener('fullscreenchange', this.handle_fullscreen_event.bind(this), false);
		} else {
			this.button_fullscreen.className = 'hidden';
		}

		// status stream / recording
		document.getElementById('status_stream').addEventListener('click', (e) => {
			document.getElementById('outputs_edit_list').classList.toggle('hidden');
		});
		document.getElementById('status_recording').addEventListener('click', (e) => {
			document.getElementById('outputs_edit_list').classList.toggle('hidden');
		});
		document.getElementById('status_virtualcam').addEventListener('click', (e) => {
			document.getElementById('outputs_edit_list').classList.toggle('hidden');
		});
		document.getElementById('status_outputs').addEventListener('click', (e) => {
			document.getElementById('outputs_edit_list').classList.toggle('hidden');
		});

		// stream and recording buttons
		this.stream_button    = document.getElementById('stream_button');
		this.recording_button = document.getElementById('recording_button');
		this.rec_pause_button = document.getElementById('rec_pause_button');

		this.stream_button.addEventListener(   'click', this.toggle_streaming.bind(this));
		this.recording_button.addEventListener('click', this.toggle_recording.bind(this));
		this.rec_pause_button.addEventListener('click', this.toggle_rec_pause.bind(this));

		// virtual camera button
		this.virtualcam_button = document.getElementById('virtualcam_button');
		this.virtualcam_button.addEventListener('click', this.toggle_virtualcam.bind(this));

		// status checklist setup
		this.setup_checklist();

		// start interval updates
		window.setInterval(this.update_status_clock.bind(this),1000);

		// this is more of a setup function than updater
		this.update_source_list();

		// setup obs event handlers
		obs.on('StudioModeSwitched',     this.on_studio_mode_switched.bind(this));
		obs.on('SwitchScenes',           this.on_scene_changed.bind(this));
		obs.on('PreviewSceneChanged',    this.on_preview_changed.bind(this));

		obs.on('ScenesChanged',          this.on_scenes_changed.bind(this));
		obs.on('SourceCreated',          this.on_source_created.bind(this));
		obs.on('SourceDestroyed',        this.on_source_destroyed.bind(this));
		obs.on('SourceRenamed',          this.on_source_renamed.bind(this));

		obs.on('StreamStarting',         this.on_stream_starting.bind(this));
		obs.on('StreamStarted',          this.on_stream_started.bind(this));
		obs.on('StreamStopping',         this.on_stream_stopping.bind(this));
		obs.on('StreamStopped',          this.on_stream_stopped.bind(this));
		obs.on('StreamStatus',           this.on_stream_status.bind(this));

		obs.on('RecordingStarting',      this.on_recording_starting.bind(this));
		obs.on('RecordingStarted',       this.on_recording_started.bind(this));
		obs.on('RecordingStopping',      this.on_recording_stopping.bind(this));
		obs.on('RecordingStopped',       this.on_recording_stopped.bind(this));
		obs.on('RecordingPaused',        this.on_recording_paused.bind(this));
		obs.on('RecordingResumed',       this.on_recording_resumed.bind(this));

		obs.on('VirtualCamStarted',      this.on_virtualcam_started.bind(this));
		obs.on('VirtualCamStopped',      this.on_virtualcam_stopped.bind(this));
	}

	on_connected () {
		// start requesting updates
		this.get_video_info();

		this.get_virtualcam_status();

		this.get_scene_list();

		this.get_studio_mode();
		
		this.update_audio_list();

		// setup interval for refreshing data
		self.interval_timer = window.setTimeout(this.update_on_interval.bind(this), 3000);

		window.addEventListener('keydown', this.handle_key_event.bind(this), false);
	}

	on_disconnected () {
		window.clearTimeout(self.interval_timer);

		for (var name in this.scenes) {
			this.scenes[name].pause_update();
		}

		// TODO loop over audio sources as well
	}

	async get_video_info () {
		// get aspect ratio
		let response = await obs.sendCommand('GetVideoInfo');

		if (response.status == 'ok') {
			this.video_width  = response['baseWidth'];
			this.video_height = response['baseHeight'];

			this.aspect_ratio = `${this.video_width}/${this.video_height}`;

			this.video_fps    = response['fps'];
		}
	}

	update_on_interval () {
		// clear timeout
		window.clearTimeout(self.interval_timer);

		this.update_status_list();
		this.update_outputs();

		// reset interval timeout
		self.interval_timer = window.setTimeout(this.update_on_interval.bind(this), 3000);
	}

	toggle_fullscreen () {
		if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
			document.documentElement.requestFullscreen();
		} else if (document.exitFullscreen) {
			document.exitFullscreen();
		}
	}

	handle_fullscreen_event () {
		this.button_fullscreen.className = document.fullscreenElement ? 'top-button small-button fullscreen' : 'top-button small-button';
	}

	async get_studio_mode () {
		let response = await obs.sendCommand('GetStudioModeStatus');

		this.studio_mode = (response && response.studioMode) || false;
		
		this.update_studio_mode();
		this.update_scenes();
	}

	on_studio_mode_switched (e) {
		this.studio_mode = e['new-state'];
		this.update_studio_mode();
	}

	update_studio_mode () {
		// update stuff
		if (!this.studio_mode) {
			if (this.scenes[ this.scene_preview ]) {
				this.scenes[ this.scene_preview ].is_preview = false;
				this.scenes[ this.scene_preview ].update();
			}
			this.scene_preview = '';
		}
		this.button_transition.className  = (this.studio_mode) ? '' : 'hidden';
	}

	async toggle_studio_mode () {
		// update immediately for fast feedback
		this.studio_mode = !this.studio_mode;
		this.update_studio_mode();
		
		await obs.sendCommand('ToggleStudioMode');
	}

	async get_scene_list () {
		let response = await obs.sendCommand('GetSceneList');

		// update scenes but skip hidden scenes (any with 'subscene' or 'hidden' in the name)
		this.scene_list = response['scenes'].filter(function (i) {
			let include_scene = true;
			if (i.name.indexOf('subscene') != -1) {
				include_scene = false;
			}
			if (i.name.indexOf('hidden') != -1) {
				include_scene = false;
			}
			return include_scene;
		});

		this.update_scene_list();

		// update program scene data
		this.on_scene_changed({'scene-name': response['current-scene']})
	}

	update_scene_list () {
		this.tick += 1;

		// catch some odd error
		if (!this.scene_list) {
			return;
		}

		for (let i = 0; i < this.scene_list.length; i++) {
			let name = this.scene_list[i].name;

			if (this.scenes[name]) {
				// if found, update
				this.scenes[name].change_index(i);
				this.scenes[name].update(this.tick);
			} else {
				// if not found, create element
				let scene = new SourceScene(i, name);

				this.scenes[name] = scene;
				this.scenes[name].update(this.tick);
				document.getElementById('scene_list').appendChild(scene.el);
			}
		}

		// remove scenes that are no longer current
		for (let sname in this.scenes) {
			if (this.scenes[sname].last_update != this.tick) {
				this.scenes[sname].pause_update();
				document.getElementById('scene_list').removeChild( this.scenes[sname].el );
				delete this.scenes[sname];
			}
		}
	}

	async update_scenes () {
		if (this.studio_mode) {
			await this.get_preview_scene();
		}
		await this.get_program_scene();

		this.update_scene_list();
	}

	async get_program_scene () {
		let response = await obs.sendCommand('GetCurrentScene');

		// this.scene_program = response['name'];
		this.on_scene_changed({'scene-name': response['name']});
	}

	async get_preview_scene () {
		let response = await obs.sendCommand('GetPreviewScene');

		this.on_preview_changed({'scene-name': response['name']});
	}

	on_preview_changed (e) {
		// first, update old preview scene	
		if (this.scenes[ this.scene_preview ]) {	
			this.scenes[ this.scene_preview ].unset_preview();
		}

		this.scene_preview = e['scene-name'];

		// update new preview scene
		if (this.scenes[ e['scene-name'] ]) {
			this.scenes[ e['scene-name'] ].set_preview();
		}
	}

	on_scene_changed (e) {
		// first, update old program scene	
		if (this.scenes[ this.scene_program ]) {	
			this.scenes[ this.scene_program ].unset_program();
		}

		this.scene_program = e['scene-name'];

		// update new program scene
		if (this.scenes[ e['scene-name'] ]) {
			this.scenes[ e['scene-name'] ].set_program();
		}

		// also trigger audio to reevaluate its active state (after minor delay)
		//   (no separate event exists for this)
		window.setTimeout(function () {
			for (let i = 0; i < this.audio_list.length; i++) {
				this.audio_list[i].get_active();
			}
		}.bind(this),500);
		
	}

	on_scenes_changed (e) {
		this.get_scene_list();
	}

	on_source_created (e) {
		// console.log('Created',e);
		// if (e['sourceType'] == 'scene') {
		// handled with ScenesChanged event	
		// }
		if (e['sourceType'] == 'input') {
			// in case it has audio, handle it
			this.update_audio_list();
		}
	}

	on_source_destroyed (e) {
		// console.log('Destroyed',e);
		if (e['sourceType'] == 'input') {
			// in it has audio, handle it
			this.update_audio_list();
		}
	}

	on_source_renamed (e) {
		// console.log('Renamed',e);
		if (e['sourceType'] == 'scene' && this.scenes[ e['previousName'] ]) {
			this.scenes[ e['previousName'] ].change_name(e['newName']);
			this.scenes[ e['newName'] ] = this.scenes[ e['previousName'] ];
			delete this.scenes[ e['previousName'] ];
		}
	}

	async transition () {
		if (this.studio_mode) {
			await obs.sendCommand('TransitionToProgram');
		}
	}

	async update_audio_list () {
		let response = await obs.sendCommand('GetSourcesList');

		let current_audio_names = [];
		
		if (response.status == 'ok' && response.sources) {
			for (let i = 0; i < response['sources'].length; i++) {
				let s = response['sources'][i];
				
				// type is 'scene' or 'input'
				if (s.type == 'input' &&
					(s.typeId == 'ffmpeg_source' || s.typeId == 'ndi_source' || s.typeId == 'coreaudio_input_capture' || s.typeId == 'ios-camera-source')
				) {
					// first, check if it already exists. If it does, skip
					let source_exists = false;
					for (let j = 0; j < this.audio_list.length; j++) {
						if (this.audio_list[j].name == s.name) {
							source_exists = true;
							current_audio_names.push(s.name);
							break;
						}
					}

					// create new SourceAudio when it's a new input
					if (!source_exists) {
						let sa = new SourceAudio(s);
						this.audio_list.push(sa);
						current_audio_names.push(s.name);
						document.getElementById('audio_list').appendChild( sa.get_element() );
					}
				}
			}
		}

		// handle situation where audio items still exist but have since been removed from OBS
		for (let k = this.audio_list.length - 1; k >= 0; k--) {
			let a = this.audio_list[k];

			if (!current_audio_names.includes(a.name)) {
				// remove and destroy element
				a.on_source_destroyed();
				document.getElementById('audio_list').removeChild( a.get_element() );
				
				// remove from audio list
				let ix = this.audio_list.indexOf(a);
				this.audio_list.splice(ix,1);
			}
		}

	}

	toggle_all_audio () {
		// TODO for all active audio, toggle mute status (follow a global state?)
	}

	update_source_list () {
		/*
		 * Flexible parsing of inputs that can be used to adjust OBS source items.
		 * 
		 * Currently supported:
		 * - Text inputs
		 * - Select inputs (can feed into multiple text sources)
		 */

		let input_list  = [];
		let select_list = [];

		// get all potential inputs
		let all_inputs = document.getElementsByTagName('input');

		for (var i = 0; i < all_inputs.length; i++) {
			let ix = all_inputs[i].getAttribute('data-obsr-source');

			if (ix != null)
				input_list.push(all_inputs[i]);
		}

		// get all potential select elements
		let all_select_els = document.getElementsByTagName('select');

		for (var j = 0; j < all_select_els.length; j++) {
			let sx = all_select_els[j].getAttribute('data-obsr-selector');

			if (sx != null)
				select_list.push(all_select_els[j]);
		}

		// set up source items
		input_list.forEach((item) => {
			item.addEventListener('change', function (e) {
				this.set_text(e.target.name, e.target.value);
				e.preventDefault()
			}.bind(this), false);
		});

		// set up select elements
		select_list.forEach((item) => {
			let sources = item.getAttribute('data-obsr-selector').split('|');

			item.addEventListener('change', function (e) {
				var values = e.target.value.split('|');

				// assumption that length of values matches sources
				for (var k = 0; k < sources.length; k++) {
					// set value in UI (if it exists)
					let source_el = document.getElementById(sources[k]);

					if (source_el)
						source_el.value = values[k];

					// send value to OBS
					this.set_text(sources[k], values[k]);
				}

				e.preventDefault()
			}.bind(this), false);
		});
	}

	async set_text (inSource, inText) {
		await obs.sendCommand('SetTextFreetype2Properties', {'source': inSource, 'text': inText});
	}

	async update_status_list () {
		let response = await obs.sendCommand('GetStreamingStatus');

		if (response.status == 'ok') {
			this.streaming        = response.streaming;
			this.recording        = response.recording;
			this.recording_paused = response['recording-paused'];

			document.getElementById('status_stream').classList.toggle('good',   response.streaming);
			document.getElementById('status_stream').classList.toggle('alert', !response.streaming);
			
			document.getElementById('status_stream_text').innerHTML =
				(response.streaming) ? 'LIVE: ' + response['stream-timecode'].replace(/\.\d+/,'') : 'Not streaming';

			if (response.recording) {
				document.getElementById('status_recording').classList.remove('alert');
				document.getElementById('status_recording').classList.toggle('warning',  response['recording-paused']);
				document.getElementById('status_recording').classList.toggle('good',    !response['recording-paused']);

				document.getElementById('status_recording_text').innerHTML =
					(response['recording-paused']) ? 'Paused ' : 'REC ';
				document.getElementById('status_recording_text').innerHTML += response['rec-timecode'].replace(/\.\d+/,'');
			} else {
				document.getElementById('status_recording').classList.remove('warning');
				document.getElementById('status_recording').classList.remove('good');
				document.getElementById('status_recording').classList.add('alert');
				document.getElementById('status_recording_text').innerHTML = 'Not recording';	
			}
		}
		
		let response2 = await obs.sendCommand('GetStats');
		// use 'average-frame-time' 

		if (response2.status == 'ok') {
			document.getElementById('status_cpu').className =
				(response2.stats['cpu-usage'] > 50) ? 'status-item warning' : 'status-item';
			document.getElementById('status_cpu_text').innerHTML =
				Math.ceil(response2.stats['cpu-usage']) + '%';

			let fps_time_per_frame = 1000 / this.video_fps;
			let avg_time_per_frame = response2.stats['average-frame-time']; // example 2.726 millis
			let pct_time_per_frame = round(100.0 * avg_time_per_frame / fps_time_per_frame);

			let is_alert_state = (response2.stats['output-skipped-frames'] / response2.stats['output-total-frames'] > 0.05);
			if (!is_alert_state) {
				is_alert_state = (response2.stats['fps'] < this.video_fps);
			}
			if (!is_alert_state) {
				is_alert_state = (pct_time_per_frame > 50);
			}
			document.getElementById('status_frames').className = (is_alert_state) ? 'status-item alert' : 'status-item';
			document.getElementById('status_frames_text').innerHTML =
				Math.round(response2.stats['fps']) + ' fps, ' + pct_time_per_frame + '%, ' + response2.stats['output-skipped-frames'] + ' skipped';
		}

		this.update_stream_rec_status();
	}

	update_status_clock () {
		this.clock_text.innerHTML = (new Date()).toLocaleTimeString('nl-NL');  // 24 hour format
		this.clock.classList.toggle('alert', !obs.connected);
	}

	setup_checklist () {
		// prepare list
		let check_list  = document.getElementById('status_ordered_checklist');
		let check_items = check_list.children;

		for (var i = 0; i < check_items.length; i++) {
			let el      = check_items[i];
			let el_text = check_items[i].innerHTML;

			let input_el = Element.make('input', {
				'type'     : 'checkbox',
				'id'       : 'check' + (i+1),
				'name'     : 'check' + (i+1),
				'class'    : 'checklist-item',
				'events'   : {
					'change': this.update_checklist.bind(this)
				}
			});
			let label_el = Element.make('label', {
				'for'      : 'check' + (i+1),
				'innerHTML': el_text
			});

			el.innerHTML = '';
			el.appendChild(input_el);
			el.appendChild(label_el);
		}

		// trigger update once for initiation
		this.update_checklist();

		// set up status bar toggle event
		document.getElementById('status_checklist').addEventListener('click', (e) => {
			document.getElementById('status_checklist_list').classList.toggle('hidden');
		});
	}

	update_checklist () {
		let check_items   = document.getElementsByClassName('checklist-item'),
			count_checked = 0;

		for (var i = 0; i < check_items.length; i++) {
			if (check_items[i].checked) {
				count_checked++;
			}
		}

		document.getElementById('status_checklist_text').innerHTML = count_checked + '/' + check_items.length;

		document.getElementById('status_checklist').classList.toggle('good', count_checked == check_items.length);
	}

	toggle_streaming () {
		if (this.streaming)
			this.stop_streaming();
		else
			this.start_streaming();
	}

	async start_streaming () {
		if (!this.streaming)
			await obs.sendCommand('StartStreaming');
	}

	async stop_streaming () {
		if (this.streaming)
			await obs.sendCommand('StopStreaming');
	}

	on_stream_starting () {
		this.streaming       = false;
		this.stream_starting = true;
		this.stream_stopping = false;
		this.update_stream_rec_status();
	}

	on_stream_started () {
		this.streaming       = true;
		this.stream_starting = false;
		this.stream_stopping = false;
		this.update_stream_rec_status();
	}

	on_stream_stopping () {
		this.streaming       = true;
		this.stream_starting = false;
		this.stream_stopping = true;
		this.update_stream_rec_status();
	}

	on_stream_stopped () {
		this.streaming       = false;
		this.stream_starting = false;
		this.stream_stopping = false;
		this.update_stream_rec_status();
	}

	on_stream_status (e) {
		// see: https://github.com/obsproject/obs-websocket/blob/4.9.1/docs/generated/protocol.md#streamstatus

		// not used at the moment, because it only works when a stream is active
		// this.update_stream_rec_status();
	}

	toggle_recording () {
		if (this.recording)
			this.stop_recording();
		else
			this.start_recording();
	}

	toggle_rec_pause () {
		if (this.recording_paused)
			this.resume_recording();
		else
			this.pause_recording();
	}

	async start_recording () {
		if (!this.recording)
			await obs.sendCommand('StartRecording');
	}

	async pause_recording () {
		if (this.recording && !this.recording_paused)
			await obs.sendCommand('PauseRecording')
	}

	async resume_recording () {
		if (this.recording && this.recording_paused)
			await obs.sendCommand('ResumeRecording')
	}

	async stop_recording () {
		if (this.recording)
			await obs.sendCommand('StopRecording');
	}

	on_recording_starting () {
		this.recording          = false;
		this.recording_starting = true;
		this.recording_stopping = false;
		this.recording_paused   = false;

		this.update_stream_rec_status();
	}

	on_recording_started () {
		this.recording          = true;
		this.recording_starting = false;
		this.recording_stopping = false;
		this.recording_paused   = false;

		this.update_stream_rec_status();
	}

	on_recording_stopping () {
		this.recording          = true;
		this.recording_starting = false;
		this.recording_stopping = true;
		this.recording_paused   = false;

		this.update_stream_rec_status();
	}

	on_recording_stopped () {
		this.recording          = false;
		this.recording_starting = false;
		this.recording_stopping = false;
		this.recording_paused   = false;

		this.update_stream_rec_status();
	}

	on_recording_paused () {
		this.recording          = true;
		this.recording_starting = false;
		this.recording_stopping = false;
		this.recording_paused   = true;

		this.update_stream_rec_status();
	}

	on_recording_resumed () {
		this.recording          = true;
		this.recording_starting = false;
		this.recording_stopping = false;
		this.recording_paused   = false;

		this.update_stream_rec_status();
	}

	update_stream_rec_status () {
		// stream button
		this.stream_button.classList.toggle('active',   this.streaming);
		this.stream_button.classList.toggle('starting', this.stream_starting);
		this.stream_button.classList.toggle('stopping', this.stream_stopping);
		
		let stream_button_text = this.streaming ? 'Stop streaming' : 'Start streaming';
		if (this.stream_starting)
			stream_button_text = 'Starting stream...';
		else if (this.stream_stopping)
			stream_button_text = 'Stopping stream...';
		document.getElementById('stream_button_text').innerHTML = stream_button_text;
		
		// recording button
		this.recording_button.classList.toggle('active',   this.recording);
		this.recording_button.classList.toggle('starting', this.recording_starting);
		this.recording_button.classList.toggle('stopping', this.recording_stopping);

		let recording_button_text = this.recording ? 'Stop recording' : 'Start recording';
		if (this.recording_starting)
			recording_button_text = 'Starting recording...';
		else if (this.recording_stopping)
			recording_button_text = 'Stopping recording...';
		document.getElementById('recording_button_text').innerHTML = recording_button_text;

		// recording pause button
		if (this.recording)
			this.rec_pause_button.removeAttribute('disabled');
		else
			this.rec_pause_button.setAttribute('disabled', 'disabled');
		this.rec_pause_button.classList.toggle('active', this.recording_paused);
		document.getElementById('rec_pause_button_text').innerHTML = this.recording_paused ? 'Resume recording' : 'Pause recording';
	}

	async get_virtualcam_status () {
		let response = await obs.sendCommand('GetVirtualCamStatus');

		if (response.status == 'ok') {
			this.virtualcam_active = response['isVirtualCam'];
		}

		this.update_virtualcam_status();
	}

	toggle_virtualcam () {
		if (this.virtualcam_active)
			this.stop_virtualcam();
		else
			this.start_virtualcam();
	}

	async start_virtualcam () {
		await obs.sendCommand('StartVirtualCam');
	}

	async stop_virtualcam () {
		await obs.sendCommand('StopVirtualCam');
	}

	on_virtualcam_started () {
		this.virtualcam_active = true;
		this.update_virtualcam_status();
	}

	on_virtualcam_stopped () {
		this.virtualcam_active = false;
		this.update_virtualcam_status();
	}

	update_virtualcam_status() {
		// status bar
		document.getElementById('status_virtualcam').classList.toggle('good', this.virtualcam_active);
		document.getElementById('status_virtualcam_text').innerHTML = (this.virtualcam_active) ? 'On' : 'Off';

		// edit pane
		this.virtualcam_button.classList.toggle('active', this.virtualcam_active);
		document.getElementById('virtualcam_button_text').innerHTML = (this.virtualcam_active) ? 'Stop virtual cam' : 'Start virtual cam';
	}

	async update_outputs () {
		let response = await obs.sendCommand('ListOutputs');

		let active_outputs = 0;
		this.outputs       = [];

		if (response.status == 'ok') {
			for (let i = 0; i < response.outputs.length; i++) {
				let o = response.outputs[i];

				// skip over output types handled elsewhere
				if (o.name != 'adv_stream' && o.name != 'adv_file_output' && o.name != 'virtualcam_output') {
					this.outputs.push(o);

					if (o.active)
						active_outputs++;
				}
			}
		}

		// update status bar
		document.getElementById('status_outputs').classList.toggle('good', active_outputs > 0);
		document.getElementById('status_outputs_text').innerHTML = `${active_outputs}/${this.outputs.length}`;

		// update edit pane
		let ul = document.getElementById('other_outputs_info');

		for (let j = 0; j < this.outputs.length; j++) {
			let o     = this.outputs[j];

			let id    = get_slug('output_item_' + o.name);
			let li_el = document.getElementById(id);

			if (!li_el) {
				li_el = Element.make('li', {
					'id'       : id,
					'className': 'output-info-item'
				});

				ul.appendChild(li_el);
			}

			let has_audio = o.flags.audio;
			if (o.settings.uses_audio !== undefined)
				has_audio = o.settings.uses_audio;

			li_el.classList.toggle('good',      o.active);
			li_el.classList.toggle('warning',   o.reconnecting);
			li_el.classList.toggle('has-audio', has_audio);
			li_el.classList.toggle('has-video', o.flags.video);
			li_el.innerHTML = `${o.name} (${o.type.replace('_output','')})`;
		}

		// remove outputs no longer found in list but still in page ul
		let current_output_ids = this.outputs.map(x => get_slug('output_item_' + x.name));
		for (let k = ul.children.length - 1; k >= 0; k--) {
			let c = ul.children[k];

			if (!current_output_ids.includes(c.id)) {
				ul.removeChild(c);
			}
		}
	}

	handle_key_event (inEvent) {
		// avoid 'silencing' input fields
		if (inEvent.target && inEvent.target.nodeName.toLowerCase() === 'input') {
			return;
		} else if (inEvent && inEvent.preventDefault) {
			inEvent.preventDefault();
		}

		switch (inEvent.keyCode) {
			case 84: // t
				this.transition();
				break;
			case 83: // s
				this.toggle_studio_mode();
				break;
			case 77: // m
				this.toggle_all_audio();
				break;
			case 70: // f
				this.toggle_fullscreen();
				break;
			case 48: // 0
			case 49: // 1
			case 50: // 2
			case 51:
			case 52:
			case 53:
			case 54:
			case 55:
			case 56: // 8
			case 57: // 9
				// 0 is handled as 10th scene (with index - 1 = 9)
				var i = (inEvent.keyCode == 48) ? 9 : inEvent.keyCode - 49;
				
				if (this.scene_list[i]) {
					this.scenes[ this.scene_list[i].name ].set_scene( inEvent.shiftKey );
				}
				break;
			default:
				break;
		}

		return false;
	}
}

class SourceScene {
	constructor (index, name) {
		this.index       = index;
		this.name        = name;
		this.last_update = 9999999; // improbably high number
		this.is_program  = obsr.scene_program === name;
		this.is_preview  = obsr.scene_preview === name;

		// create elements
		this.el          = Element.make('li', {
			'id'       : 'li_scene_' + get_slug(name),
			'className': 'scene',
			'events'   : {
				'click'      : function (e) {  // left click
					this.set_scene( e.shiftKey );
				}.bind(this),
				'contextmenu': function (e) {  // right click
					e.preventDefault();
					this.set_scene(true);
				}.bind(this)
			}
		});

		this.div = Element.make('div', {
			'innerHTML': this._get_index_string()
		})

		this.label = Element.make('label', {
			'innerHTML': name
		});

		this.el.appendChild(this.div);
		this.el.appendChild(this.label);

		// get initial state set up
		this.el.style.aspectRatio = obsr.aspect_ratio;
		this.set_screenshot();
	}

	update (tick) {
		this.last_update = tick;

		if (!this.interval_timer) {
			this.update_state();
		}
	}

	update_state () {
		// add/remove class based on program/preview state
		if (this.is_program) {
			this.el.className = 'scene program';
		} else if (this.is_preview) {
			this.el.className = 'scene preview';
		} else {
			this.el.className = 'scene';

			window.clearInterval(this.interval_timer);
		}

		if (this.is_program || this.is_preview) {
			this.interval_timer = window.setInterval(this.set_screenshot.bind(this),  2000);
		} else {
			this.interval_timer = window.setInterval(this.set_screenshot.bind(this), 10000);
		}
	}

	pause_update () {
		if (this.interval_timer)
			window.clearInterval(this.interval_timer);
	}

	set_program () {
		this.is_program = true;
		this.update_state();
	}

	set_preview () {
		this.is_preview = true;
		this.update_state();
	}

	unset_program () {
		this.is_program = false;
		this.update_state();
	}

	unset_preview () {
		this.is_preview = false;
		this.update_state();
	}

	change_index (index) {
		if (index != this.index) {
			this.index = index;
			this.div.innerHTML = this._get_index_string();
		}
	}

	change_name (name) {
		this.name = name;
		this.label.innerHTML = name;
	}

	async set_scene (forceCurrentScene) {
		let cmd = (obsr.studio_mode) ? 'SetPreviewScene' : 'SetCurrentScene';
		
		if (forceCurrentScene) {
			cmd = 'SetCurrentScene';
		}

		await obs.sendCommand(cmd, {'scene-name': this.name});
	}

	async set_screenshot () {
		let img_width  = (this.el.offsetWidth > 0) ? this.el.offsetWidth : 250;
		let img_height = (1 / obsr.aspect_ratio) * img_width;

		let response = await obs.sendCommand('TakeSourceScreenshot', {
			'sourceName': this.name,
			'embedPictureFormat': 'jpg',
			'width': img_width,
			'height': img_height
		});

		if (response && response.status == 'ok' && response.img) {
			// apply image but with preload dummy image object as interstage to eliminate 'refresh flickering'

			// create a new Image object as dummy holder to trigger a preload of the image
			let img_dummy = new Image();

			// when preload is complete, apply the image to the element
			img_dummy.onload = function () {
				this.el.style.backgroundImage = 'url("' + response.img + '")';
			}.bind(this)

			// setting 'src' actually starts the preload
			img_dummy.src = response.img;
		}
	}

	_get_index_string () {
		if (this.index < 9) {
			return this.index + 1;
		}
		else if (this.index == 9) {
			return 0;
		}
		// else
		return '-';
	}
}

class SourceAudio {
	constructor (inSource) {
		this.source      = inSource;
		this.name        = inSource.name;
		this.slug        = get_slug(inSource.name);
		this.typeId      = inSource.typeId;
		this.volume      = 0;
		this.volume_db   = 0;
		this.volume_max  = 0;
		this.muted       = true;
		this.active      = false;
		this.visible     = false;
		this.tracks      = [];
		this.filters     = [];
		this.last_update = 9999999; // improbably high number

		// create elements
		this.el                = Element.make('li',     {'className': 'audio-item', 'id': 'audio_item_' + this.slug});
		this.name_el           = Element.make('div',    {'className': 'audio-name', 'innerHTML': this.name});
		this.settings_el       = Element.make('div',    {'className': 'audio-settings'});
		this.column_vu_el      = Element.make('div',    {'className': 'audio-column-vu'});
		this.vol_max_el        = Element.make('div',    {
			'className': 'audio-max',
			'title'    : 'Max output volume (click to reset)',
			'innerHTML': 'dB'
		});
		this.vol_canvas        = Element.make('canvas', {'className': 'audio-vu'});
		this.column_fader_el   = Element.make('div',    {'className': 'audio-column-fader'});
		this.vol_el            = Element.make('div',    {
			'className': 'audio-current',
			'title'    : 'Current volume setting',
			'innerHTML': 'dB'
		});
		this.fader             = new Fader(this.slug + '_fader');
		this.fader.get_element().addEventListener('change', this.on_fader_change.bind(this));
		this.column_buttons_el = Element.make('div',    {'className': 'audio-column-buttons'});
		if (this.typeId != 'coreaudio_input_capture') {
			this.btn_visibility    = Element.make('button', {
				'className': 'audio-button visibility',
				'title'    : 'Toggle visibility',
				// 'innerHTML': '<img class="visible-on" src="icons/eye.svg"><img class="visible-off" src="icons/eye-off.svg">',
				'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="visible-on"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="visible-off"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>',
				'events': {
					'click': this.on_visibility_btn_click.bind(this)
				}
			});
		}
		
		this.btn_mute          = Element.make('button', {
			'className': 'audio-button mute',
			'title'    : 'Toggle mute',
			'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-on"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-off"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-1"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>',
			'events': {
				'click': this.on_mute_btn_click.bind(this)
			}
		});
		this.btn_solo          = Element.make('button', {
			'className': 'audio-button solo',
			'title'    : 'Toggle solo',
			'innerHTML': 'S',
			'events': {
				'click': this.on_solo_btn_click.bind(this)
			}
		});
		this.btn_monitor       = Element.make('button', {
			'className': 'audio-button',
			'innerHTML': 'X',
			'events': {
				'click': this.on_monitor_btn_click.bind(this)
			}
		});
		this.tracks_el         = Element.make('div',    {'className': 'audio-tracks'});
		this.filters_list_el   = Element.make('ul',     {'className': 'filters-list'});

		this.el.appendChild(this.name_el);
		this.el.appendChild(this.settings_el);
		this.el.appendChild(this.filters_list_el);

		this.settings_el.appendChild(this.column_vu_el);
		this.settings_el.appendChild(this.column_fader_el);
		this.settings_el.appendChild(this.column_buttons_el);

		this.column_vu_el.appendChild(this.vol_max_el);
		this.column_vu_el.appendChild(this.vol_canvas);

		this.column_fader_el.appendChild(this.vol_el);
		this.column_fader_el.appendChild(this.fader.get_element());

		this.column_buttons_el.appendChild(this.btn_mute);
		if (this.typeId != 'coreaudio_input_capture') {
			this.column_buttons_el.appendChild(this.btn_visibility);
		}
		// this.column_buttons_el.appendChild(this.btn_solo);
		// this.column_buttons_el.appendChild(this.btn_monitor);
		this.column_buttons_el.appendChild(this.tracks_el);

		for (let i = 1; i < 7; i++) {
			let t = Element.make('span', {
				'data-track': i,
				'title'     : 'Track ' + i,
				'events'    : {
					'click': this.on_track_btn_click.bind(this,i)
				}
			});
			this.tracks.push(t);
			this.tracks_el.appendChild(t);
		}
		
		// set initial state
		this.update_state();

		this.get_volume();
		if (this.typeId != 'coreaudio_input_capture') {
			this.get_visibility();
		}
		this.get_active();
		this.get_tracks();
		this.get_source_filters();

		// handle relevant events
		obs.on('SourceVolumeChanged',    this.on_volume_changed.bind(this));
		obs.on('SourceMuteStateChanged', this.on_mute_state_changed.bind(this));
		obs.on('SourceAudioActivated',   (e) => {console.log(e, e['sourceName']);});
		obs.on('SourceAudioDeactivated', (e) => {console.log(e, e['sourceName']);});
		
		//SourceAudioMixersChanged -> (see protocol)

		//SourceCreated + SourceDestroyed (handle externally?)
		obs.on('SourceRenamed',          this.on_source_renamed.bind(this));

		obs.on('SceneItemVisibilityChanged', this.on_visibility_changed.bind(this));

		obs.on('SourceFilterAdded',      this.on_filter_added.bind(this));
		obs.on('SourceFilterRemoved',    this.on_filter_removed.bind(this));
		obs.on('SourceFiltersReordered', this.on_filters_reordered.bind(this));
		
		//SourceFilterVisibilityChanged -> sourceName, filterName, filterEnabled
	}

	get_element () {
		return this.el;
	}

	on_source_renamed (e) {
		if (e['previousName'] == this.name) {
			this.change_name( e['newName'] );
		}
	}

	on_source_destroyed () {
		// TODO
		// trigger all filter elements to be removed and destroyed
	}

	change_name (name) {
		if (name) {
			this.source.name       = name;
			this.name              = name;
			this.name_el.innerHTML = name;
			this.slug              = get_slug(name);
			// TODO update li id?
		}
	}

	update (tick) {
		this.last_update = tick;

		if (!this.interval_timer) {
			this.update_state();
		}
	}

	update_state () {
		// main element
		this.el.classList.toggle('active',  this.active);
		this.el.classList.toggle('muted',   this.muted);
		this.el.classList.toggle('visible', this.visible);

		// volume
		// NOT USED YET this.vol_max_el.innerHTML = (round(mul_to_decibel(this.volume_max), 1) + ' dB').replace('Infinity','∞');
		this.vol_el.innerHTML     = (round(mul_to_decibel(this.volume),     1) + ' dB').replace('Infinity','∞');
		this.btn_mute.classList.toggle('volume-low',  this.volume  < 0.33);
		this.btn_mute.classList.toggle('volume-mid',  (this.volume >=0.33 && this.volume < 0.66));
		this.btn_mute.classList.toggle('volume-high', this.volume >= 0.66);
		this.fader.set(this.volume);
		// TODO update canvas if data is available

		// buttons
		// this.btn_mute.classList.toggle()
		// this.btn_solo.classList.toggle()

		// track buttons

		// adjust timer if necessary?
	}

	pause_update () {
		if (this.interval_timer)
			window.clearInterval(this.interval_timer);
	}

	async get_volume () {
		let response = await obs.sendCommand('GetVolume', {'source': this.name});
		
		if (response.status == 'ok') {
			this.volume = response.volume;
			this.muted  = response.muted;

			this.update_state();
		}
	}

	set_volume () {
		obs.sendCommand('SetVolume', {'source': this.name, 'volume': this.volume});
		
		// this.update_state();
	}

	on_volume_changed (e) {
		if (e['sourceName'] == this.name) {
			this.volume    = e.volume;
			this.volume_db = e.volumeDb;

			this.update_state();
		}
	}

	set_mute () {
		obs.sendCommand('SetMute', {'source': this.name, 'mute': this.muted});
	}

	async toggle_mute () {
		await obs.sendCommand('ToggleMute', {'source': this.name});

		// this.update_state();
	}

	on_mute_state_changed (e) {
		if (e['sourceName'] == this.name) {
			this.muted = e.muted;

			this.update_state();
		}
	}

	async get_visibility () {
		// omitted: 'scene-name': scene, 
		let response = await obs.sendCommand('GetSceneItemProperties', {'item': this.name});

		if (response && response.status == 'ok') {
			this.visible = response['visible'];

			this.update_state();
		}
	}

	set_visibility (state) {
		// omitted: 'scene-name': scene, 
		obs.sendCommand('SetSceneItemRender', {'source': this.name, 'render': state});
	}

	on_visibility_changed (e) {
		if (e['item-name'] == this.name) {
			this.visible = e['item-visible'];

			this.update_state();
		}
	}

	async get_active () {
		// TODO GetAudioActive is not the same as active in scene
		// audioActive is true even if not in program scene, but false when muted or not playing
		let response_s =  await obs.sendCommand('GetSourceActive', {'sourceName': this.name});
		let response_a =  await obs.sendCommand('GetAudioActive',  {'sourceName': this.name});

		if (response_s && response_s.status == 'ok' && response_a && response_a.status == 'ok') {
			this.active = (response_s.sourceActive && response_a.audioActive);

			this.update_state();
		}
	}

	async get_tracks () {
		let response =  await obs.sendCommand('GetAudioTracks', {'sourceName': this.name});

		if (response && response.status == 'ok') {
			for (let i = 1; i < 7; i++) {
				this.tracks[i-1].className = response['track'+i] ? 'enabled': '';
			}
		}
	}

	async set_track (track_index, state) {
		let response = await obs.sendCommand('SetAudioTracks', {'sourceName': this.name, 'track': track_index, 'active': state});

		if (response && response.status == 'ok') {
			this.tracks[track_index-1].classList.toggle('enabled', state);
		}
	}

	on_fader_change (e) {
		this.volume           = this.fader.value;
		// immediate feedback
		this.vol_el.innerHTML = (round(mul_to_decibel(this.volume), 1) + ' dB').replace('Infinity','∞');
		// update volume in OBS
		this.set_volume()
	}

	on_visibility_btn_click (e) {
		this.visible = !this.visible;

		// immediate feedback
		this.update_state();

		// update OBS
		this.set_visibility(this.visible);
	}

	on_mute_btn_click (e) {
		this.muted = !this.muted;
		
		// immediate feedback
		this.update_state();
		
		// update OBS
		this.set_mute();
	}

	on_solo_btn_click (e) {
		//TODO
		console.log(this.name, 'solo clicked');
	}

	on_monitor_btn_click (e) {
		//TODO
		console.log(this.name, 'monitor clicked');
	}

	on_track_btn_click (track_index, e) {
		this.set_track(track_index, !this.tracks[track_index-1].classList.contains('enabled'));
	}

	async get_source_filters () {
		let response = await obs.sendCommand('GetSourceFilters', {'sourceName': this.name});
		
		if (response && response.status == 'ok') {
			for (var i = 0; i < response.filters.length; i++) {
				// create filter if it's of the right type
				switch (response.filters[i].type) {
					case 'noise_gate_filter':
					case 'noise_suppress_filter_v2':
					case 'limiter_filter':
					case 'compressor_filter':
					case 'expander_filter':
					case 'gain_filter':
					case 'async_delay_filter':
					case 'audio_monitor':
					case 'ndi_audiofilter':
					case 'vst_filter':
					case 'invert_polarity_filter': {
						this.add_filter(response.filters[i]);
						break;
					}
					default:  // do nothing for types not handled above
						break;
				}
			}
		}
	}

	add_filter (filter_data) {
		// first, check if filter exists already
		let current_filters = this.filters.map(x => x.name);

		if (!current_filters.includes(filter_data.name)) {
			// if new, create and add
			let filter_instance = new SourceFilter(this.source, filter_data);

			this.filters.push(filter_instance);
			this.filters_list_el.appendChild( filter_instance.get_element() );
		}
	}

	remove_filter (filter_data) {
		// first, check if filter exists
		let current_filters = this.filters.map(x => x.name);

		if (current_filters.includes(filter_data.name)) {
			// if it exists, remove
			let ix = current_filters.indexOf(filter_data.name);
			let f  = this.filters[ix];

			this.filters_list_el.removeChild( f.get_element() );
			this.filters.splice(ix,1);
		}
	}

	on_filter_added (e) {
		//SourceFilterAdded -> sourceName, filterName, filterType, filterSettings
		if (e.sourceName == this.name) {
			// just get all filters for this source and work from there
			this.get_source_filters();
		}
	}

	on_filter_removed (e) {
		//SourceFilterRemoved -> sourceName, filterName, filterType
		if (e.sourceName == this.name) {
			this.remove_filter({'name': e.filterName, 'type': e.filterType});
		}
	}

	on_filters_reordered (e) {
		//SourceFiltersReordered -> (see protocol)
		if (e.sourceName == this.name) {
			console.log(e);
			// TODO
		}
	}
}

class SourceFilter {
	constructor (inSource, inFilter) {
		this.source      = inSource;
		this.source_slug = get_slug(inSource.name);
		this.filter      = inFilter;
		this.name        = this.filter.name;
		this.type        = this.filter.type;
		this.enabled     = this.filter.enabled;
		this.open        = false;
		this.settings    = {};

		this.el = Element.make('div', {
			'id'       : 'source_' + this.source_slug + '_filter_' + this.name,
			'className': 'source-filter filter-' + this.type
		});
		if (!this.enabled) {
			this.el.classList.add('disabled');
		}
		if (this.open) {
			this.el.classList.add('open');
		}

		this.title_el = Element.make('label', {
			'className': 'source-title'
		});
		this.el.appendChild(this.title_el);

		this.title_span = Element.make('span', {
			'title'    : this.name,
			'innerHTML': this.name,
			'events'   : {
				'click': this.toggle_open.bind(this)
			}
		});
		this.title_el.appendChild(this.title_span);

		// enable button
		this.btn_enable = Element.make('span', {
			'title'    : 'Toggle filter visibility',
			'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="visible-on"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="visible-off"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>',
			'className': 'button',
			'events'   : {
				'click': this.toggle_enable.bind(this)
			}
		});
		this.title_el.appendChild(this.btn_enable);

		// open button
		this.btn_open = Element.make('span', {
			'title'    : 'Toggle filter settings pane',
			'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-down"><polyline points="6 9 12 15 18 9"></polyline></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-up"><polyline points="18 15 12 9 6 15"></polyline></svg>',
			'className': 'button',
			'events'   : {
				'click': this.toggle_open.bind(this)
			}
		});
		this.title_el.appendChild(this.btn_open);

		this.settings_el = Element.make('div', {
			'className': 'filter-settings-section'
		});
		this.el.appendChild(this.settings_el);

		// create default settings
		switch (this.type) {
			case 'noise_gate_filter':
				this.settings['close_threshold'] = -32;  // [-96-0]  dB
				this.settings['open_threshold']  = -26;  // [-96-0]  dB
				this.settings['attack_time']     = 25;   // [1-500]  ms
				this.settings['hold_time']       = 200;  // [1-1000] ms
				this.settings['release_time']    = 150;  // [1-1000] ms
				break;
			case 'noise_suppress_filter_v2':
				this.settings['method']          = 'rnnoise'; // speex|rnnoise
				this.settings['suppress_level']  = -30;       // [-60-0] dB
				break;
			case 'limiter_filter':
				this.settings['threshold']       = -6;  // [-60-0]  dB
				this.settings['release_time']    = 60;  // [1-1000] ms
				break;
			case 'compressor_filter':
				this.settings['ratio']           = 10;  // [1-32 in .5 steps]
				this.settings['threshold']       = -18; // [-60-0]  dB
				this.settings['attack_time']     = 6;   // [1-500]  ms
				this.settings['release_time']    = 60;  // [1-1000] ms
				this.settings['output_gain']     = 0;   // [-32-32] dB
				break;
			case 'expander_filter':
				this.settings['ratio']           = 2;     // [1-20 in .1 steps]
				this.settings['threshold']       = -40;   // [-60-0]  dB
				this.settings['attack_time']     = 10;    // [1-100]  ms
				this.settings['release_time']    = 50;    // [1-1000] ms
				this.settings['output_gain']     = 0;     // [-32-32] dB
				this.settings['detector']        = 'RMS'; // RMS|peak
				this.settings['presets']         = 'Expander'; // Expander|Gate
				break;
			case 'gain_filter':
				this.settings['db']              = 0;  // [-30-30] dB
				break;
			case 'async_delay_filter':
				this.settings['delay_ms']        = 0;     // [0-?] ms
				break;
			case 'audio_monitor':
				this.settings['volume']          = 100;   // [0-100] %
				this.settings['locked']          = false; // [true|false]  Volume locked
				this.settings['linked']          = false; // [true|false]  Volume linked to source volume
				this.settings['mute']            = 0;     // [0-2] index: Not linked|Linked to deactivated from main view|Linked to source muting
				this.settings['delay']           = 0;     // [0-] ms (in 100ms steps)
				// device 'default' [string]
				// deviceName 'Built-In Output' [string]
				break;
			case 'ndi_audiofilter':
				this.settings['ndi_filter_ndiname'] = 'Dedicated NDI Audio output'
				break;
			case 'vst_filter':
			case 'invert_polarity_filter':
			default:
				// no settings reecorded for these
				break;
		}

		// merge actual settings with defaults generated above
		//   any setting left to its default is not transmitted, hence the need to include defaults above
		for (let key in this.settings) {
			if (this.filter.settings[key]) {
				this.settings[key] = this.filter.settings[key];
			}
		}

		// create inputs
		for (var key in this.settings) {
			var v       = this.settings[key],
				min     = 0,
				max     = 1,
				step    = 1,
				unit    = 'ms',
				format  = 'number',  // number|string|select
				options = [],        // only for select format
				labels  = [],        // only for select format
				label   = key;

			// set details by type
			switch (key) {
				case 'threshold':
				case 'suppress_level':
					min  = -60;
					max  = 0;
					unit = 'dB';
					break;
				case 'open_threshold':
				case 'close_threshold':
					min  = -96;
					max  = 0;
					unit = 'dB';
					break;
				case 'attack_time':
					min  = 1;
					max  = 500;
					break;
				case 'release_time':
				case 'hold_time':
					min  = 1;
					max  = 1000;
					break;
				case 'ratio':
					min  = 1;
					max  = 20;  // compressor can go to 32
					step = 0.1; // compressor is .5 by default
					unit = '';
					break;
				case 'output_gain':
					min  = -32;
					max  = 32;
					step = 0.1;
					unit = 'dB';
					break;
				case 'db':
					min  = -30;
					max  = 30;
					step = 0.1;
					unit = 'dB';
					break;
				case 'volume':
					max = 100;
					unit = '%';
					break;
				case 'delay':
					max  = 2000;
					step = 50;
					break;
				case 'delay_ms':
					max = 500; // can go higher
					break;
				case 'detector':
					unit    = '';
					format  = 'select';
					options = ['RMS','peak'];
					labels  = ['RMS','Peak'];
					break;
				case 'presets':
					unit    = '';
					format  = 'select';
					options = ['expander','gate'];
					labels  = ['Expander','Gate'];
					break;
				case 'method':
					unit    = '';
					format  = 'select';
					options = ['speex','rnnoise'];
					labels  = ['Speex','RNNoise']
					break;
				case 'mute':
					unit    = '';
					format  = 'indexed';
					options = [0,1,2];
					labels  = ['Independent','Unmute if active','Linked to source'];
					break;
				case 'locked':
					unit    = '';
					format  = 'boolean';
					label   = 'volume_locked';
					options = [false,true];
					labels  = ['Unlocked','Locked'];
					break;
				case 'linked':
					unit    = '';
					format  = 'boolean';
					label   = 'volume_linked';
					options = [false,true];
					labels  = ['Independent','Linked to source'];
					break;
				case 'ndi_filter_ndiname':
					unit   = '';
					format = 'string';
					label  = 'ndi_output_name'
					break;
				default:
					step = 'any';
					break;
			}

			// wrapper
			var s_el = Element.make('div', {
				'className': 'filter-setting-wrapper'
			});

			var label_el = Element.make('label', {
				'innerHTML': '<span>' + label + '</span',
				'className': 'filter-setting-label'
			});

			var input_el = undefined;

			if (format == 'number') {
				input_el = new Slider('filter_' + this.source_slug + '_type_' + this.type + '_setting_' + key + '_unit_label',min,max,step,unit,label);
				input_el.set(v);

				input_el = input_el.get_element();

				input_el.addEventListener('change', (e) =>  {
					// update in internal data if changed
					if (this.settings[e.setting] != e.value) {
						this.settings[e.setting] = e.value;

						// request remote update
						this.set_filter_setting(e.setting, e.value);
					}
				});
			} else if (format == 'string') {
				input_el = Element.make('input', {
					'id'              : 'filter_' + this.source_slug + '_type_' + this.type + '_setting_' + key,
					'name'            : 'filter-' + this.source_slug + '-type-' + this.type + '-setting-' + key,
					'type'            : (format == 'number') ? 'range' : 'text',
					'min'             : min,
					'max'             : max,
					'step'            : step,
					'value'           : v,
					'data-unit'       : unit,
					'data-setting'    : key,
					'data-source'     : this.source,
					'data-source-slug': this.source_slug,
					'data-filter'     : this.name,
					'data-format'     : format,
					'events'          : {
						'input': function (e) {
							// update in internal data
							this.settings[ e.target.getAttribute('data-setting') ] = e.target.value;

							// request remote update
							this.set_filter_setting(e.target.getAttribute('data-setting'), e.target.value)
						}.bind(this)
					}
				});
			} else if (format == 'select' || format == 'indexed' || format == 'boolean') {
				var option_els = [];
				var selectedIndex = 0;

				for (var i = 0; i < options.length; i++) {
					option_els.push( Element.make('option', {'value': options[i], 'innerHTML': labels[i]}) );
					if (options[i] == v) {
						selectedIndex = i;
					}
				}

				input_el = Element.make('select', {
					'elements'        : option_els,
					'id'              : 'filter_' + this.source_slug + '_type_' + this.type + '_setting_' + key,
					'name'            : 'filter-' + this.source_slug + '-type-' + this.type + '-setting-' + key,
					'data-unit'       : unit,
					'data-setting'    : key,
					'data-source'     : this.source,
					'data-source-slug': this.source_slug,
					'data-filter'     : this.name,
					'data-format'     : format,
					'events'          : {
						'input': function (e) {
							var val = e.target.value;
							if (e.target.getAttribute('data-format') === 'indexed') {
								val = parseFloat(val);
							}
							else if (e.target.getAttribute('data-format') === 'boolean') {
								val = (val === 'true') ? true : false;
							}
							
							// update in internal data
							this.settings[ e.target.getAttribute('data-setting') ] = val;

							// request remote update
							this.set_filter_setting(e.target.getAttribute('data-setting'), val)
						}.bind(this)
					}
				});
				// need to explicitly set the chosen value by its index
				input_el.selectedIndex = selectedIndex;
			}

			if (format != 'number')
				s_el.appendChild(label_el);
			s_el.appendChild(input_el);

			this.settings_el.appendChild(s_el);
		}
	}

	get_element () {
		return this.el;
	}

	change_name (name) {
		if (name) {
			this.name               = name;
			this.title_el.innerHTML = name;
		}
	}

	async get_filter_settings (inSource, inFilter) {
		let response = await obs.sendCommand('GetSourceFilterInfo', {'sourceName': this.source.name, 'filterName': inFilter});
		
		if (response && response.status == 'ok') {
			// merge settings with what's stored
			// for each variable, overwrite
			// trigger visual refresh
		}
	}

	toggle_open (e) {
		// store data
		this.open = !this.open;

		// update UI
		this.el.classList.toggle('open', this.open);
	}

	toggle_enable (e) {
		// store data
		this.enabled = !this.enabled;

		// update UI
		this.el.classList.toggle('disabled', !this.enabled);

		// request remote update
		this.set_visibility();
	}

	async set_visibility () {
		await obs.sendCommand('SetSourceFilterVisibility', {'sourceName': this.source.name, 'filterName': this.name, 'filterEnabled': this.enabled});
	}

	async set_filter_setting (inSetting, inValue) {
		var key_value_pair = {};
		key_value_pair[inSetting] = inValue;

		await obs.sendCommand('SetSourceFilterSettings', {'sourceName': this.source.name, 'filterName': this.name, 'filterSettings': key_value_pair});
	}
}

/** TODO
 * canvas width is inflexible; would setting width flexibly still work?
 * perhaps use a historical graph with points/lines rather than just actual?
 * convert to decibels? (requires the mul_to_db function to work properly and be generalised)
 * make this into a proper modern Class (and remove from old code)
 */
class VUMeter {
	constructor (canvas) {
		// see: https://codepen.io/travisholliday/pen/gyaJk

		this.canvas = canvas;

		var canvasContext = canvas.getContext('2d');

		var max_width  = canvas.offsetWidth;

		canvasContext.clearRect(0, 0, max_width, 37);
		canvasContext.fillStyle = "#BadA55";
		if (avg_scaled > 0.7) {
			canvasContext.fillStyle = "#eada56";
		} else if (avg_scaled > 0.85) {
			canvasContext.fillStyle = "#fd3b00";
		}
		canvasContext.fillRect(0, 0, avg_scaled * max_width, 37);
	}
}

class Fader {
	constructor (element, min, max, step, unit, label) {
		this.el           = element;
		this.value        = 0;
		this.value_db     = 0
		this.value_scaled = 0;
		this.min          = (min != undefined) ? min : 0;
		this.max          = (max != undefined) ? max : 1;
		this.step         = step || .001;
		this.unit         = unit || '';
		this.label        = label || '';
		this.active       = false;

		if (typeof this.el == 'string') {
			this.el = document.getElementById(this.el);

			if (!this.el) {
				this.el = Element.make('fader', {
					'id': element
				});
			}
		}

		this.inner_el = Element.make('div', {
			'className': 'fader-inner'
		});

		this.el.appendChild(this.inner_el);

		this.set(this.value, false);

		this.el.addEventListener('mousedown',   this.on_down.bind(this));
		this.el.addEventListener('touchdown',   this.on_down.bind(this));
		window.addEventListener( 'mousemove',   this.on_move.bind(this));
		window.addEventListener( 'touchmove',   this.on_move.bind(this));
		window.addEventListener( 'mouseup',     this.on_up.bind(this));
		window.addEventListener( 'touchup',     this.on_up.bind(this));
		window.addEventListener( 'touchcancel', this.on_up.bind(this));
	}

	get_element () {
		return this.el;
	}

	on_down (e) {
		e.preventDefault();
		this.active = true;
		this.el.classList.add('control-active');
	}

	on_move (e) {
		if (this.active) {
			e.preventDefault();

			// ensure we capture either mouse.y or touch.y value
			let y = e.layerY;
			if (!y && e.touches && e.touches[0]) {
				y = e.touches[0].layerY;
			}

			let loc_y = y - this.el.offsetTop;
			let pct_y = Math.min(Math.max(1 - (loc_y / this.el.clientHeight), 0), 1);

			// console.log(y,loc_y,pct_y,this.el.offsetTop,this.el.clientHeight,e);

			let value = round(pct_y,2);

			if (value != this.value) {
				this.set(value, false);
				this.generate_event();
			}
		}
	}

	on_up (e) {
		if (this.active) {
			this.active = false;
			this.el.classList.remove('control-active');
			e.preventDefault();
		}
	}

	generate_event () {
		let evt     = new Event('change');
		evt.value   = this.value_scaled;
		evt.valueDb = this.value_db;
		evt.setting = this.label;

		this.el.dispatchEvent(evt);
	}

	set (value, is_scaled = true) {
		// if (value != undefined)
		// 	this.value = value;
		
		if (value !=undefined && !is_scaled) {
			this.value        = value;
			
			this.value_scaled = (value * (this.max - this.min)) + this.min;
			
			if (this.step >= 1) {
				this.value_scaled = Math.round(this.value_scaled / this.step) * this.step;
			} else {
				let round_factor = 1;
				
				if (this.step == .01) {
					round_factor = 2;
				} else if (this.step == .001) {
					round_factor = 3;
				}

				this.value_scaled = round(this.value_scaled, round_factor);
			}
		} else if (value != undefined && is_scaled) {
			this.value        = (value - this.min) / (this.max - this.min);
			this.value_scaled = value;
		}

		this.value_db = round(mul_to_decibel(this.value),2);
		
		// set styles
		this.inner_el.style.height = this.value * 100 + '%';
		
		//set attributes
		this.el.setAttribute('value',             this.value);
		this.el.setAttribute('data-db',           this.value_db);
		this.el.setAttribute('data-value-scaled', this.value_scaled);
		this.el.setAttribute('data-value-unit',   this.value_scaled + ' ' + this.unit);
	}
}

class Slider {
	constructor (element, min, max, step, unit, label) {
		this.el           = element;
		this.value        = 0;
		this.value_scaled = 0;
		this.min          = (min != undefined) ? min : 0;
		this.max          = (max != undefined) ? max : 1;
		this.step         = step || .001;
		this.unit         = unit || '';
		this.label        = label || '';
		this.active       = false;

		if (typeof this.el == 'string') {
			this.el = document.getElementById(this.el);

			if (!this.el) {
				this.el = Element.make('slider', {
					'id': element
				});
			}
		}
		this.el.setAttribute('data-setting', this.label);
		this.el.setAttribute('data-label',   this.label);
		
		this.inner_el = Element.make('div', {
			'className': 'slider-inner'
		});

		this.el.appendChild(this.inner_el);

		this.set(this.value, false);

		this.el.addEventListener('mousedown',  this.on_down.bind(this));
		this.el.addEventListener('touchstart', this.on_down.bind(this));
		window.addEventListener('mousemove',   this.on_move.bind(this));
		window.addEventListener('touchmove',   this.on_move.bind(this));
		window.addEventListener('mouseup',     this.on_up.bind(this));
		window.addEventListener('touchend',    this.on_up.bind(this));
		window.addEventListener('touchcancel', this.on_up.bind(this));
	}

	get_element () {
		return this.el;
	}

	on_down (e) {
		e.preventDefault();
		this.active = true;
		this.el.classList.add('control-active');
	}

	on_move (e) {
		if (this.active) {
			e.preventDefault();

			// ensure we capture either mouse.x or touch.x value
			let x = e.x;
			if (!x && e.touches && e.touches[0]) {
				x = e.touches[0].clientX;
			}

			let loc_x = x - this.el.offsetLeft;
			let pct_x = Math.min(Math.max(loc_x / this.el.clientWidth, 0), 1);

			let value = round(pct_x, 3);

			if (value != this.value) {
				this.set(value, false);
				this.generate_event();
			}
		}
	}

	on_up (e) {
		if (this.active) {
			this.active = false;
			this.el.classList.remove('control-active');
			e.preventDefault();
		}
	}

	generate_event () {
		let evt     = new Event('change');
		evt.value   = this.value_scaled;
		evt.setting = this.label;

		this.el.dispatchEvent(evt);
	}

	set (value, is_scaled = true) {
		if (value !=undefined && !is_scaled) {
			this.value        = value;
			
			this.value_scaled = (value * (this.max - this.min)) + this.min;
			
			if (this.step >= 1) {
				this.value_scaled = Math.round(this.value_scaled / this.step) * this.step;
			} else {
				let round_factor = 1;
				
				if (this.step == .01) {
					round_factor = 2;
				} else if (this.step == .001) {
					round_factor = 3;
				}

				this.value_scaled = round(this.value_scaled, round_factor);
			}
		} else if (value != undefined && is_scaled) {
			this.value        = (value - this.min) / (this.max - this.min);
			this.value_scaled = value;
		}
		
		// set styles
		this.inner_el.style.width = this.value * 100 + '%';
		
		//set attributes
		this.el.setAttribute('value',             this.value);
		this.el.setAttribute('data-value-scaled', this.value_scaled);
		this.el.setAttribute('data-value-unit',   this.value_scaled + ' ' + this.unit);
	}
}

class Knob {
	constructor (element, min, max, step, unit, label) {
		this.el           = element;
		this.value        = 0;
		this.value_scaled = 0;
		this.min          = (min != undefined) ? min : 0;
		this.max          = (max != undefined) ? max : 1;
		this.step         = step || .001;
		this.unit         = unit || '';
		this.label        = label || '';
		this.active       = false;
		
		if (typeof this.el == 'string') {
			this.el = document.getElementById(this.el);

			if (!this.el) {
				this.el = Element.make('knob', {
					'id'        : element,
					'className' : this.label.length > 0 ? 'has-label' : '',
					'data-label': label
				});
			}
		}

		this.dial_el = Element.make('div', {
			'className': 'knob-dial'
		});

		this.dial_inner_el = Element.make('div', {
			'className': 'knob-dial-inner'
		});

		this.dial_el.appendChild(this.dial_inner_el);
		this.el.appendChild(this.dial_el);

		this.set(this.volume);

		this.dial_el.addEventListener('mousedown',   this.on_down.bind(this));
		this.dial_el.addEventListener('touchdown',   this.on_down.bind(this));
		window.addEventListener(      'mousemove',   this.on_move.bind(this));
		window.addEventListener(      'touchmove',   this.on_move.bind(this));
		window.addEventListener(      'mouseup',     this.on_up.bind(this));
		window.addEventListener(      'touchup',     this.on_up.bind(this));
		window.addEventListener(      'touchcancel', this.on_up.bind(this));
	}

	get_element () {
		return this.el;
	}

	on_down (e) {
		e.preventDefault();
		this.active = true;
		this.el.classList.add('control-active');

		// remember the original values for future reference
		let x = e.x;
		if (!x && e.touches && e.touches[0]) {
			x = e.touches[0].clientX;
		}

		let y = e.y;
		if (!y && e.touches && e.touches[0]) {
			y = e.touches[0].clientY;
		}

		this.orig_x     = x;
		this.orig_y     = y;
		this.orig_value = this.value;
	}

	on_move (e) {
		if (this.active) {
			e.preventDefault();

			// ensure we capture either mouse.x or touch.x value
			let x = e.x;
			if (!x && e.touches && e.touches[0]) {
				x = e.touches[0].clientX;
			}

			let y = e.y;
			if (!y && e.touches && e.touches[0]) {
				y = e.touches[0].clientY;
			}

			let diff_x = x - this.orig_x;
			let diff_y = y - this.orig_y;
			let value  = this.orig_value;
			if (Math.abs(diff_x) > Math.abs(diff_y)) {
				value += diff_x / 150;
			} else {
				value -= diff_y / 150;
			}
			
			// cap
			value = round(Math.min(Math.max(value, 0), 1), 2);

			if (value != this.value) {
				this.set(value, false);
				this.generate_event();
			}
		}
	}

	on_up (e) {
		if (this.active) {
			this.active = false;
			this.el.classList.remove('control-active');
			e.preventDefault();
		}
	}

	generate_event () {
		let evt     = new Event('change');
		// TODO scale with min/max
		evt.value   = this.value_scaled;
		evt.setting = this.label
		evt.valueDb = this.db;

		this.el.dispatchEvent(evt);
	}

	set (value, is_scaled = true) {
		if (value != undefined && !is_scaled) {
			this.value        = value;
			
			this.value_scaled = (value * (this.max - this.min)) + this.min;
			
			if (this.step >= 1) {
				this.value_scaled = Math.round(this.value_scaled / this.step) * this.step;
			} else {
				let round_factor = 1;
				
				if (this.step == .01) {
					round_factor = 2;
				} else if (this.step == .001) {
					round_factor = 3;
				}

				this.value_scaled = round(this.value_scaled, round_factor);
			}
		} else if (value != undefined && is_scaled) {
			this.value        = (value - this.min) / (this.max - this.min);
			this.value_scaled = value;
		}
		
		this.db = round(mul_to_decibel(this.value),1);

		let angle = ((this.value-0.5) * 1.5 * Math.PI);
		this.dial_el.style.transform       = 'rotate('+      angle +'rad)';
		this.dial_inner_el.style.transform = 'rotate('+ -1 * angle +'rad)';

		let a = (this.value * (319-46)) + 46; // [46-319]
		this.el.style.background = 'conic-gradient(from 3.1416rad, rgba(0,0,0,0) 44deg, #148 44deg, #3ad '+a+'deg, rgba(0,0,0,0) '+(a+2)+'deg)';

		// set attributes
		this.el.setAttribute('value',             this.value);
		this.el.setAttribute('data-value-scaled', this.value_scaled);
		this.el.setAttribute('data-value-unit',   this.value_scaled + ' ' + this.unit);
		this.el.setAttribute('data-db',           this.db);

		this.dial_inner_el.setAttribute('value',             this.value);
		this.dial_inner_el.setAttribute('data-value-scaled', this.value_scaled);
	}
}

// ----------------------------------------------------------------------------

/**
 * Wait for whole page to load before setting up.
 * Prevents problems with objects not loaded yet while trying to assign these.
 */
window.addEventListener('pageshow', function () {
	window.obs  = new OBS();
	window.obsr = new OBSRemote();

	window.setTimeout(obs.connect.bind(obs), 1000);
}, false);