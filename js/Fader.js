import * as h from './helper.js';

export default class Fader {
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
				this.el = h.NewElement('fader', {
					'id': element
				});
			}
		}

		this.inner_el = h.NewElement('div', {
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

			let value = h.round(pct_y,2);

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

				this.value_scaled = h.round(this.value_scaled, round_factor);
			}
		} else if (value != undefined && is_scaled) {
			this.value        = (value - this.min) / (this.max - this.min);
			this.value_scaled = value;
		}

		this.value_db = h.round(h.mul_to_decibel(this.value),2);
		
		// set styles
		this.inner_el.style.height = this.value * 100 + '%';
		
		//set attributes
		this.el.setAttribute('value',             this.value);
		this.el.setAttribute('data-db',           this.value_db);
		this.el.setAttribute('data-value-scaled', this.value_scaled);
		this.el.setAttribute('data-value-unit',   this.value_scaled + ' ' + this.unit);
	}
}