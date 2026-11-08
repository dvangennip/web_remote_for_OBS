/**
 * Canvas VU meter for obs-websocket v5.
 *
 * Fed from the InputVolumeMeters event: inputLevelsMul is
 *   [[magnitude, peak, inputPeak], ...]  one triple per channel
 * with every value a linear multiplier (0..1, can exceed 1).
 *
 * The bar shows the loudest channel; the thin line is the peak hold,
 * taken from the "peak" slot so it does not depend on our own sampling.
 */

const MIN_DB       = -60;   // bottom of the scale; also the "-inf" floor
const PEAK_HOLD_MS = 1200;
const FLOOR        = 1e-7;  // below this a multiplier is silence

export class VUMeter {
	constructor (canvas, min_db = MIN_DB, peak_hold_ms = PEAK_HOLD_MS) {
		this.canvas       = canvas;
		this.min_db       = min_db;
		this.peak_hold_ms = peak_hold_ms;

		this.level     = 0;   // smoothed bar position, 0..1
		this.hold      = 0;   // peak-hold position, 0..1
		this.peak_at   = 0;   // when hold was last raised
		this.width     = 0;
		this.height    = 0;
		this.dpr       = 1;
		this.last_key  = '';

		if (canvas && canvas.getContext)
			this.ctx = canvas.getContext('2d');
	}

	/** linear multiplier -> dB, -Infinity for silence */
	static mul_to_db (mul) {
		return mul > FLOOR ? 20 * Math.log10(mul) : -Infinity;
	}

	/** linear multiplier -> 0..1 position on the scale */
	to_unit (mul) {
		const db = VUMeter.mul_to_db(mul);
		if (!Number.isFinite(db))
			return 0;
		const clamped = Math.min(Math.max(db, this.min_db), 0);
		return (clamped - this.min_db) / -this.min_db;
	}

	/** Feed one inputLevelsMul array. Cheap: no drawing here. */
	set (levels) {
		if (!Array.isArray(levels))
			return;

		let mag = 0
		let peak = 0;

		for (let i = 0; i < levels.length; i++) {
			const channel = levels[i];
			if (!Array.isArray(channel))
				continue;
			if (channel[0] > mag)  mag  = channel[0];
			if (channel[1] > peak) peak = channel[1];
		}

		const target      = this.to_unit(mag);
		const peak_target = this.to_unit(peak);

		// fast attack, slow release, so 20 Hz samples read as movement
		this.level = target > this.level ? target : (this.level * 0.7) + (target * 0.3);

		const now = (typeof performance !== 'undefined') ? performance.now() : Date.now();

		if (peak_target >= this.hold) {
			this.hold    = peak_target;
			this.peak_at = now;
		} else if (now - this.peak_at > this.peak_hold_ms) {
			this.hold = Math.max(peak_target, this.hold - 0.015);
		}
	}

	/** Current bar/peak as dB, for a text readout. */
	peak_db () {
		if (this.hold <= 0)
			return -Infinity;
		return this.min_db + (this.hold * -this.min_db);
	}

	reset_peak () {
		this.hold     = 0;
		this.peak_at  = 0;
		this.last_key = '';
	}

	/** Repaint. Safe to call every animation frame; skips identical frames. */
	draw () {
		if (!this.ctx)
			return;

		const canvas = this.canvas;
		const width  = canvas.clientWidth  || 60;
		const height = canvas.clientHeight || 150;
		const dpr    = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;

		if (width !== this.width || height !== this.height || dpr !== this.dpr) {
			this.width  = width;
			this.height = height;
			this.dpr    = dpr;
			canvas.width  = Math.round(width  * dpr);
			canvas.height = Math.round(height * dpr);
			this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
			this.last_key = '';
		}

		const bar_h  = Math.round(this.height * this.level);
		const peak_y = Math.round(this.height * (1 - this.hold));
		const key    = bar_h + ':' + peak_y;

		if (key === this.last_key)
			return;
		this.last_key = key;

		const ctx = this.ctx;
		ctx.clearRect(0, 0, this.width, this.height);

		if (bar_h > 0) {
			ctx.fillStyle = this.level > 0.9 ? '#fd3b00'
			              : this.level > 0.75 ? '#eada56'
			              : '#2f9e5f';
			ctx.fillRect(0, this.height - bar_h, this.width, bar_h);
		}

		if (this.hold > 0 && peak_y < this.height) {
			ctx.fillStyle = this.hold > 0.9 ? '#fd3b00' : '#eada56';
			ctx.fillRect(0, peak_y, this.width, 2);
		}
	}
}
