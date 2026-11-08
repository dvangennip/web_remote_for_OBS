/**
 * Live protocol check against an obs-websocket v5 server.
 *
 *	OBS_URL=ws://localhost:4455 OBS_PASSWORD=... node test/protocol.mjs
 *
 * Read-only: connect, read versions and available requests, then leave.
 */

import { OBSWebSocket } from 'obs-websocket-js';

const url      = process.env.OBS_URL || 'ws://localhost:4455';
const password = process.env.OBS_PASSWORD;

if (!password) {
	console.error('OBS_PASSWORD is not set. Export the obs-websocket password, e.g.:');
	console.error('	export OBS_PASSWORD="$(...)"');
	process.exit(1);
}

const TIMEOUT_MS = 20000;
const obs        = new OBSWebSocket();

const watchdog = setTimeout(() => {
	console.error(`FAILED: no complete answer from ${url} within ${TIMEOUT_MS / 1000} seconds.`);
	process.exit(1);
}, TIMEOUT_MS);

try {
	const identified = await obs.connect(url, password, { eventSubscriptions: 0 });

	console.log(`connected to ${url}`);
	console.log(`obsWebSocketVersion: ${identified.obsWebSocketVersion}`);
	console.log(`negotiatedRpcVersion: ${identified.negotiatedRpcVersion}`);

	const order = [
		{ requestType: 'GetVersion' },
		{ requestType: 'GetSceneList' },
	];
	const [version, scenes] = await obs.callBatch(order);

	for (const [i, result] of [version, scenes].entries()) {
		console.log(`${order[i].requestType} result code: ${result.requestStatus.code} (${result.requestStatus.comment})`);
		if (!result.requestStatus.result) {
			console.error(`FAILED: ${order[i].requestType} was rejected.`);
			process.exit(1);
		}
	}

	const data = version.responseData;
	console.log(`obsVersion: ${data.obsVersion}`);
	console.log(`obsWebSocketVersion: ${data.obsWebSocketVersion}`);
	console.log(`rpcVersion: ${data.rpcVersion}`);
	console.log(`availableRequests: ${data.availableRequests.length} total, first 20:`);
	console.log(data.availableRequests.slice(0, 20).join('\n'));

	const sceneCount = scenes.responseData.scenes ? scenes.responseData.scenes.length : 0;
	console.log(`sceneCount: ${sceneCount}`);

	process.exitCode = 0;
} catch (e) {
	const code = e && typeof e.code === 'number' ? ` (code ${e.code})` : '';
	console.error(`FAILED${code}: ${e && e.message ? e.message : e}`);
	process.exitCode = 1;
} finally {
	clearTimeout(watchdog);
	try {
		await obs.disconnect();
	} catch (e) {
		// already gone
	}
}
