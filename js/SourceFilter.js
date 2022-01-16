import * as h from './helper.js';
import { Slider } from './Sliders.js';

export default class SourceFilter {
	constructor (inSource, inFilter) {
		this.source         = inSource;
		this.source_slug    = h.get_slug(inSource.name);
		this.filter         = inFilter;
		this.name           = this.filter.name;
		this.type           = this.filter.type;
		this.enabled        = this.filter.enabled;
		this.open           = false;
		this.settings       = {};
		this.settings_items = {};

		this.el = h.NewElement('div', {
			'id'       : 'source_' + this.source_slug + '_filter_' + this.name,
			'className': 'source-filter filter-' + this.type
		});
		if (!this.enabled) {
			this.el.classList.add('disabled');
		}
		if (this.open) {
			this.el.classList.add('open');
		}

		this.title_el = h.NewElement('label', {
			'className': 'source-title'
		});
		this.el.appendChild(this.title_el);

		this.title_span = h.NewElement('span', {
			'title'    : this.name,
			'innerHTML': this.name,
			'events'   : {
				'click': this.toggle_open.bind(this)
			}
		});
		this.title_el.appendChild(this.title_span);

		// enable button
		this.btn_enable = h.NewElement('span', {
			'title'    : 'Toggle filter visibility',
			'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="visible-on"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="visible-off"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>',
			'className': 'button',
			'events'   : {
				'click': this.toggle_enable.bind(this)
			}
		});
		this.title_el.appendChild(this.btn_enable);

		// open button
		this.btn_open = h.NewElement('span', {
			'title'    : 'Toggle filter settings pane',
			'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-down"><polyline points="6 9 12 15 18 9"></polyline></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="chevron-up"><polyline points="18 15 12 9 6 15"></polyline></svg>',
			'className': 'button',
			'events'   : {
				'click': this.toggle_open.bind(this)
			}
		});
		this.title_el.appendChild(this.btn_open);

		this.settings_el = h.NewElement('div', {
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
				this.settings['presets']         = 'Expander'; // Expander|Gate
				this.settings['ratio']           = 2;     // [1-20 in .1 steps]
				this.settings['threshold']       = -40;   // [-60-0]  dB
				this.settings['attack_time']     = 10;    // [1-100]  ms
				this.settings['release_time']    = 50;    // [1-1000] ms
				this.settings['output_gain']     = 0;     // [-32-32] dB
				// this.settings['detector']        = 'RMS'; // RMS|peak // no longer used?
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
				// case 'detector':  // no longer used?
				// 	unit    = '';
				// 	format  = 'select';
				// 	options = ['RMS','peak'];
				// 	labels  = ['RMS','Peak'];
				// 	break;
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
			var s_el = h.NewElement('div', {
				'className': 'filter-setting-wrapper'
			});

			var label_el = h.NewElement('label', {
				'innerHTML': '<span>' + label + '</span',
				'className': 'filter-setting-label'
			});

			let input_item = undefined;
			let input_el   = undefined;

			if (format == 'number') {
				input_item = new Slider('filter_' + this.source_slug + '_type_' + this.type + '_setting_' + key + '_unit_label',min,max,step,unit,label);
				input_item.set(v);

				input_el = input_item.get_element();

				input_el.addEventListener('change', (e) =>  {
					// update in internal data if changed
					if (this.settings[e.setting] != e.value) {
						this.settings[e.setting] = e.value;

						// request remote update
						this.set_filter_setting(e.setting, e.value);
					}
				});
			} else if (format == 'string') {
				input_item = input_el = h.NewElement('input', {
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
					option_els.push( h.NewElement('option', {'value': options[i], 'innerHTML': labels[i]}) );
					if (options[i] == v) {
						selectedIndex = i;
					}
				}

				input_item = input_el = h.NewElement('select', {
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
							let val = e.target.value;
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

			this.settings_items[key] = input_item;
		}

		// set up updates on interval (no events available to get filter changes)
		this.update_on_interval();
	}

	update_on_interval () {
		this.pause_update_on_interval();

		this.get_filter_settings();

		// reset interval timeout
		this.interval_timer = window.setTimeout(this.update_on_interval.bind(this), 3000);
	}

	pause_update_on_interval () {
		// clear timeout
		window.clearTimeout(this.interval_timer);
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

	on_visibility_changed (e) {
		// store data
		this.enabled = e.filterEnabled;

		// update UI
		this.el.classList.toggle('disabled', !this.enabled);
	}

	async set_visibility () {
		await wrc.sendCommand('SetSourceFilterVisibility', {'sourceName': this.source.name, 'filterName': this.name, 'filterEnabled': this.enabled});
	}

	async set_filter_setting (inSetting, inValue) {
		var key_value_pair = {};
		key_value_pair[inSetting] = inValue;

		await wrc.sendCommand('SetSourceFilterSettings', {'sourceName': this.source.name, 'filterName': this.name, 'filterSettings': key_value_pair});
	}

	async get_filter_settings () {
		let response = await wrc.sendCommand('GetSourceFilterInfo', {'sourceName': this.source.name, 'filterName': this.name});

		if (response && response.status == 'ok') {
			// set enabled state
			this.enabled = response.enabled;

			// update UI
			this.el.classList.toggle('disabled', !this.enabled);
			
			// merge settings with what's stored
			for (let key in response.settings) {
				if (this.settings[key] != response.settings[key]) {
					this.settings[key] = response.settings[key];

					// also update UI for this setting
					let input_item = this.settings_items[key];
					
					if (input_item.set && typeof input_item.set == 'function')
						input_item.set( this.settings[key] );
					else if (input_item.getAttribute('type') == 'text')
						input_item.value = this.settings[key];
					else if (input_item.nodeName && input_item.nodeName.toLowerCase() == 'select') {
						// first, find index of new value
						let newSelectedIndex = 0;
						for (var i = 0; i < input_item.children.length; i++) {
							// if match is found, store and exit the for loop
							if (input_item.children[i].value.toLowerCase() == this.settings[key].toLowerCase()) {
								newSelectedIndex = i;
								break;
							}
						}

						// need to explicitly set the chosen value by its index
						input_item.selectedIndex = newSelectedIndex;
						
						// second, properly set the value
						if (input_item.getAttribute('data-format') === 'indexed') {
							this.settings[key] = parseFloat(this.settings[key]);
						}
						else if (input_item.getAttribute('data-format') === 'boolean') {
							this.settings[key] = (this.settings[key] === 'true') ? true : false;
						}

					} else
						console.log('unhandled filter setting change:', key, this.settings[key], input_item);
				}
			}
		}
	}
}