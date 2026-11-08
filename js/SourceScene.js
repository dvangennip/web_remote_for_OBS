import * as h from './helper.js';

/**
 * Thumbnails go out as one GetSourceScreenshot batch per refresh tick instead of
 * one round trip per scene: every scene that refreshes inside the coalescing
 * window lands in the same wrc.batch() call.
 */
const THUMB_MAX_WIDTH    = 320; // server scales to this width, aspect kept
const THUMB_QUALITY      = 60;
const THUMB_FLUSH_DELAY  = 100; // ms window used to collect a tick's requests

let shot_queue     = [];
let shot_flush_id  = 0;

function flush_screenshots () {
	shot_flush_id = 0;

	const jobs = shot_queue;
	shot_queue = [];

	if (jobs.length === 0)
		return;

	// disconnected: settle every job so awaiting callers don't hang forever
	if (!window.wrc || !wrc.isConnected) {
		jobs.forEach(function (job) { job.resolve(null); });
		return;
	}

	wrc.batch(jobs.map(function (job) {
		return {
			'requestType': 'GetSourceScreenshot',
			'requestData': {
				'sourceName'             : job.sourceName,
				'imageFormat'            : 'jpg',
				'imageWidth'             : job.width,
				'imageCompressionQuality': THUMB_QUALITY
			}
		};
	})).then(function (results) {
		for (let i = 0; i < jobs.length && i < results.length; i++) {
			jobs[i].resolve((results[i].ok && results[i].data) ? results[i].data.imageData : null);
		}
	}).catch(function () {
		jobs.forEach(function (job) { job.resolve(null); });
	});
}

/**
 * Queue a screenshot request for this source. Resolves with base64 image data
 * (no data: prefix) or null.
 */
function request_screenshot (sourceName, width) {
	return new Promise(function (resolve) {
		shot_queue.push({ 'sourceName': sourceName, 'width': width, 'resolve': resolve });

		if (!shot_flush_id) {
			shot_flush_id = window.setTimeout(flush_screenshots, THUMB_FLUSH_DELAY);
		}
	});
}

export default class SourceScene {
	constructor (index, name) {
		this.index       = index;
		this.name        = name;
		this.last_update = 9999999; // improbably high number
		this.is_program  = wr.scene_program === name;
		this.is_preview  = wr.scene_preview === name;
		this.screenshot  = null;    // last base64 payload, to skip redundant DOM writes
		this.interval_timer = null; // pending screenshot tick, never more than one
		this.paused         = false;

		// create elements
		this.el          = h.NewElement('li', {
			'id'       : 'li_scene_' + h.get_slug(name),
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

		this.div = h.NewElement('div', {
			'innerHTML': this._get_index_string()
		})

		this.label = h.NewElement('label', {
			'innerHTML': name
		});

		this.el.appendChild(this.div);
		this.el.appendChild(this.label);

		// get initial state set up
		this.el.style.aspectRatio = wr.aspect_ratio;
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
		}

		// one tick per tile, always: cancel any pending one before arming a new
		// one, otherwise every program<->preview switch stacks another interval
		window.clearTimeout(this.interval_timer);
		this.interval_timer = null;

		if (!this.paused) {
			this._schedule_shot();
		}
	}

	_schedule_shot () {
		const delay = (this.is_program || this.is_preview) ? 2000 : 10000;

		this.interval_timer = window.setTimeout(function () {
			this.interval_timer = null;

			if (this.paused)
				return;

			this.set_screenshot();
			this._schedule_shot(); // re-arm after the tick, never overlapping it
		}.bind(this), delay);
	}

	pause_update () {
		this.paused = true;
		window.clearTimeout(this.interval_timer);
		this.interval_timer = null;
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
		this.el.setAttribute('id', 'li_scene_' + h.get_slug(name) );
	}

	async set_scene (forceCurrentScene) {
		let request_type = (wr.studio_mode && !forceCurrentScene) ? 'SetCurrentPreviewScene' : 'SetCurrentProgramScene';

		await wrc.safeCall(request_type, {'sceneName': this.name});
	}

	async set_screenshot () {
		let img_width = (this.el.offsetWidth > 0) ? this.el.offsetWidth : 250;

		img_width = Math.min(Math.round(img_width), THUMB_MAX_WIDTH);

		let image_data = await request_screenshot(this.name, img_width);

		if (!image_data)
			return;

		// OBS 33 hands back a data:image/jpg;base64,... string, but the field is
		// documented as bare base64, so accept either shape
		let src = (image_data.indexOf('data:') === 0)
			? image_data
			: 'data:image/jpeg;base64,' + image_data;

		// unchanged bytes: nothing to redraw
		if (src === this.screenshot)
			return;

		this.screenshot = src;

		// apply image but with preload dummy image object as interstage to eliminate 'refresh flickering'

		// create a new Image object as dummy holder to trigger a preload of the image
		let img_dummy = new Image();

		// when preload is complete, apply the image to the element
		img_dummy.onload = function () {
			this.el.style.backgroundImage = 'url("' + src + '")';
		}.bind(this);

		// trigger preload
		img_dummy.src = src;
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
