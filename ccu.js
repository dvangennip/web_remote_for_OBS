class CCU {
	constructor (index, element) {
		this.index    = index || 0;
		this.el       = element || document.createElement('ccu');

		// use auto-discovery of cameras rather than fixed settings?

		this.address  = this.el.getAttribute('data-address') || 'localhost';
		this.port     = parseInt(this.el.getAttribute('data-port')) || 1259;
		this.camera   = this.el.getAttribute('data-camera') || 'default';

		// title
		this.title_el = Element.make('h4', {
			'innerHTML': '<span>CAM' + (this.index+1) + ' - ' + this.camera + '</span><span>' + this.address + ':' + this.port + '</span>'
		})
		this.el.appendChild(this.title_el);

		// TODO feed this in from specific camera file
		this.settings = {
			'name'                 : 'Aver 310N',
			'protocol'             : 'visca-ip',
			'pan_position'         : {'format': 'number', 'min': -130, 'max':  130, 'step':  1, 'value':   0, 'unit': 'º',       'label': 'Pan position'},
			'tilt_position'        : {'format': 'number', 'min':  -30, 'max':   90, 'step':  1, 'value':   0, 'unit': 'º',       'label': 'Tilt position'},
			'zoom_position'        : {'format': 'number', 'min':    0, 'max': 4000, 'step':  1, 'value':   0, 'unit': undefined, 'label': 'Zoom position'},
			'pan_speed'            : {'format': 'number', 'min':    1, 'max':   24, 'step':  1, 'value':  12, 'unit': undefined, 'label': 'Pan speed'},
			'tilt_speed'           : {'format': 'number', 'min':    1, 'max':   24, 'step':  1, 'value':  12, 'unit': undefined, 'label': 'Tilt speed'},
			'zoom_speed'           : {'format': 'number', 'min':    0, 'max':    7, 'step':  1, 'value':   4, 'unit': undefined, 'label': 'Zoom speed'},
			'presets'              : 255,
			'preset_speed'         : {'format': 'number', 'min':   40, 'max':  200, 'step': 40, 'value': 120, 'unit': 'º/sec',   'label': 'Preset speed'},//actual 0-5
			'gain'                 : {'format': 'number', 'min':    0, 'max':   48, 'step':  1, 'value':   0, 'unit': 'dB',      'label': 'Gain'}, //actual: 2x 0-F
			'gain_limit_level'     : {'format': 'number', 'min':   24, 'max':   48, 'step':  1, 'value':  24, 'unit': 'dB',      'label': 'Gain limit'}, //24-48 dB //actual 4-F
			'shutter_speed'        : {'format': 'number', 'min': 1/32e5, 'max': 1, 'step':   1, 'value':   1, 'unit': 's',       'label': 'Shutter speed'},
			'iris'                 : {'format': 'number', 'min':  1.3, 'max': 2.6, 'step': 0.1, 'value':   2, 'unit': 'F',       'label': 'Iris'},
			'auto_exposure_mode'   : {'format': 'select', 'label': 'Exposure mode', 'value': 'a', 'options': [
										{'v': 'a', 'l': 'Full auto'},
										{'v': 'i', 'l': 'Iris priority'},
										{'v': 's', 'l': 'Shutter priority'},
										{'v': 'm', 'l': 'Manual'}
									]},
			'exposure_compensation': {'format': 'number', 'min': -7, 'max':   7,  'step': 1, 'value':    0, 'unit': undefined, 'label': 'EV comp'}, //2x 0-F
			'focus_position'       : {'format': 'number', 'min':  0, 'max': 4000, 'step': 1, 'value': 1000, 'unit': undefined, 'label': 'Focus position'},
			// 'focus_near_limit'     :, // in meters
			'focus_mode'           : {'format': 'select', 'label': 'Focus mode', 'value': 'a', 'options': [
										{'v': 'a', 'l': 'AF'},
										{'v': 'm', 'l': 'MF'},
										{'v': 'am', 'l': 'A/M'}
									]},
			'white_balance_mode'   : {'format': 'select', 'label': 'White balance mode', 'value': 'a', 'options': [
										{'v': 'a', 'l': 'Auto'},
										{'v': 'i', 'l': 'Indoor'},
										{'v': 'o', 'l': 'Outdoor'},
										{'v': 'p', 'l': 'One Push WB'},
										{'v': 'm', 'l': 'Manual'}
									]},
			// unsupported via VISCA but in web UI?
			// 'white_balance'        :
			// 'rgain', //0-255 step 1
			// 'bgain', //0-255 step 1
			// 'saturation', //0-10 step 1
			// 'contrast', //0-4 step 1
			// 'sharpness', //0-3 step 1
			// 'noise_filter'         :,
			'video_format'         : {'format': 'select', 'label': 'Video format', 'cmd': '8x 01 7E 01 1E 0p 0q FF', 'value': 'p:0;q:2', 'options': [
										{'v': 'p:0;q:0', 'l': '1920 x 1080p/59.94'},
										{'v': 'p:0;q:2', 'l': '1920 x 1080p/29.97'},
										{'v': 'p:0;q:3', 'l': '1920 x 1080i/59.94'},
										{'v': 'p:0;q:4', 'l': '1280 x 720p/59.94' },
										{'v': 'p:0;q:5', 'l': '1280 x 720p/29.97' },
										{'v': 'p:0;q:8', 'l': '1920 x 1080p/50'   },
										{'v': 'p:0;q:A', 'l': '1920 x 1080p/25'   },
										{'v': 'p:0;q:B', 'l': '1920 x 1080i/50'   },
										{'v': 'p:0;q:C', 'l': '1280 x720p/50'     },
										{'v': 'p:0;q:D', 'l': '1280 x 720p/25'    }
									]}
		}

		this.generate_elements();
	}

	generate_elements () {
		// monitor
		// TODO on/off mode or interval adjustment
		// TODO integrate vectorscope?

		// joystick control? indicator

		let ptz_field_el = Element.make('fieldset', {'innerHTML': '<legend>PTZ basics</legend>'});
		this.el.appendChild(ptz_field_el);

		let ptz_inner_el = Element.make('div', {'className': 'ccu-setting-row'});
		ptz_field_el.appendChild(ptz_inner_el);

		// focus
		if ('focus_position' in this.settings) {
			// TODO vertical slider
			this.generate_single_element('focus_position', ptz_inner_el, 'fader');
		}
		
		// zoom
		if ('zoom_position' in this.settings) {
			// TODO vertical slider
			this.generate_single_element('zoom_position', ptz_inner_el, 'fader');
		}

		// pan-tilt
		if ('pan_position' in this.settings && 'tilt_position' in this.settings) {
			// TODO improve UI
			this.generate_single_element('pan_position',  ptz_inner_el, 'fader');
			this.generate_single_element('tilt_position', ptz_inner_el, 'fader');
		}

		// focus_mode
		if ('focus_mode' in this.settings) {
			this.generate_single_element('focus_mode', ptz_field_el);
		}
		
		// presets
		if ('presets' in this.settings) {
			let presets_el = Element.make('div', {
				'className': 'filter-setting-wrapper ccu-preset-wrapper'
			});

			for (var i = 0; i < Math.min(this.settings['presets'],12); i++) {
				let btn_el = Element.make('button', {
					'id': 'cam_' + this.index + '_preset_btn_' + i,
					'innerHTML': 'p' + (i+1),
					'data-preset': i,
					'events': {
						'input': function (e) {
							e.preventDefault();
							// TODO
						},
						'contextmenu': function (e) {
							e.preventDefault();
							// TODO
						}
					}
				});

				presets_el.appendChild(btn_el);
			}

			ptz_field_el.appendChild(presets_el);
		}
		
		// ptz speeds
		let ptz_speed_field_el = Element.make('fieldset', {
			'innerHTML': '<legend>PTZ speed</legend>',
			'className': 'row'
		});
		this.el.appendChild(ptz_speed_field_el);

		if ('pan_speed' in this.settings) {
			this.generate_single_element('pan_speed', ptz_speed_field_el, 'knob');
		}
		if ('tilt_speed' in this.settings) {
			this.generate_single_element('tilt_speed', ptz_speed_field_el, 'knob');
		}
		if ('zoom_speed' in this.settings) {
			this.generate_single_element('zoom_speed', ptz_speed_field_el, 'knob');
		}
		if ('preset_speed' in this.settings) {
			this.generate_single_element('preset_speed', ptz_speed_field_el, 'knob');
		}
		
		// exposure mode
		let exposure_field_el = Element.make('fieldset', {'innerHTML': '<legend>Exposure</legend>'});
		this.el.appendChild(exposure_field_el);

		if ('auto_exposure_mode' in this.settings) {
			this.generate_single_element('auto_exposure_mode', exposure_field_el);
		}
		
		// gain, shutter, iris, EV
		if ('gain' in this.settings) {
			this.generate_single_element('gain', exposure_field_el);

			if ('gain_limit_level' in this.settings) {
				this.generate_single_element('gain_limit_level', exposure_field_el);
			}
		}
		if ('shutter_speed' in this.settings) {
			this.generate_single_element('shutter_speed', exposure_field_el);
		}
		if ('iris' in this.settings) {
			this.generate_single_element('iris', exposure_field_el);
		}
		if ('exposure_compensation' in this.settings) {
			this.generate_single_element('exposure_compensation', exposure_field_el);
		}

		// colour
		let colour_field_el = Element.make('fieldset', {'innerHTML': '<legend>Colour</legend>'});
		this.el.appendChild(colour_field_el);
		
		// white balance
		if ('white_balance_mode' in this.settings) {
			this.generate_single_element('white_balance_mode', colour_field_el);
		}
		
		// other colour processing
		
		// misc settings - check whichever valid setting isn't covered above
		let misc_field_el = Element.make('fieldset', {'innerHTML': '<legend>Misc settings</legend>'});
		this.el.appendChild(misc_field_el);

		for (var key in this.settings) {
			let s = this.settings[key];
			
			if (s['format'] && !s['in_UI']) {
				this.generate_single_element(key, misc_field_el);
			}
		}
	}

	generate_single_element (setting_key, parent_element, input_hint) {
		let s        = this.settings[setting_key];
		let input_el = undefined;

		// wrapper
		let s_el = Element.make('div', {
			'className': 'filter-setting-wrapper'
		});
		
		if (s.format == 'number') {
			if (input_hint === 'knob') {
				input_el = new Knob(  'ccu' + this.index + '_s_' + setting_key, s.min, s.max, s.step, s.unit, s.label);
			} else if (input_hint === 'fader') {
				input_el = new Fader( 'ccu' + this.index + '_s_' + setting_key, s.min, s.max, s.step, s.unit, s.label);
			} else {
				input_el = new Slider('ccu' + this.index + '_s_' + setting_key, s.min, s.max, s.step, s.unit, s.label);
			}
			input_el.set(s.value);

			input_el = input_el.get_element();

			input_el.addEventListener('change', function (e) {
				// update in internal data if changed
				// if (this.settings[ e.target.getAttribute('data-setting') ].value != e.value) {
				// 	this.settings[ e.target.getAttribute('data-setting') ].value = e.value;

				// // 	// request remote update
				// // 	this.set_filter_setting(e.setting, e.value);
				// }
			}.bind(this));
		} else if (s.format == 'select' || s.format == 'indexed' || s.format == 'boolean') {
			let option_els = [];
			let selectedIndex = 0;

			for (let i = 0; i < s.options.length; i++) {
				option_els.push( Element.make('option', {'value': s.options[i]['v'], 'innerHTML': s.options[i]['l']}) );
				if (s.options[i]['v'] == s.value) {
					selectedIndex = i;
				}
			}

			input_el = Element.make('select', {
				'elements'        : option_els,
				'id'              : 'ccu' + this.index + '_s_' + setting_key,
				'name'            : 'ccu' + this.index + '-s-' + setting_key,
				'data-unit'       : s.unit,
				'data-setting'    : setting_key,
				'data-format'     : s.format,
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
						// this.set_filter_setting(e.target.getAttribute('data-setting'), val)
					}.bind(this)
				}
			});

			// need to explicitly set the chosen value by its index
			input_el.selectedIndex = selectedIndex;
		}

		if (s.format != 'number') {
			let label_el = Element.make('label', {
				'innerHTML': '<span>' + s.label + '</span',
				'className': 'filter-setting-label'
			});

			s_el.appendChild(label_el);
		}
		s_el.appendChild(input_el);

		if (parent_element) {
			parent_element.appendChild(s_el);
		} else {
			this.el.appendChild(s_el);
		}

		// register we've added this element
		this.settings[setting_key]['in_UI'] = true;
	}

	update () {
		// update preview/program class based on obs data
	}

	prepare_command (hex_string, p, q, r, s) {
		// hex_string.replace()
	}
	
}

window.addEventListener('pageshow', function () {
	ccus = document.getElementsByTagName('ccu');

	for (var i = 0; i < ccus.length; i++) {
		ccus[i] = new CCU(i, ccus[i]);
	}
})