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

class MinimalRequest {
	constructor (url, data, callback) {
		this.xhr = new XMLHttpRequest();

		this.xhr.responseType = 'json';

		this.xhr.open('POST', url);

		this.xhr.setRequestHeader('Content-Type',     'application/json');
		this.xhr.setRequestHeader('X-Requested-With', 'XMLHttpRequest');
		this.xhr.setRequestHeader('Accept',           'application/json');
		this.xhr.setRequestHeader('X-Request',        'JSON');

		if (callback && typeof(callback) == 'function') {
			this.xhr.onloadend = function (e) {
				callback(e.target.response, e.target);
			};
		}
		
		if (data) {
			this.xhr.send( JSON.stringify(data) );
		} else {
			this.xhr.send();
		}
	}
}

class OBSRemote {

	constructor () {
		this.studio_mode   = false;
		this.scene_list    = [];
		this.scene_program = '';
		this.scene_preview = '';
		this.audio_list    = [];

		// set event listeners
		this.button_transition = document.getElementById('btn_transition');
		this.button_transition.addEventListener('click', this.transition.bind(this), false);

		this.button_toggle_mode = document.getElementById('btn_toggle_mode');
		this.button_toggle_text = document.getElementById('btn_toggle_mode_text');
		this.button_toggle_mode.addEventListener('click', this.toggle_studio_mode.bind(this), false);
		this.button_toggle_text.classList.add('hidden');
		this.button_toggle_mode.querySelector('.icon-exit-studio-mode').classList.remove('hidden');
		this.button_toggle_mode.classList.add('small-button');

		this.button_fullscreen = document.getElementById('btn_toggle_fullscreen');
		// if fullscreen functionallity is available, set it up, otherwise hide button
		if (this.button_fullscreen.requestFullscreen) {
			this.button_fullscreen.addEventListener('click', this.toggle_fullscreen.bind(this), false);
			window.addEventListener('fullscreenchange', this.handle_fullscreen_event.bind(this), false);
		} else {
			this.button_fullscreen.className = 'hidden';
		}

		window.addEventListener('keydown', this.handle_key_event.bind(this), false);

		// setup
		this.get_studio_mode();

		this.get_scene_list();
		
		this.update_audio_list();

		this.update_source_list();

		// setup interval for refreshing data
		self.interval_timer = window.setTimeout(this.update_on_interval.bind(this), 3000);

		window.setInterval(this.update_status_clock.bind(this),1000);
	}

	toggle_fullscreen () {
		var b = document.getElementsByTagName('body')[0];

		if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
			document.documentElement.requestFullscreen();
		} else if (document.exitFullscreen) {
			document.exitFullscreen();
		}
	}

	handle_fullscreen_event () {
		this.button_fullscreen.className = document.fullscreenElement ? 'top-button small-button fullscreen' : 'top-button small-button';
	}

	get_studio_mode () {
		new MinimalRequest('/call/GetStudioModeStatus', undefined, function (response) {
			if (response.status == 'ok') {
				this.studio_mode = response['studio-mode'];
				
				this.update_studio_mode();

				this.update_scenes();
			}
		}.bind(this));
	}

	update_studio_mode () {
		// update stuff
		if (!this.studio_mode) {
			this.scene_preview = '';
		}
		document.getElementById('view_preview').className = (this.studio_mode) ? '' : 'hidden';
		this.button_transition.className  = (this.studio_mode) ? '' : 'hidden';
		this.button_toggle_text.innerHTML = (this.studio_mode) ? 'Studio' : 'Direct';
	}

	toggle_studio_mode() {
		new MinimalRequest('/emit/ToggleStudioMode', undefined, function (response) {
			if (response.status == 'ok') {
				this.get_studio_mode();
			}
		}.bind(this));

		// update immediately for fast feedback
		this.studio_mode = !this.studio_mode;
		this.update_studio_mode();
	}

	get_scene_list () {
		new MinimalRequest('/call/GetSceneList', undefined, function (response) {
			if (response.status == 'ok') {
				// update data
				this.scene_program = response['current-scene'];
				// update scenes but skip hidden scenes (any with 'subscene' in the name)
				this.scene_list    = response['scenes'].filter(function (i) {
					return i.name.indexOf('subscene') === -1;
				});

				this.update_scene_list();
			}
		}.bind(this));
	}

	update_scene_list () {
		// catch some odd error
		if (!this.scene_list) {
			return;
		}

		for (var i = 0; i < this.scene_list.length; i++) {
			var name = this.scene_list[i].name,
				slug = this.slug(name);

			var li_el = document.getElementById('li_scene_' + slug);

			if (li_el) {
				// if element exists, edit it
				var btn_el = document.getElementById('btn_scene_' + slug);

				if (btn_el) {
					// console.log(this.scene_program, this.scene_preview, name, this.scene_program === name, this.scene_preview === name);
					if (this.scene_program === name) {
						btn_el.className = 'program';
					} else if (this.scene_preview === name) {
						btn_el.className = 'preview';
					} else {
						btn_el.className = '';
					}
				}
			} else {
				// otherwise, create element
				li_el      = Element.make('li', {'id': 'li_scene_' + slug});
				var btn_el = Element.make('button', {
					'id'       : 'btn_scene_' + slug,
					'innerHTML': name,
					'data-bc'  : (i < 9) ? i + 1 : '-',
					'events'   : {
						'click'   : this.set_scene.bind(this, name)
					}
				});

				li_el.appendChild(btn_el);
				document.getElementById('scene_list').appendChild(li_el);

				this.update_scenes();
			}
		}
	}

	update_scenes () {
		if (this.studio_mode) {
			this.get_preview_scene(true);
		}
		this.get_program_scene(true);

		// add a minor delay as we can't rely on async functionality on very old browsers
		window.setTimeout(this.update_scene_list.bind(this), 250);
	}

	get_program_scene (ignoreUpdateScenes) {
		new MinimalRequest('/call/GetCurrentScene', undefined, function (response) {
			if (response.status == 'ok') {
				this.scene_program = response['name'];
					
				if (!ignoreUpdateScenes) {
					this.update_scene_list();
				}
			}
		}.bind(this));
	}

	get_preview_scene (ignoreUpdateScenes) {
		new MinimalRequest('/call/GetPreviewScene', undefined, function (response) {
			if (response.status == 'ok') {
				this.scene_preview = response['name'];
					
				if (!ignoreUpdateScenes) {
					this.update_scene_list();
				}
			}
		}.bind(this));
	}

	set_scene (inSceneName) {
		var url = (this.studio_mode) ? '/call/SetPreviewScene' : '/call/SetCurrentScene';
		
		new MinimalRequest(url, {'scene-name': inSceneName}, function (response) {
			if (response.status == 'ok') {
				this.update_scenes();
			}
		}.bind(this));

		// update immediately for fast feedback
		if (this.studio_mode) {
			this.scene_preview = inSceneName;
		} else {
			this.scene_program = inSceneName;
		}
		this.update_scene_list();
	}

	transition () {
		new MinimalRequest('/call/TransitionToProgram', undefined, function (response) {
			if (response.status == 'ok') {
				// give OBS some time to swap
				window.setTimeout(this.update_scenes.bind(this), 500);
			}
		}.bind(this));

		// update immediately for fast feedback
		var temp           = this.scene_preview;
		this.scene_preview = this.scene_program;
		this.scene_program = temp;
		this.update_scene_list();

		var view_preview = document.getElementById('view_preview');
		var view_program = document.getElementById('view_program');
		var temp_src     = view_preview.src;
		view_preview.src = view_program.src;
		view_program.src = temp_src;
	}

	set_source_screenshot (isPreview) {
		var width      = document.querySelector('body').offsetWidth - 10 - 12 - 10;  // subtract margins, borders, fudge factor
		var img_width  = width;
		if (this.studio_mode) {
			img_width  = img_width / 2;
		} else {
			img_width  = Math.min(width, 600); // put a reasonable cap on the width to keep bandwidth low
		}
		var img_height = (1 / (1920/1080)) * img_width; // TODO improve ratio from current scene data
		
		new MinimalRequest('/call/TakeSourceScreenshot',
			{'sourceName': (isPreview) ? this.scene_preview : this.scene_program, 'embedPictureFormat': 'jpg', 'width': img_width, 'height': img_height},
			function (response) {
				if (response.status == 'ok' && response.img) {
					document.getElementById('view_' + ((isPreview) ? 'preview' : 'program') ).src = response.img;
				}
			}.bind(this)
		);
	}

	update_audio_list () {
		new MinimalRequest('/call/GetSourcesList', undefined, function (response) {
			if (response.status == 'ok' && response.sources) {
				// TODO merge nicely rather than delete all
				this.audio_list = [];

				for (var i = 0; i < response['sources'].length; i++) {
					var s = response['sources'][i];
					
					// type is 'scene' or 'input'
					if (s.type == 'input' && (s.typeId == 'ffmpeg_source' || s.typeId == 'ndi_source' || s.typeId == 'coreaudio_input_capture' || s.typeId == 'ios-camera-source')) {
						this.audio_list.push(s)
					}
				}
				
				this.update_audio();
			}
		}.bind(this));
	}

	update_audio () {
		for (var i = 0; i < this.audio_list.length; i++) {
			this.get_volume(this.audio_list[i].name);
		}

		// use timeout to let volume data come back
		window.setTimeout(function () {
			for (var i = 0; i < this.audio_list.length; i++) {
				var name   = this.audio_list[i].name,
					slug   = this.slug(name),
					volume = isNaN(this.audio_list[i].volume) ? 1 : this.audio_list[i].volume;

				var li_el  = document.getElementById('li_audio_' + slug);

				if (!li_el) {
					// create elements
					li_el      = Element.make('li', {'id': 'li_audio_' + slug});
					var div_el = Element.make('div', {
						'className': 'audio-label-bar'
					});
					var label_el = Element.make('label', {
						'id': 'label_' + slug,
						'innerHTML': (this.audio_list[i].muted) ? '🔇 ' + name : '🔈 ' + name,
						'className': (this.audio_list[i].muted) ? 'muted' : '',
						'events'   : {
							'click': this.toggle_mute.bind(this, name)
						}
					});
					var vol_el = Element.make('span', {
						'id'       : 'audio_volume_' + slug,
						'innerHTML': (this.audio_list[i].muted) ? 'muted' : this.round(this.mul_to_decibel(volume),1) + ' dB',
						'className': (this.audio_list[i].muted) ? 'muted' : ''
					});

					li_el.appendChild(div_el);
					div_el.appendChild(label_el);
					div_el.appendChild(vol_el);
					
					
					var input_el = Element.make('input', {
						'id'    : 'audio_' + slug,
						'name'  : 'audio_' + slug,
						'type'  : 'range',
						'min'   : 0,
						'max'   : 1,
						'step'  : 'any',
						'value' : volume,
						'events': {
							'input': this.set_volume.bind(this, name)
						}
					});

					li_el.appendChild(input_el);

					var filter_bar_el = Element.make('div', {
						'id'       : 'audio_' + slug + '_filter_bar',
						'className': 'filter-bar'
					});

					li_el.appendChild(filter_bar_el);
				
					document.getElementById('audio_list').appendChild(li_el);

					// finally, request audio filters for this source
					this.get_source_filters(name);
				} else {
					// just update current element
					let label_el = document.getElementById('label_' + slug),
						vol_el   = document.getElementById('audio_volume_' + slug);

					label_el.innerHTML = (this.audio_list[i].muted) ? '🔇 ' + name : '🔈 ' + name;
					label_el.className = (this.audio_list[i].muted) ? 'muted' : '';

					vol_el.innerHTML   = (this.audio_list[i].muted) ? 'muted' : this.round(this.mul_to_decibel(volume),1) + ' dB';
					vol_el.className   = (this.audio_list[i].muted) ? 'muted' : '';

					// update input_el
					document.getElementById('audio_' + slug).value = volume;
				}
			}
		}.bind(this), 300);
	}

	get_volume (inSource) {
		new MinimalRequest('/call/GetVolume', {'source': inSource}, function (response) {
			if (response.status == 'ok') {
				for (var i = 0; i < this.audio_list.length; i++) {
					if (this.audio_list[i].name == response.name) {
						this.audio_list[i]['volume'] = response.volume;
						this.audio_list[i]['muted']  = response.muted;
					}
				}
			}
		}.bind(this));
	}

	set_volume (inSource, inVolume) {
		var vol = inVolume;
		if (inVolume === undefined || isNaN(inVolume)) {
			vol = parseFloat(document.getElementById('audio_' + this.slug(inSource)).value);
		}

		new MinimalRequest('/call/SetVolume', {'source': inSource, 'volume': vol}, function (response) {
			if (response.status == 'ok') {
				this.update_audio();
			}
		}.bind(this));

		// update immediately for feedback
		document.getElementById('audio_volume_' + this.slug(inSource)).innerHTML = this.round(this.mul_to_decibel(vol),1) + ' dB';
	}

	toggle_mute (inSource) {
		new MinimalRequest('/call/ToggleMute', {'source': inSource}, function (response) {
			if (response.status == 'ok') {
				this.update_audio();
			}
		}.bind(this));
	}

	update_source_list () {
		// TODO make this flexible

		// intermission text
		document.getElementById('IM-text').addEventListener('change', function (e) {
			this.set_text(e.target.name, e.target.value);
			e.preventDefault()
		}.bind(this), false);

		document.getElementById('IM-select').addEventListener('change', function (e) {
			document.getElementById('IM-text').value = e.target.value;
			
			this.set_text('IM-text', e.target.value);

			e.preventDefault()
		}.bind(this), false);

		// lower third
		document.getElementById('LT-name').addEventListener('change', function (e) {
			this.set_text(e.target.name, e.target.value);
			e.preventDefault()
		}.bind(this), false);
		
		document.getElementById('LT-role').addEventListener('change', function (e) {
			this.set_text(e.target.name, e.target.value);
			e.preventDefault()
		}.bind(this), false);

		document.getElementById('LT-affiliation').addEventListener('change', function (e) {
			this.set_text(e.target.name, e.target.value);
			e.preventDefault()
		}.bind(this), false);

		document.getElementById('LT-select').addEventListener('change', function (e) {
			var values = e.target.value.split('|');

			document.getElementById('LT-name').value        = values[0];
			document.getElementById('LT-role').value        = values[1];
			document.getElementById('LT-affiliation').value = values[2];
			
			this.set_text('LT-name', values[0]);
			this.set_text('LT-role', values[1]);
			this.set_text('LT-affiliation', values[2]);

			e.preventDefault()
		}.bind(this), false);
	}

	set_text (inSource, inText) {
		new MinimalRequest('/emit/SetTextFreetype2Properties', {'source': inSource, 'text': inText});
	}

	update_status_list () {
		new MinimalRequest('/call/GetStreamingStatus', {}, function (response) {
			if (response.status == 'ok') {
				document.getElementById('status_stream').className =
					(response.streaming) ? 'status-item good' : 'status-item alert';
				document.getElementById('status_stream_text').innerHTML =
					(response.streaming) ? 'LIVE: ' + response['stream-timecode'].replace(/\.\d+/,'') : 'Stream inactive';

				if (response.recording) {
					document.getElementById('status_recording').className =
						(response['recording-paused']) ? 'status-item warning' : 'status-item good';
					document.getElementById('status_recording_text').innerHTML =
						(response['recording-paused']) ? 'Paused ' : 'REC ';
					document.getElementById('status_recording_text').innerHTML += response['rec-timecode'].replace(/\.\d+/,'');
				} else {
					document.getElementById('status_recording').className = 'status-item alert';
					document.getElementById('status_recording_text').innerHTML = 'Not recording';	
				}
			}
		});
		
		new MinimalRequest('/call/GetStats', {}, function (response) {
			if (response.status == 'ok') {
				document.getElementById('status_cpu').className =
					(response.stats['cpu-usage'] > 50) ? 'status-item warning' : 'status-item';
				document.getElementById('status_cpu').innerHTML =
					'CPU: ' + Math.ceil(response.stats['cpu-usage']) + '%';

				let is_alert_state = (response.stats['output-skipped-frames'] / response.stats['output-total-frames'] > 0.05);
				if (!is_alert_state) {
					is_alert_state = (response.stats['fps'] < 30);
				}
				document.getElementById('status_frames').className = (is_alert_state) ? 'status-item alert' : 'status-item';
				document.getElementById('status_frames').innerHTML =
					Math.round(response.stats['fps']) + ' fps, '+ response.stats['output-skipped-frames'] + ' skipped';
			}
		});
	}

	update_status_clock () {
		document.getElementById('status_clock').innerHTML = (new Date()).toLocaleTimeString('nl-NL');  // 24 hour format
	}

	get_source_filters (inSource) {
		new MinimalRequest('/call/GetSourceFilters', {'sourceName': inSource}, function (response) {
			if (response.status == 'ok') {
				var slug              = this.slug(inSource);
				var source_filter_bar = document.getElementById('audio_' + slug + '_filter_bar');

				for (var i = 0; i < response.filters.length; i++) {
					var filter = response.filters[i];
					// console.log(filter);

					var create_filter = true;

					var settings = {};

					switch (filter.type) {
						case 'noise_gate_filter':
							settings['close_threshold'] = -32;  // [-96-0]  dB
							settings['open_threshold']  = -26;  // [-96-0]  dB
							settings['attack_time']     = 25;   // [1-500]  ms
							settings['hold_time']       = 200;  // [1-1000] ms
							settings['release_time']    = 150;  // [1-1000] ms
							break;
						case 'noise_suppress_filter_v2':
							settings['method']         = 'rnnoise'; // speex|rnnoise
							settings['suppress_level'] = -30;       // [-60-0] dB
							break;
						case 'limiter_filter':
							settings['threshold']    = -6;  // [-60-0]  dB
							settings['release_time'] = 60;  // [1-1000] ms
							break;
						case 'compressor_filter':
							settings['ratio']         = 10;  // [1-32 in .5 steps]
							settings['threshold']     = -18; // [-60-0]  dB
							settings['attack_time']   = 6;   // [1-500]  ms
							settings['release_time']  = 60;  // [1-1000] ms
							settings['output_gain']   = 0;   // [-32-32] dB
							break;
						case 'expander_filter':
							settings['ratio']         = 2;     // [1-20 in .1 steps]
							settings['threshold']     = -40;   // [-60-0]  dB
							settings['attack_time']   = 10;    // [1-100]  ms
							settings['release_time']  = 50;    // [1-1000] ms
							settings['output_gain']   = 0;     // [-32-32] dB
							settings['detector']      = 'RMS'; // RMS|peak
							settings['presets']       = 'Expander'; // Expander|Gate
							break;
						case 'gain_filter':
							settings['db'] = 0;  // [-30-30] dB
							break;
						case 'vst_filter':
							break;
						case 'audio_monitor':
							settings['volume']    = 100;   // [0-100] %
							settings['locked']    = false; // [true|false]  Volume locked
							settings['linked']    = false; // [true|false]  Volume linked to source volume
							settings['mute']      = 0;     // [0-2] index: Not linked|Linked to deactivated from main view|Linked to source muting
							settings['delay']     = 0;     // [0-] ms (in 100ms steps)
							// device 'default' [string]
							// deviceName 'Built-In Output' [string]
							break;
						default:
							// do nothing for types not handled above
							create_filter = false;
							break;
					}

					// create_filter element
					if (create_filter) {
						// merge response settings with defaults generated above
						//   any setting left to its default is not transmitted, hence the need to include defaults
						for (let key in settings) {
							if (filter.settings[key]) {
								settings[key] = filter.settings[key];
							}
						}

						let filter_instance = new SourceFilter(inSource, filter.name, filter.type, filter.enabled, settings);

						source_filter_bar.appendChild( filter_instance.get_element() );
					}
				}
			}
		}.bind(this));
	}

	update_on_interval () {
		// clear timeout
		window.clearTimeout(self.interval_timer);

		this.get_studio_mode();
		this.update_scenes();
		this.update_audio();

		if (this.studio_mode) {
			this.set_source_screenshot(true);
		}
		this.set_source_screenshot(false);

		this.update_status_list();

		// reset interval timeout
		self.interval_timer = window.setTimeout(this.update_on_interval.bind(this), 3000);
	}

	handle_key_event (inEvent) {
		// avoid 'silencing' input fields
		if (inEvent.target && inEvent.target.nodeName.toLowerCase() === 'input') {
			return;
		} else if (inEvent && inEvent.preventDefault) {
			inEvent.preventDefault();
		}

		switch (inEvent.key) {
			case 't':
				this.transition();
				break;
			case 's':
				this.toggle_studio_mode();
				break;
			case '1':
			case '2':
			case '3':
			case '4':
			case '5':
			case '6':
			case '7':
			case '8':
			case '9':
				var i = parseInt(inEvent.key,10) - 1;
				if (this.scene_list[i]) {
					this.set_scene(this.scene_list[i].name);
				}
				break;
			default:
				break;
		}

		return false;
	}

	slug (inString) {
		// using replaceAll is apparently too new (Safari 13+, Chrome 85+), so use replace with regex //global modifier
		return inString.toLowerCase().replace(/\s/g, '_').replace(/\+/g,'_').replace(/\//g,'_');
	}

	mul_to_decibel (inMul) {
		// assumption mul is in range [0,1], dB [-94.5,0]
		return ((0.212 * Math.log10(inMul) + 1) * 94.5) - 94.5;
	}

	round (value, precision) {
		let multiplier = Math.pow(10, precision || 0);
		return Math.round(value * multiplier) / multiplier;
	}
}

class SourceFilter {
	constructor (inSource, inName, inType, inEnabled, inSettings) {
		this.source      = inSource;
		this.source_slug = inSource.toLowerCase().replace(/\s/g, '_').replace(/\+/g,'_').replace(/\//g,'_');
		this.name        = inName;
		this.type        = inType;
		this.enabled     = inEnabled;
		this.settings    = inSettings;

		this.el = Element.make('div', {
			'id'       : 'source_' + this.source + '_filter_' + this.name,
			'className': 'source-filter filter-' + this.type
		});
		if (!this.enabled) {
			this.el.classList.add('muted');
		}

		var title = Element.make('h4', {
			'innerHTML': this.name,
			'events': {
				'click': function (e) {
					// store data
					this.enabled = !this.enabled;

					// update UI
					if (this.enabled) {
						e.target.parentElement.classList.remove('muted');
					} else {
						e.target.parentElement.classList.add('muted')
					}

					// request remote update
					this.set_visibility();
				}.bind(this)
			}
		});

		this.el.appendChild(title);

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

			var unit_el = undefined;

			var input_el = undefined;

			if (format == 'number' || format == 'string') {
				unit_el = Element.make('span', {
					'id'       : 'filter_' + this.source_slug + '_type_' + this.type + '_setting_' + key + '_unit_label',
					'innerHTML': v + ' ' + unit,
					'className': 'filter-setting-unit'
				});

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
							var val = e.target.value;
							if (e.target.getAttribute('data-format') === 'number') {
								val = parseFloat(val);
							}

							// update in internal data
							this.settings[ e.target.getAttribute('data-setting') ] = val;

							// set unit label to input's current value
							document.getElementById(e.target.id + '_unit_label').innerHTML = val + ' ' + e.target.getAttribute('data-unit');

							// request remote update
							this.set_filter_setting(e.target.getAttribute('data-setting'), val)
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

			if (unit_el) {
				label_el.appendChild(unit_el);
			}

			s_el.appendChild(label_el);
			s_el.appendChild(input_el);

			this.el.appendChild(s_el);
		}
	}

	get_element () {
		return this.el;
	}

	get_filter_settings (inSource, inFilter) {
		new MinimalRequest('/call/GetSourceFilterInfo', {'sourceName': inSource, 'filterName': inFilter}, function (response) {
			if (response.status == 'ok') {
				// merge settings with what's stored
				// for each variable, overwrite
				// trigger visual refresh
			}
		});
	}

	set_visibility () {
		new MinimalRequest('/call/SetSourceFilterVisibility', {'sourceName': this.source, 'filterName': this.name, 'filterEnabled': this.enabled});
	}

	set_filter_setting (inSetting, inValue) {
		var key_value_pair = {};
		key_value_pair[inSetting] = inValue;

		new MinimalRequest('/call/SetSourceFilterSettings', {'sourceName': this.source, 'filterName': this.name, 'filterSettings': key_value_pair});
	}
}

/** TODO
 * currently uses mic input -> better to be source input
 * canvas width is inflexible; would setting width flexibly still work?
 * perhaps use a historical graph with points/lines rather than just actual?
 * convert to decibels? (requires the mul_to_db function to work properly and be generalised)
 * make this into a proper modern Class (and remove from old code)
 */
class VUMeter {
	constructor () {
		// see: https://codepen.io/travisholliday/pen/gyaJk

		// first, create canvas element
		var canvas = Element.make('canvas', {
			'id'    : 'audio_canvas',
			'width' : '670px',
			'height': '37px'
		})
		document.getElementById('audio_list').appendChild(canvas);

		navigator.getUserMedia = navigator.getUserMedia || navigator.webkitGetUserMedia || navigator.mozGetUserMedia;

		if (navigator.getUserMedia) {
			navigator.getUserMedia(
				{
					audio: true
				},
				function (stream) {
					var audioContext   = new AudioContext();
					var analyser       = audioContext.createAnalyser();
					var microphone     = audioContext.createMediaStreamSource(stream);
					var javascriptNode = audioContext.createScriptProcessor(2048, 1, 1);

					analyser.smoothingTimeConstant = 0.8;
					analyser.fftSize = 1024;

					microphone.connect(analyser);
					analyser.connect(javascriptNode);
					javascriptNode.connect(audioContext.destination);

					// var canvas        = document.getElementById('audio_canvas');
					var canvasContext = canvas.getContext('2d');

					javascriptNode.onaudioprocess = function () {
						var array = new Uint8Array(analyser.frequencyBinCount);
						analyser.getByteFrequencyData(array);
						var values = 0;

						var length = array.length;
						for (var i = 0; i < length; i++) {
							values += array[i];
						}

						var average    = values / length;
						var avg_scaled = (average / 180);  // 2nd var is a known maximum
					
						var max_width  = canvas.offsetWidth;

						// console.log(average, avg_scaled, max_width, avg_scaled*max_width);
						
						canvasContext.clearRect(0, 0, max_width, 37);
						canvasContext.fillStyle = "#BadA55";
						if (avg_scaled > 0.7) {
							canvasContext.fillStyle = "#eada56";
						} else if (avg_scaled > 0.85) {
							canvasContext.fillStyle = "#fd3b00";
						}
						canvasContext.fillRect(0, 0, avg_scaled * max_width, 37);
						// draw text on top
						// canvasContext.fillStyle = "#262626";
						// canvasContext.font      = "48px impact";
						// canvasContext.fillText(Math.round(average - 40), -2, 300);
					}; // end fn stream
				},
				function (err) {
					console.log('The following error occured: ' + err.name);
				}
			)
		} else {
			console.log('getUserMedia not supported');
		}
	}
}

// ----------------------------------------------------------------------------

/**
 * Wait for whole page to load before setting up.
 * Prevents problems with objects not loaded yet while trying to assign these.
 */
window.addEventListener('pageshow', function () {
	window.main = new OBSRemote();
}, false);