import * as h from './helper.js';

export default class SourceScene {
	constructor (index, name) {
		this.index       = index;
		this.name        = name;
		this.last_update = 9999999; // improbably high number
		this.is_program  = wr.scene_program === name;
		this.is_preview  = wr.scene_preview === name;

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
		this.el.setAttribute('id', 'li_scene_' + h.get_slug(name) );
	}

	async set_scene (forceCurrentScene) {
		let cmd = (wr.studio_mode) ? 'SetPreviewScene' : 'SetCurrentScene';
		
		if (forceCurrentScene) {
			cmd = 'SetCurrentScene';
		}

		await wrc.sendCommand(cmd, {'scene-name': this.name});
	}

	async set_screenshot () {
		let img_width  = (this.el.offsetWidth > 0) ? this.el.offsetWidth : 250;
		let img_height = (1 / wr.aspect_ratio) * img_width;

		let response = await wrc.sendCommand('TakeSourceScreenshot', {
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