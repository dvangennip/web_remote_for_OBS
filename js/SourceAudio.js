import * as h from './helper.js';
import SourceFilter from './SourceFilter.js';
import { Fader } from './Sliders.js';
import { VUMeter } from './VUMeter.js';
import { sceneItemId } from './ObsResolve.js';

const VOLUME_DEBOUNCE_MS = 80;

/**
 * Meter bus. One InputVolumeMeters subscription for the whole page, one DOM write
 * per animation frame for every source that got a new sample. The event arrives
 * about 20 times a second per active input; repainting on arrival would be 20x
 * the work with no visible benefit.
 */
const meter_sources = new Map(); // inputName -> SourceAudio
let   meter_frame   = null;
let   meter_bound   = false;

function meter_subscribe () {
	if (meter_bound)
		return;
	meter_bound = true;
	wrc.on('InputVolumeMeters', on_meter_data);
}

function on_meter_data (e) {
	const inputs = (e && e.inputs) || [];

	for (let i = 0; i < inputs.length; i++) {
		const source = meter_sources.get(inputs[i].inputName);
		if (source)
			source.meter_sample(inputs[i].inputLevelsMul);
	}

	if (meter_frame === null && typeof window !== 'undefined')
		meter_frame = window.requestAnimationFrame(flush_meters);
}

function flush_meters () {
	meter_frame = null;

	for (const source of meter_sources.values())
		source.draw_meter();
}

function meter_attach (source) {
	meter_sources.set(source.name, source);
	meter_subscribe();
}

function meter_detach (source) {
	if (meter_sources.get(source.name) === source)
		meter_sources.delete(source.name);
}

export default class SourceAudio {
	constructor (inSource, is_sceneless = false) {
		this.source        = inSource;
		this.name          = inSource.name || inSource.inputName;
		this.slug          = h.get_slug(this.name);
		this.typeId        = inSource.typeId || inSource.inputKind || '';
		this.volume        = 0;
		this.volume_db     = 0;
		this.volume_max    = 0;
		this.muted         = true;
		this.active        = false;
		this.visible       = false;
		this.tracks        = [];
		this.track_map     = {};
		this.filters       = [];
		this.last_update   = 9999999; // improbably high number
		this.in_scene      = false;
		this.sceneless     = is_sceneless;
		this.scene_name    = null;
		this.scene_item_id = null;
		this.volume_timer  = null;
		this.levels        = null;
		this.levels_dirty  = false;
		this.levels_hot    = false;
		this.video_active  = false;
		this.last_peak_db  = null;
		this._handlers     = [];

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

		this.btn_mute = h.NewElement('button', {
			'className': 'audio-button mute',
			'title'    : 'Toggle mute',
			'innerHTML': '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-on"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-off"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><line x1="23" y1="9" x2="17" y2="15"></line><line x1="17" y1="9" x2="23" y2="15"></line></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-1"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg><svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="volume-2"><polygon points="11 5 6 9 2 9 2 15 6 15 11 19 11 5"></polygon><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07"></path></svg>',
			'events': {
				'click': this.on_mute_btn_click.bind(this)
			}
		});
		this.btn_solo    = h.NewElement('button', {
			'className': 'audio-button solo',
			'title'    : 'Toggle solo',
			'innerHTML': 'S',
			'events': {
				'click': this.on_solo_btn_click.bind(this)
			}
		});
		this.btn_monitor = h.NewElement('button', {
			'className': 'audio-button',
			'innerHTML': 'X',
			'events': {
				'click': this.on_monitor_btn_click.bind(this)
			}
		});
		this.tracks_el       = h.NewElement('div', {'className': 'audio-tracks'});
		this.filters_list_el = h.NewElement('ul',  {'className': 'filters-list'});

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
					'click': this.on_track_btn_click.bind(this, i)
				}
			});
			this.tracks.push(t);
			this.tracks_el.appendChild(t);
		}

		this.vu = new VUMeter(this.vol_canvas);

		this.vol_max_el.addEventListener('click', () => {
			this.vol_max_el.innerHTML = 'dB';
			this.last_peak_db = null;
			if (this.vu)
				this.vu.reset_peak();
		});

		// set initial state
		this.update_state();

		this.get_volume();
		this.get_mute();
		if (!this.sceneless) {
			this.get_visibility();
		}
		this.get_active();
		this.get_tracks();
		this.get_source_filters();

		this.bind_events();
		meter_attach(this);

		// repaint on a 3 s cadence; events keep the row current in between.
		// Without this timer update_state() ran on every tick, for every row.
		this.interval_timer = window.setInterval(this.update_state.bind(this), 3000);
	}

	/** Subscribe to one v5 protocol event; remembered so destroy() can unhook it. */
	on_evt (event_name, handler) {
		const bound = handler.bind(this);
		wrc.on(event_name, bound);
		this._handlers.push([event_name, bound]);
	}

	bind_events () {
		this.on_evt('InputVolumeChanged',           this.on_volume_changed);
		this.on_evt('InputMuteStateChanged',        this.on_mute_state_changed);
		this.on_evt('InputAudioTracksChanged',      this.on_tracks_changed);
		this.on_evt('InputActiveStateChanged',      this.on_active_changed);
		this.on_evt('InputNameChanged',             this.on_input_name_changed);
		this.on_evt('SourceFilterCreated',          this.on_filter_created);
		this.on_evt('SourceFilterRemoved',          this.on_filter_removed);
		this.on_evt('SourceFilterListReindexed',    this.on_filter_reindexed);
		this.on_evt('SourceFilterSettingsChanged',  this.on_filter_settings_changed);
		this.on_evt('SourceFilterEnableStateChanged', this.on_filter_enable_state_changed);
		this.on_evt('SceneItemEnableStateChanged',  this.on_scene_item_enable_state_changed);
	}

	get_element () {
		return this.el;
	}

	update_state () {
		// main element
		this.el.classList.toggle('active',   this.active);
		this.el.classList.toggle('muted',    this.muted);
		this.el.classList.toggle('visible',  this.visible && (this.in_scene || this.sceneless));
		this.el.classList.toggle('in-scene', this.in_scene || this.sceneless);

		// volume
		this.vol_el.innerHTML     = (h.round(h.mul_to_decibel(this.volume), 1) + ' dB').replace('Infinity','∞');
		this.btn_mute.classList.toggle('volume-low',  this.volume  < 0.33);
		this.btn_mute.classList.toggle('volume-mid',  (this.volume >=0.33 && this.volume < 0.66));
		this.btn_mute.classList.toggle('volume-high', this.volume >= 0.66);

		// never fight the user's finger: only sync the fader when it is idle
		if (!this.fader.active)
			this.fader.set(this.volume);

		// buttons
		if (!this.sceneless) {
			this.btn_visibility.toggleAttribute('disabled', !this.in_scene);
		}
	}

	pause_update () {
		if (this.interval_timer)
			window.clearInterval(this.interval_timer);
	}

	/** WebRemote calls this before removing the row element. */
	on_source_destroyed () {
		this.destroy();
	}

	/** Unhook every event and the meter bus. The row can be removed safely after this. */
	destroy () {
		this.pause_update();
		this.interval_timer = null;

		meter_detach(this);

		// Filters are standalone objects, not children of this row: they hold their
		// own DOM and settings state, so drop the references or the whole graph of a
		// removed input stays alive.
		this.filters = [];

		for (let i = 0; i < this._handlers.length; i++)
			wrc.off(this._handlers[i][0], this._handlers[i][1]);
		this._handlers = [];

		if (this.volume_timer) {
			window.clearTimeout(this.volume_timer);
			this.volume_timer = null;
		}
	}

	// ---------------------------------------------------------------- meters

	/** Called from the meter bus with one inputLevelsMul array. */
	meter_sample (levels) {
		this.levels       = levels;
		this.levels_dirty = true;
	}

	/** Called at most once per animation frame. */
	draw_meter () {
		if (!this.el.isConnected) {
			// row was removed without destroy(); stop tracking it
			meter_detach(this);
			return;
		}

		if (!this.levels_dirty)
			return;
		this.levels_dirty = false;

		this.vu.set(this.levels);
		this.vu.draw();

		// An audio-only input always reports videoActive:false, so the "live"
		// highlight also follows the meter. Both are folded in once per frame.
		this.levels_hot = this.any_level(this.levels);
		this.refresh_active();

		const peak_db = this.vu.peak_db();
		const shown   = Number.isFinite(peak_db) ? h.round(peak_db, 1) : -Infinity;

		if (shown !== this.last_peak_db) {
			this.last_peak_db        = shown;
			this.vol_max_el.innerHTML = (shown === -Infinity ? '-∞' : shown.toFixed(1)) + ' dB';
		}
	}

	// ---------------------------------------------------------------- volume

	async get_volume () {
		const response = await wrc.safeCall('GetInputVolume', {'inputName': this.name});

		if (response) {
			this.volume    = response.inputVolumeMul;
			this.volume_db = response.inputVolumeDb;

			this.update_state();
		}
	}

	/** Debounced: a fader drag fires dozens of change events per second. */
	set_volume () {
		if (this.volume_timer)
			window.clearTimeout(this.volume_timer);

		this.volume_timer = window.setTimeout(() => {
			this.volume_timer = null;
			wrc.safeCall('SetInputVolume', {'inputName': this.name, 'inputVolumeMul': this.volume});
		}, VOLUME_DEBOUNCE_MS);
	}

	on_fader_change (e) {
		this.volume = this.fader.value;

		// immediate feedback
		this.vol_el.innerHTML = (h.round(h.mul_to_decibel(this.volume), 1) + ' dB').replace('Infinity','∞');

		this.set_volume();
	}

	on_volume_changed (e) {
		if (e.inputName !== this.name)
			return;

		this.volume    = e.inputVolumeMul;
		this.volume_db = e.inputVolumeDb;

		this.update_state();
	}

	// ------------------------------------------------------------------ mute

	async get_mute () {
		const response = await wrc.safeCall('GetInputMute', {'inputName': this.name});

		if (response) {
			this.muted = response.inputMuted;
			this.update_state();
		}
	}

	on_mute_btn_click (e) {
		wrc.safeCall('ToggleInputMute', {'inputName': this.name});
	}

	on_mute_state_changed (e) {
		if (e.inputName !== this.name)
			return;

		this.muted = e.inputMuted;
		this.update_state();
	}

	// ---------------------------------------------------------------- tracks

	apply_tracks (map) {
		this.track_map = Object.assign({}, map || {});

		for (let i = 1; i < 7; i++)
			this.tracks[i-1].classList.toggle('enabled', this.track_map[String(i)] === true);
	}

	async get_tracks () {
		const response = await wrc.safeCall('GetInputAudioTracks', {'inputName': this.name});

		if (response)
			this.apply_tracks(response.inputAudioTracks);
	}

	async set_track (track_index, state) {
		const map = Object.assign({}, this.track_map);
		map[String(track_index)] = state;

		// SetInputAudioTracks declares request fields only, so there is nothing to
		// read back: paint the map we just sent instead of blanking the row until
		// InputAudioTracksChanged arrives.
		await wrc.safeCall('SetInputAudioTracks', {
			'inputName'       : this.name,
			'inputAudioTracks': map
		});

		this.apply_tracks(map);
	}

	on_track_btn_click (track_index, e) {
		const current = this.track_map[String(track_index)] === true;
		this.set_track(track_index, !current);
	}

	on_tracks_changed (e) {
		if (e.inputName === this.name)
			this.apply_tracks(e.inputAudioTracks);
	}

	// --------------------------------------------------------------- filters

	async get_source_filters () {
		const response = await wrc.safeCall('GetSourceFilterList', {'sourceName': this.name});

		if (response && Array.isArray(response.filters))
			for (let i = 0; i < response.filters.length; i++)
				this.add_filter(response.filters[i]);
	}

	add_filter (filter_data) {
		const filter_name = filter_data.filterName || filter_data.name;
		let current_filters = this.filters.map(x => x.name);

		if (!current_filters.includes(filter_name)) {
			let filter_instance = new SourceFilter(this.source, filter_data);

			this.filters.push(filter_instance);
			this.filters_list_el.appendChild( filter_instance.get_element() );
		}
	}

	remove_filter (filter_data) {
		const filter_name = filter_data.filterName || filter_data.name;
		let current_filters = this.filters.map(x => x.name);

		if (current_filters.includes(filter_name)) {
			let ix = current_filters.indexOf(filter_name);
			let f  = this.filters[ix];

			this.filters_list_el.removeChild( f.get_element() );
			this.filters.splice(ix,1);
		}
	}

	on_filter_created (e) {
		if (e.sourceName === this.name)
			this.get_source_filters();
	}

	on_filter_removed (e) {
		if (e.sourceName === this.name)
			this.remove_filter(e);
	}

	on_filter_reindexed (e) {
		if (e.sourceName === this.name)
			this.get_source_filters();
	}

	on_filter_settings_changed (e) {
		if (e.sourceName !== this.name)
			return;

		for (let i = 0; i < this.filters.length; i++) {
			const f = this.filters[i];

			if (f.name === e.filterName)
				f.apply_settings(e.filterSettings || {});
		}
	}

	on_filter_enable_state_changed (e) {
		if (e.sourceName !== this.name)
			return;

		for (let i = 0; i < this.filters.length; i++) {
			const f = this.filters[i];

			// SourceFilter has no set_enabled(); mirror its own on_visibility_changed.
			if (f.name === e.filterName) {
				f.enabled = e.filterEnabled;
				f.el.classList.toggle('disabled', !f.enabled);
			}
		}
	}

	// ------------------------------------------------------------ visibility

	async current_scene () {
		if (this.scene_name)
			return this.scene_name;

		const response = await wrc.safeCall('GetCurrentProgramScene');
		return response ? response.currentProgramSceneName : null;
	}

	async resolve_scene_item () {
		const scene = await this.current_scene();
		if (!scene)
			return null;

		this.scene_name = scene;
		this.scene_item_id = await sceneItemId(wrc, scene, this.name);

		return this.scene_item_id;
	}

	async get_visibility () {
		const id = await this.resolve_scene_item();

		if (id === null || id === undefined) {
			this.in_scene      = false;
			this.visible       = false;
			this.scene_item_id = null;
			this.update_visibility_state();
			return;
		}

		const response = await wrc.safeCall('GetSceneItemEnabled', {
			'sceneName'  : this.scene_name,
			'sceneItemId': id
		});

		if (response) {
			this.in_scene = true;
			this.visible  = response.sceneItemEnabled;
			this.update_visibility_state();
		}
	}

	async set_visibility (state) {
		const id = await this.resolve_scene_item();
		if (id === null || id === undefined)
			return;

		const response = await wrc.safeCall('SetSceneItemEnabled', {
			'sceneName'      : this.scene_name,
			'sceneItemId'    : id,
			'sceneItemEnabled': state
		});

		if (response) {
			this.visible = state;
			this.update_state();
		}
	}

	on_visibility_btn_click (e) {
		this.set_visibility(!this.visible);
	}

	on_scene_item_enable_state_changed (e) {
		if (e.sceneName !== this.scene_name || e.sceneItemId !== this.scene_item_id)
			return;

		this.visible = e.sceneItemEnabled;
		this.update_state();
	}

	update_visibility_state () {
		if (this.visible)
			this.get_active();
		else
			this.update_state();
	}

	/**
	 * The program scene changed. v5 sends only the scene name (no v4 sources
	 * array), so re-resolve this input's item inside the new scene. The row
	 * follows the program scene; preview only affects it once it goes live.
	 */
	on_scene_changed (scene_name) {
		this.scene_name    = scene_name || null;
		this.scene_item_id = null;
		this.in_scene      = false;
		this.visible       = false;

		if (!this.scene_name || this.sceneless) {
			this.update_state();
			return;
		}

		this.get_visibility();
	}

	// ------------------------------------------------------------- liveness

	/**
	 * obs-websocket 5 has no GetAudioActive request; the InputActiveStateChanged
	 * event and the meter feed are the source of truth now. Kept as a cheap
	 * refresh because the scene code calls it after a program scene change.
	 */
	async get_active () {
		this.update_state();
	}

	on_active_changed (e) {
		if (e.inputName !== this.name)
			return;

		this.video_active = e.videoActive === true;
		this.refresh_active();
	}

	any_level (levels) {
		if (!Array.isArray(levels))
			return false;

		for (let i = 0; i < levels.length; i++) {
			const channel = levels[i];
			if (Array.isArray(channel) && channel[0] > 0)
				return true;
		}

		return false;
	}

	/** Live = video-active per the event, or audible per the meter. DOM write only on change. */
	refresh_active () {
		const next = this.video_active || this.levels_hot;

		if (next !== this.active) {
			this.active = next;
			this.el.classList.toggle('active', next);
		}
	}

	on_input_name_changed (e) {
		if (e.oldInputName !== this.name)
			return;

		this.change_name(e.inputName);
	}

	change_name (new_name) {
		meter_detach(this);

		this.source.name = new_name;
		this.name        = new_name;
		this.slug        = h.get_slug(new_name);
		this.el.id       = 'audio_item_' + this.slug;
		this.name_el.innerHTML = new_name;

		meter_attach(this);
	}

	// ------------------------------------------------------------ not wired

	on_solo_btn_click (e) {
		// Solo is not exposed by obs-websocket v5; button is not in the DOM.
	}

	on_monitor_btn_click (e) {
		// Audio monitoring is not implemented: SetInputAudioMonitorType is
		// deprecated in OBS 33 (monitoring_type became a boolean). Button is not
		// in the DOM; see the README note rather than calling the deprecated request.
	}
}
