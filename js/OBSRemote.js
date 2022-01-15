import * as h from './helper.js';
import SourceScene from './SourceScene.js';
import SourceAudio from './SourceAudio.js';

export default class OBSRemote {
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
		this.pause_update_on_interval();

		for (var name in this.scenes) {
			this.scenes[name].pause_update();
		}

		// TODO loop over audio sources as well
	}

	is_connection_open () {
		// TODO return true if connected but false if in the midst of scenecollection or profile change
		return obs.connected;
	}

	async get_video_info () {
		// get aspect ratio
		let response = await obs.sendCommand('GetVideoInfo');

		if (response && response.status == 'ok') {
			this.video_width  = response['baseWidth'];
			this.video_height = response['baseHeight'];

			this.aspect_ratio = `${this.video_width}/${this.video_height}`;

			this.video_fps    = response['fps'];
		}
	}

	update_on_interval () {
		this.pause_update_on_interval();

		this.update_status_list();
		this.update_outputs();

		// reset interval timeout
		this.interval_timer = window.setTimeout(this.update_on_interval.bind(this), 3000);
	}

	pause_update_on_interval () {
		// clear timeout
		window.clearTimeout(this.interval_timer);
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
		// first, check suitable input typeIDs versus master list
		let suitable_audio_typeIds = [];

		let types_response = await obs.sendCommand('GetSourceTypesList');

		if (types_response && types_response.status == 'ok') {
			for (var i = 0; i < types_response.types.length; i++) {
				let t = types_response.types[i];

				if (t.type == 'input' && t.caps.hasAudio) {
					// console.log(t.typeId);
					suitable_audio_typeIds.push(t.typeId);
				}
			}
		}

		// second, get special sources list as those are sceneless
		let special_sources = [];

		let special_sources_response = await obs.sendCommand('GetSpecialSources');

		if (special_sources_response && special_sources_response.status == 'ok') {
			for (let key in special_sources_response) {
				// filter out default keys, everything else is a special source key
				if (key != 'message-id' && key != 'messageId' && key != 'status')
					special_sources.push( special_sources_response[key] );
			}
		}

		// now get to checking all sources
		let response = await obs.sendCommand('GetSourcesList');

		let current_audio_names = [];
		
		if (response.status == 'ok' && response.sources) {
			for (let i = 0; i < response['sources'].length; i++) {
				let s = response['sources'][i];
				
				// type is 'scene' or 'input'
				if (s.type == 'input' && suitable_audio_typeIds.includes(s.typeId)) {
					// first, check if it already exists. If so, skip
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
						let sa = new SourceAudio(s, special_sources.includes(s.name));
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
			let pct_time_per_frame = h.round(100.0 * avg_time_per_frame / fps_time_per_frame);

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

			let input_el = h.NewElement('input', {
				'type'     : 'checkbox',
				'id'       : 'check' + (i+1),
				'name'     : 'check' + (i+1),
				'class'    : 'checklist-item',
				'events'   : {
					'change': this.update_checklist.bind(this)
				}
			});
			let label_el = h.NewElement('label', {
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

			let id    = h.get_slug('output_item_' + o.name);
			let li_el = document.getElementById(id);

			if (!li_el) {
				li_el = h.NewElement('li', {
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
		let current_output_ids = this.outputs.map(x => h.get_slug('output_item_' + x.name));
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