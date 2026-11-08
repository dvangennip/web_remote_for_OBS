/**
 * Scene item id resolution for obs-websocket v5.
 *
 * v5 addresses scene items by a numeric sceneItemId instead of a source name, so
 * visibility calls need a lookup first. The lookup is cached per scene/source pair
 * and the cache is dropped whenever the server says the mapping may have moved.
 */

const SEPARATOR = '\u0000';
const INVALIDATING_EVENTS = [
	'SceneListChanged',
	'SceneItemCreated',
	'SceneItemRemoved',
	'InputNameChanged',
];

const cache       = new Map();
let subscribed_to = null;

function key (sceneName, sourceName) {
	return sceneName + SEPARATOR + sourceName;
}

function subscribe (wrc) {
	if (subscribed_to === wrc)
		return;

	subscribed_to = wrc;

	for (const eventName of INVALIDATING_EVENTS)
		wrc.on(eventName, () => invalidate());
}

/**
 * Drop cached ids. Without a scene name the whole cache is cleared.
 */
export function invalidate (sceneName) {
	if (sceneName === undefined || sceneName === null) {
		cache.clear();
		return;
	}

	const prefix = sceneName + SEPARATOR;

	for (const cached_key of cache.keys()) {
		if (cached_key.startsWith(prefix))
			cache.delete(cached_key);
	}
}

/**
 * One GetSceneItemId attempt. A 600 means "no such item in this scene" and is the
 * answer this module exists to produce, so it stays silent; anything else is a
 * real failure and keeps its warning.
 */
async function lookup (wrc, sceneName, sourceName) {
	try {
		return await wrc.call('GetSceneItemId', { sceneName, sourceName });
	} catch (e) {
		const code = (e && e.code !== undefined) ? e.code : 'unknown';

		if (code !== 600) {
			const text = (e && e.message) ? e.message : String(e);
			console.warn(`[obs] GetSceneItemId failed with code ${code}: ${text}`);
		}

		return null;
	}
}

/**
 * Resolve a source name inside a scene to its sceneItemId.
 * Returns null when the item does not exist in that scene.
 */
export async function sceneItemId (wrc, sceneName, sourceName) {
	subscribe(wrc);

	const cache_key = key(sceneName, sourceName);

	if (cache.has(cache_key))
		return cache.get(cache_key);

	let data = await lookup(wrc, sceneName, sourceName);

	if (!data) {
		// A stale id after a rename looks exactly like a miss on the first try.
		invalidate(sceneName);
		data = await lookup(wrc, sceneName, sourceName);
	}

	const id = (data && typeof data.sceneItemId === 'number') ? data.sceneItemId : null;

	if (id !== null)
		cache.set(cache_key, id);

	return id;
}
