import * as h from './helper.js';
import SourceFilter from './SourceFilter.js';
import { Fader } from './Sliders.js';

export default class SourceAudio {
	constructor (inSource, is_sceneless) {
		this.source      = inSource;
		this.name        = inSource.name;
		this.slug        = h.get_slug(inSource.name);
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
		this.in_scene    = false;
		this.sceneless   = is_sceneless || false;

		// create elements
		this.el                = h.NewElement('li',     {'className': 'audio-item', 'id': 'audio_item_' + this.slug});
		this.name_el           = h.NewElement('div',    {'className': 'audio-name', 'innerHTML': this.name});
		this.settings_el       = h.NewElement('div',    {'className': 'audio-settings'});
		this.column_vu_el      = h.NewElement('div',    {'className': 'audio-column-vu'});
		this.vol_max_el        = h.NewElement('div',    {
			'className': 'audio-max',
			'title'    : 'Max output volume (click to reset)',
			'innerHTML': 'dB'
		});
		this.vol_canvas        = h.NewElement('canvas', {'className': 'audio-vu'});
		this.column_fader_el   = h.NewElement('div',    {'className': 'audio-column-fader'});
		this.vol_el            = h.NewElement('div',    {
			'className': 'audio-current',
			'title'    : 'Current volume setting',
			'innerHTML': 'dB'
		});
		this.fader             = new Fader(this.slug + '_fader');
		this.fader.get_element().addEventListener('change', this.on_fader_change.bind(this));
		this.column_buttons_el = h.NewElement('div',    {'className': 'audio-column-buttons'});
		if (!this.sceneless) {
			this.btn_visibility = h.NewElement('button', {
				'className': 'audio-button visibility',
				'title'    : 'Toggle visibility',
				'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="visible-on"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path><circle cx="12" cy="12" r="3"></circle></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="visible-off"><path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"></path><line x1="1" y1="1" x2="23" y2="23"></line></svg>',
				'events': {
					'click': this.on_visibility_btn_click.bind(this)
				}
			});
		}
		
		this.btn_mute          = h.NewElement('button', {
			'className': 'audio-button mute',
			'title'    : 'Toggle mute',
			'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-on"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-off"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-1"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>',
			'events': {
				'click': this.on_mute_btn_click.bind(this)
			}
		});
		this.btn_solo          = h.NewElement('button', {
			'className': 'audio-button solo',
			'title'    : 'Toggle solo',
			'innerHTML': 'S',
			'events': {
				'click': this.on_solo_btn_click.bind(this)
			}
		});
		this.btn_monitor       = h.NewElement('button', {
			'className': 'audio-button',
			'innerHTML': 'X',
			'events': {
				'click': this.on_monitor_btn_click.bind(this)
			}
		});
		this.tracks_el         = h.NewElement('div',    {'className': 'audio-tracks'});
		this.filters_list_el   = h.NewElement('ul',     {'className': 'filters-list'});

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
		if (!this.sceneless) {
			this.column_buttons_el.appendChild(this.btn_visibility);
		}
		// this.column_buttons_el.appendChild(this.btn_solo);
		// this.column_buttons_el.appendChild(this.btn_monitor);
		this.column_buttons_el.appendChild(this.tracks_el);

		for (let i = 1; i < 7; i++) {
			let t = h.NewElement('span', {
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
		if (!this.sceneless) {
			this.get_visibility();
		}
		this.get_active();
		this.get_tracks();
		this.get_source_filters();

		// handle relevant events
		obs.on('SourceVolumeChanged',           this.on_volume_changed.bind(this));
		obs.on('SourceMuteStateChanged',        this.on_mute_state_changed.bind(this));
		obs.on('SourceAudioActivated',          (e) => {console.log(e, e['sourceName']);});
		obs.on('SourceAudioDeactivated',        (e) => {console.log(e, e['sourceName']);});
		
		obs.on('SourceAudioMixersChanged',      this.on_tracks_changed.bind(this));

		//SourceCreated + SourceDestroyed (handle externally?)
		obs.on('SourceRenamed',                 this.on_source_renamed.bind(this));

		obs.on('SceneItemVisibilityChanged',    this.on_visibility_changed.bind(this));

		obs.on('SourceFilterAdded',             this.on_filter_added.bind(this));
		obs.on('SourceFilterRemoved',           this.on_filter_removed.bind(this));
		obs.on('SourceFiltersReordered',        this.on_filters_reordered.bind(this));
		obs.on('SourceFilterVisibilityChanged', this.on_filter_visibility_changed.bind(this));

		obs.on('SwitchScenes',                  this.on_scene_changed.bind(this));
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
		// stop updating
		this.pause_update();

		// trigger all filter elements to be removed and destroyed
		for (let i = this.filters.length - 1; i >= 0; i--) {
			this.filters[i].pause_update_on_interval();

			// TODO remove element
		}
	}

	change_name (name) {
		if (name) {
			this.source.name       = name;
			this.name              = name;
			this.name_el.innerHTML = name;
			this.slug              = h.get_slug(name);
			this.el.setAttribute('id', 'audio_item_' + this.slug);
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
		this.el.classList.toggle('active',   this.active);
		this.el.classList.toggle('muted',    this.muted);
		this.el.classList.toggle('visible',  this.visible && (this.in_scene || this.sceneless));
		this.el.classList.toggle('in-scene', this.in_scene || this.sceneless);

		// volume
		// NOT USED YET this.vol_max_el.innerHTML = (h.round(h.mul_to_decibel(this.volume_max), 1) + ' dB').replace('Infinity','∞');
		this.vol_el.innerHTML     = (h.round(h.mul_to_decibel(this.volume),     1) + ' dB').replace('Infinity','∞');
		this.btn_mute.classList.toggle('volume-low',  this.volume  < 0.33);
		this.btn_mute.classList.toggle('volume-mid',  (this.volume >=0.33 && this.volume < 0.66));
		this.btn_mute.classList.toggle('volume-high', this.volume >= 0.66);
		this.fader.set(this.volume);
		// TODO update canvas if data is available

		// buttons
		// this.btn_mute.classList.toggle()
		if (!this.sceneless) {
			this.btn_visibility.toggleAttribute('disabled', !this.in_scene);
		}
		// this.btn_solo.classList.toggle()

		// track buttons

		// adjust timer if necessary?
	}

	pause_update () {
		if (this.interval_timer)
			window.clearInterval(this.interval_timer);
	}

	on_scene_changed (e) {
		// check if this SourceItem is in the current scene
		this.in_scene = false;

		for (var i = 0; i < e.sources.length; i++) {
			if (e.sources[i].name.toLowerCase() == this.name.toLowerCase()) {
				this.in_scene = true;

				this.get_visibility();
				break;
			}
		}

		if (!this.in_scene)
			this.update_state();
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
		// by default, assume false. in case of error, it remains false
		let visible = false;

		if (this.in_scene) {
			// omitted: 'scene-name': scene, 
			let response = await obs.sendCommand('GetSceneItemProperties', {'item': this.name});

			if (response && response.status == 'ok') {
				visible = response['visible'];
			}
		}

		this.visible = visible;

		this.update_visibility_state();
	}

	set_visibility (state) {
		// omitted: 'scene-name': scene, 
		obs.sendCommand('SetSceneItemRender', {'source': this.name, 'render': state});
	}

	on_visibility_changed (e) {
		if (e['item-name'] == this.name) {
			this.visible = e['item-visible'];

			this.update_visibility_state();
		}
	}

	update_visibility_state () {
		// also get active state, or just trigger update directly
		if (this.visible)
			this.get_active();
		else
			this.update_state();
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

	on_tracks_changed (e) {
		if (e.sourceName == this.name) {
			for (let i = 0; i < e.mixers.length; i++) {
				this.tracks[i].classList.toggle('enabled', e.mixers[i].enabled);
			}
		}
	}

	on_fader_change (e) {
		this.volume           = this.fader.value;
		// immediate feedback
		this.vol_el.innerHTML = (h.round(h.mul_to_decibel(this.volume), 1) + ' dB').replace('Infinity','∞');
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

			f.pause_update_on_interval();
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
		//SourceFiltersReordered -> filters (Array in correct order)
		if (e.sourceName == this.name) {
			// first, match order of e.filters
			for (let i = 0; i < e.filters.length; i++) {
				// update again after potential changes
				let old_index = this.filters.map(x => x.name).indexOf(e.filters[i].name);

				// splice (remove) element from array at old_index, getting element in return, and insert that in new position i
				this.filters.splice(i, 0, this.filters.splice(old_index, 1)[0]);
			}
				
			// second, move elements into place by moving them towards the end, one by one in order
			for (var i = 0; i < this.filters.length; i++) {
				this.filters_list_el.append( this.filters[i].get_element() );
			}
		}
	}

	on_filter_visibility_changed (e) {
		//SourceFilterVisibilityChanged -> sourceName, filterName, filterEnabled
		if (e.sourceName == this.name) {
			let f = this.filters.find(x => x.name == e.filterName);
			f.on_visibility_changed(e);
		}
	}
}