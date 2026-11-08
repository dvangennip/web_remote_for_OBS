import * as h from './helper.js';
import SourceScene from './SourceScene.js';
import SourceAudio from './SourceAudio.js';

export default class WebRemote {
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

		// keyboard shortcuts: bind once and register for the page lifetime, so a
		// reconnect cannot stack a second listener on the old, still-live one
		this.handle_key_event_bound = this.handle_key_event.bind(this);
		window.addEventListener('keydown', this.handle_key_event_bound, false);

		// bumped on every disconnect so an in-flight poll tick can tell whether
		// the connection it started under is still the current one
		this.connection_generation = 0;

		// set event listeners
		this.button_transition = document.getElementById('btn_transition');
		this.button_transition.addEventListener('click', this.transition.bind(this), false);

		this.button_toggle_mode = document.getElementById('btn_toggle_mode');
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

		// setup obs event handlers (v5 names; payloads carry the state directly)
		wrc.on('StudioModeStateChanged',     this.on_studio_mode_switched.bind(this));
		wrc.on('CurrentProgramSceneChanged', this.on_scene_changed.bind(this));
		wrc.on('CurrentPreviewSceneChanged', this.on_preview_changed.bind(this));

		wrc.on('SceneListChanged',           this.on_scenes_changed.bind(this));
		wrc.on('SceneNameChanged',           this.on_scene_renamed.bind(this));
		wrc.on('InputCreated',               this.on_source_created.bind(this));
		wrc.on('InputRemoved',               this.on_source_destroyed.bind(this));
		wrc.on('InputNameChanged',           this.on_source_renamed.bind(this));

		wrc.on('StreamStateChanged',         this.on_stream_state.bind(this));
		wrc.on('RecordStateChanged',         this.on_record_state.bind(this));
		wrc.on('VirtualcamStateChanged',     this.on_virtualcam_state.bind(this));
		wrc.on('ReplayBufferStateChanged',   this.on_replay_buffer_state.bind(this));
	}

	on_connected () {
		// one batch for the first paint; events keep it current afterwards
		this.initial_poll().catch(this.log_async_error);

		// setup interval for refreshing data
		this.interval_timer = window.setTimeout(this.update_on_interval.bind(this), 3000);
	}

	async initial_poll () {
		let results = null;

		try {
			results = await wrc.batch([
				{ requestType: 'GetVideoSettings' },
				{ requestType: 'GetSceneList' },
				{ requestType: 'GetStudioModeEnabled' },
				{ requestType: 'GetVirtualCamStatus' },
			]);
		} catch (e) {
			results = null;
		}

		if (!results)
			return;

		this.apply_video_settings(results[0]);
		this.apply_scene_list(results[1]);

		if (results[2].ok) {
			this.studio_mode = results[2].data.studioModeEnabled;
			this.update_studio_mode();
			this.update_scenes();
		}

		if (results[3].ok) {
			this.virtualcam_active = results[3].data.outputActive;
			this.update_virtualcam_status();
		}

		this.update_audio_list().catch(this.log_async_error);
	}

	on_disconnected () {
		// invalidate any poll tick still awaiting its batch, so it cannot re-arm
		this.connection_generation++;

		this.pause_update_on_interval();

		for (var name in this.scenes) {
			this.scenes[name].pause_update();
		}

		// TODO loop over audio sources as well
	}

	is_connection_open () {
		// TODO return true if connected but false if in the midst of scenecollection or profile change
		return wrc.isConnected;
	}

	log_async_error (e) {
		// fire-and-forget paths must not lose their failures silently
		console.error('WebRemote: async task failed', e);
	}

	apply_video_settings (result) {
		if (!result || !result.ok)
			return;

		this.apply_video_data(result.data);
	}

	apply_video_data (data) {
		this.video_width  = data.baseWidth;
		this.video_height = data.baseHeight;

		this.aspect_ratio = `${this.video_width}/${this.video_height}`;

		const denominator = data.fpsDenominator || 1;
		this.video_fps    = data.fpsNumerator / denominator;
	}

	async update_on_interval () {
		this.pause_update_on_interval();

		// the tick that started under this generation may re-arm; a tick whose
		// batch spans a disconnect must not, or polling would resume behind the
		// reconnect and run a second chain alongside the one on_connected starts
		const generation = this.connection_generation;

		let results = null;

		try {
			results = await wrc.batch([
				{ requestType: 'GetStreamStatus' },
				{ requestType: 'GetRecordStatus' },
				{ requestType: 'GetVirtualCamStatus' },
				{ requestType: 'GetReplayBufferStatus' },
				{ requestType: 'GetStats' },
				{ requestType: 'GetVideoSettings' },
				{ requestType: 'GetOutputList' },
			]);
		} catch (e) {
			results = null;
		}

		if (results) {
			this.update_status_list(results);
			this.update_outputs(results[6]);
		}

		// reset interval timeout, but only while this tick still belongs to the
		// current connection
		if (generation === this.connection_generation)
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
		const data = await wrc.safeCall('GetStudioModeEnabled');

		if (!data)
			return;

		this.studio_mode = data.studioModeEnabled;

		this.update_studio_mode();
		this.update_scenes();
	}

	on_studio_mode_switched (e) {
		this.studio_mode = e.studioModeEnabled;
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
		// v5 has no toggle request: read the current state, then set the opposite
		const data = await wrc.safeCall('GetStudioModeEnabled');

		if (!data)
			return;

		await wrc.safeCall('SetStudioModeEnabled', { studioModeEnabled: !data.studioModeEnabled });
	}

	async get_scene_list () {
		const data = await wrc.safeCall('GetSceneList');

		if (data)
			this.apply_scene_list({ ok: true, data: data });
	}

	apply_scene_list (result) {
		if (!result || !result.ok)
			return;

		const data = result.data;

		// Sort by sceneIndex so the 0-9 hotkeys keep the same order as in OBS.
		// Skip hidden helper scenes (any with 'subscene' or 'hidden' in the name).
		this.scene_list = data.scenes
			.slice()
			.sort((a, b) => a.sceneIndex - b.sceneIndex)
			.filter(function (i) {
				let include_scene = true;
				if (i.sceneName.indexOf('subscene') != -1) {
					include_scene = false;
				}
				if (i.sceneName.indexOf('hidden') != -1) {
					include_scene = false;
				}
				return include_scene;
			});

		this.update_scene_list();

		// program and preview state after a scene list change
		this.on_scene_changed({ sceneName: data.currentProgramSceneName });
		this.on_preview_changed({ sceneName: data.currentPreviewSceneName });
	}

	update_scene_list () {
		this.tick += 1;

		// catch some odd error
		if (!this.scene_list) {
			return;
		}

		for (let i = 0; i < this.scene_list.length; i++) {
			let name = this.scene_list[i].sceneName;

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
		await this.get_scene_list();
	}

	on_preview_changed (e) {
		const scene_name = e.sceneName || '';

		// first, update old preview scene
		if (this.scenes[ this.scene_preview ]) {
			this.scenes[ this.scene_preview ].unset_preview();
		}

		this.scene_preview = scene_name;

		// update new preview scene
		if (this.scenes[ scene_name ]) {
			this.scenes[ scene_name ].set_preview();
		}
	}

	on_scene_changed (e) {
		const scene_name = e.sceneName || '';

		// first, update old program scene
		if (this.scenes[ this.scene_program ]) {
			this.scenes[ this.scene_program ].unset_program();
		}

		this.scene_program = scene_name;

		// update new program scene
		if (this.scenes[ scene_name ]) {
			this.scenes[ scene_name ].set_program();
		}

		// the audio rows resolve their scene item against the program scene, so
		// they must re-resolve it here or their visible/in-scene state freezes
		for (let i = 0; i < this.audio_list.length; i++) {
			this.audio_list[i].on_scene_changed(scene_name);
		}
	}

	on_scene_renamed (e) {
		const old_name = e.oldSceneName || '';
		const new_name = e.sceneName || '';
		const scene    = this.scenes[old_name];

		if (scene) {
			scene.change_name(new_name);

			// this.scenes is keyed by name, so move the entry with the tile
			delete this.scenes[old_name];
			this.scenes[new_name] = scene;
		}

		if (this.scene_program === old_name) {
			this.scene_program = new_name;

			for (let i = 0; i < this.audio_list.length; i++) {
				this.audio_list[i].on_scene_changed(new_name);
			}
		}

		if (this.scene_preview === old_name)
			this.scene_preview = new_name;
	}

	on_scenes_changed (e) {
		// v5 payload carries no uuids and no program/preview summary, so re-read
		this.get_scene_list().catch(this.log_async_error);
	}

	on_source_created (e) {
		// a new input may be an audio-capable one
		this.update_audio_list().catch(this.log_async_error);
	}

	on_source_destroyed (e) {
		this.update_audio_list().catch(this.log_async_error);
	}

	on_source_renamed (e) {
		// names changed, so the audio list labels need rebuilding
		this.update_audio_list().catch(this.log_async_error);
	}

	async transition () {
		if (this.studio_mode) {
			await wrc.safeCall('TriggerStudioModeTransition');
		}
	}

	async update_audio_list () {
		const list = await wrc.safeCall('GetInputList');

		if (!list)
			return;

		const inputs = list.inputs || [];

		// second, get special inputs (sceneless ones)
		let special_sources = [];

		const special = await wrc.safeCall('GetSpecialInputs');

		if (special) {
			// v5 returns names; unused slots are null
			for (let key in special) {
				if (special[key])
					special_sources.push(special[key]);
			}
		}

		// v5 has no source-type capability list: an input answers
		// GetInputAudioTracks only when it actually has audio.
		let results = [];

		if (inputs.length) {
			try {
				results = await wrc.batch(inputs.map(function (input) {
					return {
						requestType: 'GetInputAudioTracks',
						requestData: { inputName: input.inputName },
					};
				}));
			} catch (e) {
				results = [];
			}
		}

		let current_audio_names = [];

		for (let i = 0; i < inputs.length; i++) {
			const result = results[i];

			// only 604 means "this input has no audio tracks"; any other failure
			// (dropped batch entry, timeout) keeps the row on the audio path, so
			// a transient fault cannot silently hide an audio input
			if (result && !result.ok && result.error && result.error.code === 604)
				continue;

			if (!result || !result.ok) {
				console.warn('WebRemote: GetInputAudioTracks failed for "' +
					inputs[i].inputName + '", keeping as audio',
					result ? result.error : 'no response');
			}

			const s = {
				name:   inputs[i].inputName,
				type:   'input',
				typeId: inputs[i].inputKind,
			};

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
			let ix = all_inputs[i].getAttribute('data-wr-source');

			if (ix != null)
				input_list.push(all_inputs[i]);
		}

		// get all potential select elements
		let all_select_els = document.getElementsByTagName('select');

		for (var j = 0; j < all_select_els.length; j++) {
			let sx = all_select_els[j].getAttribute('data-wr-selector');

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
			let sources = item.getAttribute('data-wr-selector').split('|');

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
		// v5 has no per-source-kind text request; the settings key is 'text'
		await wrc.safeCall('SetInputSettings', {
			inputName: inSource,
			inputSettings: { text: inText },
			overlay: true,
		});
	}

	update_status_list (results) {
		const stream = results[0];
		const record = results[1];
		const vcam   = results[2];
		const replay = results[3];
		const stats  = results[4];
		const video  = results[5];

		if (stream.ok) {
			const data = stream.data;

			this.streaming = data.outputActive;

			document.getElementById('status_stream').classList.toggle('good',   data.outputActive);
			document.getElementById('status_stream').classList.toggle('alert', !data.outputActive);

			document.getElementById('status_stream_text').innerHTML =
				(data.outputActive) ? 'LIVE: ' + data.outputTimecode.replace(/\.\d+/,'') : 'Not streaming';
		}

		if (record.ok) {
			const data = record.data;

			this.recording        = data.outputActive;
			this.recording_paused = data.outputPaused;

			if (data.outputActive) {
				document.getElementById('status_recording').classList.remove('alert');
				document.getElementById('status_recording').classList.toggle('warning',  data.outputPaused);
				document.getElementById('status_recording').classList.toggle('good',    !data.outputPaused);

				document.getElementById('status_recording_text').innerHTML =
					(data.outputPaused ? 'Paused ' : 'REC ') + data.outputTimecode.replace(/\.\d+/,'');
			} else {
				document.getElementById('status_recording').classList.remove('warning');
				document.getElementById('status_recording').classList.remove('good');
				document.getElementById('status_recording').classList.add('alert');
				document.getElementById('status_recording_text').innerHTML = 'Not recording';
			}
		}

		if (vcam.ok) {
			this.virtualcam_active = vcam.data.outputActive;
			this.update_virtualcam_status();
		}

		if (replay.ok)
			this.replay_active = replay.data.outputActive;

		if (video && video.ok)
			this.apply_video_data(video.data);

		if (stats.ok) {
			const data = stats.data;

			document.getElementById('status_cpu').className =
				(data.cpuUsage > 50) ? 'status-item warning' : 'status-item';
			document.getElementById('status_cpu_text').innerHTML =
				Math.ceil(data.cpuUsage) + '%';

			let pct_time_per_frame = 0;

			if (this.video_fps) {
				const fps_time_per_frame = 1000 / this.video_fps;
				const avg_time_per_frame = data.averageFrameRenderTime; // millis
				pct_time_per_frame = h.round(100.0 * avg_time_per_frame / fps_time_per_frame);
			}

			let is_alert_state = (data.outputTotalFrames > 0 && data.outputSkippedFrames / data.outputTotalFrames > 0.05);
			if (!is_alert_state) {
				is_alert_state = (data.activeFps < this.video_fps);
			}
			if (!is_alert_state) {
				is_alert_state = (pct_time_per_frame > 50);
			}
			document.getElementById('status_frames').className = (is_alert_state) ? 'status-item alert' : 'status-item';
			document.getElementById('status_frames_text').innerHTML =
				Math.round(data.activeFps) + ' fps, ' + pct_time_per_frame + '%, ' + data.outputSkippedFrames + ' skipped';
		}

		this.update_stream_rec_status();
	}

	update_status_clock () {
		this.clock_text.innerHTML = (new Date()).toLocaleTimeString('nl-NL');  // 24 hour format
		this.clock.classList.toggle('alert', !wrc.isConnected);
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
			await wrc.safeCall('StartStream');
	}

	async stop_streaming () {
		if (this.streaming)
			await wrc.safeCall('StopStream');
	}

	on_stream_state (e) {
		this.streaming       = e.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED';
		this.stream_starting = e.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTING';
		this.stream_stopping = e.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPING';

		this.update_stream_rec_status();
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
			await wrc.safeCall('StartRecord');
	}

	async pause_recording () {
		if (this.recording && !this.recording_paused)
			await wrc.safeCall('PauseRecord');
	}

	async resume_recording () {
		if (this.recording && this.recording_paused)
			await wrc.safeCall('ResumeRecord');
	}

	async stop_recording () {
		if (this.recording)
			await wrc.safeCall('StopRecord');
	}

	on_record_state (e) {
		this.recording          = e.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTED';
		this.recording_starting = e.outputState === 'OBS_WEBSOCKET_OUTPUT_STARTING';
		this.recording_stopping = e.outputState === 'OBS_WEBSOCKET_OUTPUT_STOPPING';
		this.recording_paused   = e.outputPaused === true;

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
		const data = await wrc.safeCall('GetVirtualCamStatus');

		if (data)
			this.virtualcam_active = data.outputActive;

		this.update_virtualcam_status();
	}

	toggle_virtualcam () {
		if (this.virtualcam_active)
			this.stop_virtualcam();
		else
			this.start_virtualcam();
	}

	async start_virtualcam () {
		await wrc.safeCall('StartVirtualCam');
	}

	async stop_virtualcam () {
		await wrc.safeCall('StopVirtualCam');
	}

	on_virtualcam_state (e) {
		this.virtualcam_active = e.outputActive;
		this.update_virtualcam_status();
	}

	on_replay_buffer_state (e) {
		this.replay_active = e.outputActive;
	}

	update_virtualcam_status() {
		// status bar
		document.getElementById('status_virtualcam').classList.toggle('good', this.virtualcam_active);
		document.getElementById('status_virtualcam_text').innerHTML = (this.virtualcam_active) ? 'On' : 'Off';

		// edit pane
		this.virtualcam_button.classList.toggle('active', this.virtualcam_active);
		document.getElementById('virtualcam_button_text').innerHTML = (this.virtualcam_active) ? 'Stop virtual cam' : 'Start virtual cam';
	}

	update_outputs (result) {
		let active_outputs = 0;
		this.outputs       = [];

		if (result && result.ok) {
			for (let i = 0; i < result.data.outputs.length; i++) {
				let o = result.data.outputs[i];

				// skip over output types handled elsewhere
				if (o.outputName != 'adv_stream' && o.outputName != 'adv_file_output' && o.outputName != 'virtualcam_output') {
					this.outputs.push(o);

					if (o.outputActive)
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

			let id    = h.get_slug('output_item_' + o.outputName);
			let li_el = document.getElementById(id);

			if (!li_el) {
				li_el = h.NewElement('li', {
					'id'       : id,
					'className': 'output-info-item'
				});

				ul.appendChild(li_el);
			}

			let flags     = o.outputFlags || {};
			let has_audio = flags.OBS_OUTPUT_AUDIO === true || flags.OBS_OUTPUT_AV === true || flags.OBS_OUTPUT_ENCODED === true;
			let has_video = flags.OBS_OUTPUT_VIDEO === true || flags.OBS_OUTPUT_AV === true || flags.OBS_OUTPUT_ENCODED === true;

			li_el.classList.toggle('good',      o.outputActive);
			li_el.classList.toggle('has-audio', has_audio);
			li_el.classList.toggle('has-video', has_video);
			li_el.innerHTML = `${o.outputName} (${o.outputKind})`;
		}

		// remove outputs no longer found in list but still in page ul
		let current_output_ids = this.outputs.map(x => h.get_slug('output_item_' + x.outputName));
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
				
				if (this.scene_list[i] && this.scenes[this.scene_list[i].sceneName]) {
					this.scenes[ this.scene_list[i].sceneName ].set_scene( inEvent.shiftKey );
				}
				break;
			default:
				break;
		}

		return false;
	}
}