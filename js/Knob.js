import * as h from './helper.js';

export default class Knob {
	constructor (element, min, max, step, unit, label) {
		this.el           = element;
		this.value        = 0;
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
				this.el = h.NewElement('knob', {
					'id'        : element,
					'className' : this.label.length > 0 ? 'has-label' : '',
					'data-label': label
				});
			}
		}

		this.dial_el = h.NewElement('div', {
			'className': 'knob-dial'
		});

		this.dial_inner_el = h.NewElement('div', {
			'className': 'knob-dial-inner'
		});

		this.dial_el.appendChild(this.dial_inner_el);
		this.el.appendChild(this.dial_el);

		this.set(this.volume);

		this.dial_el.addEventListener('mousedown',   this.on_down.bind(this));
		this.dial_el.addEventListener('touchdown',   this.on_down.bind(this));
		window.addEventListener(      'mousemove',   this.on_move.bind(this));
		window.addEventListener(      'touchmove',   this.on_move.bind(this));
		window.addEventListener(      'mouseup',     this.on_up.bind(this));
		window.addEventListener(      'touchup',     this.on_up.bind(this));
		window.addEventListener(      'touchcancel', this.on_up.bind(this));
	}

	get_element () {
		return this.el;
	}

	on_down (e) {
		e.preventDefault();
		this.active = true;
		this.el.classList.add('control-active');

		// remember the original values for future reference
		let x = e.x;
		if (!x && e.touches && e.touches[0]) {
			x = e.touches[0].clientX;
		}

		let y = e.y;
		if (!y && e.touches && e.touches[0]) {
			y = e.touches[0].clientY;
		}

		this.orig_x     = x;
		this.orig_y     = y;
		this.orig_value = this.value;
	}

	on_move (e) {
		if (this.active) {
			e.preventDefault();

			// ensure we capture either mouse.x or touch.x value
			let x = e.x;
			if (!x && e.touches && e.touches[0]) {
				x = e.touches[0].clientX;
			}

			let y = e.y;
			if (!y && e.touches && e.touches[0]) {
				y = e.touches[0].clientY;
			}

			let diff_x = x - this.orig_x;
			let diff_y = y - this.orig_y;
			let value  = this.orig_value;
			if (Math.abs(diff_x) > Math.abs(diff_y)) {
				value += diff_x / 150;
			} else {
				value -= diff_y / 150;
			}
			
			// cap
			value = h.round(Math.min(Math.max(value, 0), 1), 2);

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
		// TODO scale with min/max
		evt.value   = this.value_scaled;
		evt.setting = this.label
		evt.valueDb = this.db;

		this.el.dispatchEvent(evt);
	}

	set (value, is_scaled = true) {
		if (value != undefined && !is_scaled) {
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
		
		this.db = h.round(h.mul_to_decibel(this.value),1);

		let angle = ((this.value-0.5) * 1.5 * Math.PI);
		this.dial_el.style.transform       = 'rotate('+      angle +'rad)';
		this.dial_inner_el.style.transform = 'rotate('+ -1 * angle +'rad)';

		let a = (this.value * (319-46)) + 46; // [46-319]
		this.el.style.background = 'conic-gradient(from 3.1416rad, rgba(0,0,0,0) 44deg, #148 44deg, #3ad '+a+'deg, rgba(0,0,0,0) '+(a+2)+'deg)';

		// set attributes
		this.el.setAttribute('value',             this.value);
		this.el.setAttribute('data-value-scaled', this.value_scaled);
		this.el.setAttribute('data-value-unit',   this.value_scaled + ' ' + this.unit);
		this.el.setAttribute('data-db',           this.db);

		this.dial_inner_el.setAttribute('value',             this.value);
		this.dial_inner_el.setAttribute('data-value-scaled', this.value_scaled);
	}
}