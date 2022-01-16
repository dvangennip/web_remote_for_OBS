import * as h from './helper.js';

export class Slider {
	constructor (element, min = 0, max = 1, step = .001, unit = '', label = '', slider_type = 'slider', is_horizontal = true) {
		this.slider_type   = slider_type;  // allowed values: 'slider' | 'fader' | 'knob'
		this.el            = element;
		this.value         = 0;
		this.value_db      = 0;
		this.value_scaled  = 0;
		this.min           = min;
		this.max           = max;
		this.step          = step;
		this.unit          = unit;
		this.label         = label;
		this.is_horizontal = is_horizontal;
		this.active        = false;

		if (typeof this.el == 'string') {
			this.el = document.getElementById(this.el);

			if (!this.el) {
				this.el = h.NewElement(this.slider_type, {
					'id'          : element,
					'data-setting': this.label,
					'data-label'  : this.label
				});
			}
		}
		
		this.inner_el = h.NewElement('div', {
			'className': this.slider_type + '-inner'
		});

		this.el.appendChild(this.inner_el);

		this.set(this.value, false);

		this.el.addEventListener('mousedown',   this.on_down.bind(this));
		this.el.addEventListener('touchstart',  this.on_down.bind(this));
		window.addEventListener( 'mousemove',   this.on_move.bind(this));
		window.addEventListener( 'touchmove',   this.on_move.bind(this));
		window.addEventListener( 'mouseup',     this.on_up.bind(this));
		window.addEventListener( 'touchend',    this.on_up.bind(this));
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

			let value = this.value;

			if (this.is_horizontal) {
				// ensure we capture either mouse.x or touch.x value
				let x = e.x;
				if (!x && e.touches && e.touches[0]) {
					x = e.touches[0].clientX;
				}

				let loc_x = x - this.el.offsetLeft;
				let pct_x = Math.min(Math.max(loc_x / this.el.clientWidth, 0), 1);

				value = h.round(pct_x, 3);
			} else {
				// vertical
				let y = e.layerY;
				if (!y && e.touches && e.touches[0]) {
					y = e.touches[0].layerY;
				}

				let loc_y = y - this.el.offsetTop;
				let pct_y = Math.min(Math.max(1 - (loc_y / this.el.clientHeight), 0), 1);

				value = h.round(pct_y,2);
			}

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

	set (value, is_scaled = true, set_styles = true) {
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

		this.value_db = h.round( h.mul_to_decibel(this.value), 2);
		
		// set styles
		if (set_styles) {
			if (this.is_horizontal) {
				this.inner_el.style.width = this.value * 100 + '%';
			} else {
				this.inner_el.style.height = this.value * 100 + '%';
			}
		}
		
		//set attributes
		this.el.setAttribute('value',             this.value);
		this.el.setAttribute('data-db',           this.value_db);
		this.el.setAttribute('data-value-scaled', this.value_scaled);
		this.el.setAttribute('data-value-unit',   this.value_scaled + ' ' + this.unit);
	}
}

export class Fader extends Slider {
	constructor (element, min, max, step, unit, label) {
		super(element, min, max, step, unit, label, 'fader', false);
	}
}

export class Knob extends Slider {
	constructor (element, min, max, step, unit, label) {
		super(element, min, max, step, unit, label, 'knob', false);

		// knob-specific adjustments below

		if (this.label.length > 0)
			this.el.classList.add('has-label');

		// inner-el is dial element
		this.inner_el.classList.add('knob-dial');

		this.dial_inner_el = h.NewElement('div', {
			'className': 'knob-dial-inner'
		});

		this.inner_el.appendChild(this.dial_inner_el);

		this.set(this.value, false);

		// remove existing listeners
		this.el.removeEventListener(  'mousedown',   this.on_down.bind(this));
		this.el.removeEventListener(  'touchstart',  this.on_down.bind(this));
		// add new ones
		this.inner_el.addEventListener('mousedown',   this.on_down.bind(this));
		this.inner_el.addEventListener('touchdown',   this.on_down.bind(this));
	}

	on_down (e) {
		super.on_down(e);

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

	set (value, is_scaled = true) {
		super.set(value, is_scaled, false);

		let angle = ((this.value-0.5) * 1.5 * Math.PI);
		this.inner_el.style.transform       = 'rotate('+      angle +'rad)';

		if (this.dial_inner_el)
			this.dial_inner_el.style.transform = 'rotate('+ -1 * angle +'rad)';

		let a = (this.value * (319-46)) + 46; // [46-319]
		this.el.style.background = 'conic-gradient(from 3.1416rad, rgba(0,0,0,0) 44deg, #148 44deg, #3ad '+a+'deg, rgba(0,0,0,0) '+(a+2)+'deg)';

		// set knob-specific attributes
		if (this.dial_inner_el) {
			this.dial_inner_el.setAttribute('value',             this.value);
			this.dial_inner_el.setAttribute('data-value-scaled', this.value_scaled);
		}
	}
}