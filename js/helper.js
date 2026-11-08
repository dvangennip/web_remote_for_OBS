/**
 * Extends Element to ease creating new elements (based on EnyoJS v1)
 */
export function NewElement (_nodeType, _attributes) { // my own concoction
	let nodeType = (_nodeType !== undefined && typeof _nodeType === 'string') ? _nodeType : 'div',
		attr = (_attributes !== undefined && typeof _attributes === 'object') ? _attributes : {},
		el = document.createElement(nodeType),
		key, skey;
	for (key in attr) {
		if (key === 'innerHTML')
			el.innerHTML += attr[key];
		else if (key === 'className')
			el.className = attr[key];
		else if (key === 'events' && typeof attr[key] === 'object')
			for (skey in attr[key])
				el.addEventListener(skey, attr[key][skey], false);
		else if (key === 'elements') // best to list these first
			for (let index in attr[key])
				el.appendChild(attr[key][index]);
		else el.setAttribute(key, attr[key]);
	}
	return el;
}

export function get_slug (inString) {
	// using replaceAll is apparently too new (Safari 13+, Chrome 85+), so use replace with regex //global modifier
	return inString.toLowerCase().replace(/\s/g, '_').replace(/\+/g,'_').replace(/\//g,'_');
}

export function mul_to_decibel (inMul) {
	// assumption mul is in range [0,1], dB [-94.5,0]
	return ((0.212 * Math.log10(inMul) + 1) * 94.5) - 94.5;

	// from obs-ws
	// volDb = round(20 * math.log10(volMul[1])) + 100 if volMul[1] and volMul[2] != 0 else 0
	// from OBS
	// return (mul == 0.0f) ? -INFINITY : (20.0f * log10f(mul));
}

export function round (value, precision) {
	let multiplier = Math.pow(10, precision || 0);
	return Math.round(value * multiplier) / multiplier;
}

/**
 * OBS colours are 0xAABBGGRR: red in the low byte, then green, then blue.
 * These filters ignore the alpha byte, but OBS's own picker stores 0xFF there,
 * so a caller holding the stored value passes it as currentValue and the byte
 * is preserved instead of being churned to 0x00 on every edit.
 */
export function rgbToObsColor (inHex, currentValue = null) {
	let rgb   = inHex.replace('#', ''),
		alpha = (currentValue === null) ? 0 : (currentValue >>> 24);

	return (
		(alpha                              << 24) |
		(parseInt(rgb.substring(4, 6), 16) << 16) |  // b
		(parseInt(rgb.substring(2, 4), 16) <<  8) |  // g
		 parseInt(rgb.substring(0, 2), 16)           // r
	) >>> 0;  // >>> 0 keeps it a non-negative 32-bit integer
}

export function obsColorToRgb (inInt) {
	let value = inInt >>> 0,
		byte  = (n) => ('0' + n.toString(16)).slice(-2);

	return '#' + byte(value & 0xFF) + byte((value >>> 8) & 0xFF) + byte((value >>> 16) & 0xFF);
}