/** TODO
 * canvas width is inflexible; would setting width flexibly still work?
 * perhaps use a historical graph with points/lines rather than just actual?
 * convert to decibels? (requires the mul_to_db function to work properly and be generalised)
 * make this into a proper modern Class (and remove from old code)
 */
export class VUMeter {
	constructor (canvas) {
		// see: https://codepen.io/travisholliday/pen/gyaJk

		this.canvas = canvas;

		var canvasContext = canvas.getContext('2d');

		var max_width  = canvas.offsetWidth;

		canvasContext.clearRect(0, 0, max_width, 37);
		canvasContext.fillStyle = "#BadA55";
		if (avg_scaled > 0.7) {
			canvasContext.fillStyle = "#eada56";
		} else if (avg_scaled > 0.85) {
			canvasContext.fillStyle = "#fd3b00";
		}
		canvasContext.fillRect(0, 0, avg_scaled * max_width, 37);
	}
}