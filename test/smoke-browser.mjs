/**
 * Real-browser smoke test for the web remote.
 *
 *	OBS_PASSWORD=... node test/smoke-browser.mjs
 *
 * Serves the repo over HTTP, seeds localStorage in headless Chrome, loads the app and
 * asserts on the rendered DOM.
 *
 * Read-only unless SMOKE_SCENE is set. With SMOKE_SCENE the run reads the current program
 * scene from OBS, clicks that scene in the page, and puts the original scene back.
 *
 * Both the original name and every later check come from OBS itself, through the page's
 * own connection (`window.wrc.safeCall('GetCurrentProgramScene')`), never from the
 * rendered scene list: the DOM belongs to the code under test, so in the failure mode
 * this guard exists for it is the one thing that cannot be trusted. A restore is reported
 * as successful only after OBS says the original scene is program again. If OBS cannot be
 * read, the run says the restore is unconfirmed, names the scene the operator has to
 * restore by hand, and fails.
 *
 * The restore runs on every exit path this script owns:
 *	- normal completion and assertion failure (one finish() call),
 *	- SIGINT and SIGTERM (exit 130 and 143),
 *	- watchdog expiry via SMOKE_BUDGET_MS (exit 1),
 *	- an unhandled promise rejection or an uncaught exception (exit 1, error printed).
 * Every path funnels into the same idempotent routine, which restores, then closes CDP,
 * kills Chrome, closes the HTTP server and removes every temp profile, then exits once.
 * A second signal exits immediately (a fast double Ctrl-C can interrupt a restore); a
 * watchdog tick or rejection that arrives during a shutdown is ignored rather than allowed
 * to cut the restore short. After a restore failure the message names the scene still on
 * program so it can be fixed by hand.
 *
 * A restore is confirmed only after the click it was racing has settled and OBS has
 * reported the original scene twice, at least 750ms apart. One confirming read is evidence,
 * not proof: an interrupted SetCurrentProgramScene can still land after it.
 *
 * SMOKE_SCENE cannot change program in studio mode: a synthetic click is read as a preview
 * click there, program is left untouched, and the restore correctly fails closed as
 * unconfirmed. Studio mode is out of scope.
 *
 * The destructive path was exercised on the maintainer's rig with SMOKE_SCENE=Title: a real
 * switch to Title, then the original Main Live restored on normal completion, on SIGTERM
 * delivered mid-restore (exit 143) and on watchdog expiry mid-restore (exit 1), each run
 * leaving no Chrome process and no temp profile behind.
 *
 * Environment:
 *	OBS_PASSWORD           required; the obs-websocket password
 *	OBS_HOST               default 127.0.0.1:4455; bare host:port or a full ws:// URL
 *	CHROME                 path to a Chrome/Chromium binary
 *	SMOKE_SCENE            scene to switch to (destructive; original restored afterwards)
 *	SMOKE_ALLOW_ON_AIR=1   allow SMOKE_SCENE while streaming, recording or virtual cam is on
 *	SMOKE_REQUIRE_BROWSER=1 fail instead of skipping when no Chrome is found
 *	SMOKE_BUDGET_MS        hard run budget, default 120000
 */

import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT        = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OBS_HOST    = process.env.OBS_HOST || '127.0.0.1:4455';
const BUDGET_MS   = Number(process.env.SMOKE_BUDGET_MS) || 120000;
const SMOKE_SCENE = process.env.SMOKE_SCENE || '';

const CHROME_CANDIDATES = [
	'/usr/bin/google-chrome',
	'/usr/bin/google-chrome-stable',
	'/usr/bin/chromium',
	'/usr/bin/chromium-browser',
	'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
	'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', // maintainer's Windows box
];

const MIME = new Map(Object.entries({
	'.html': 'text/html; charset=utf-8',
	'.js':   'text/javascript; charset=utf-8',
	'.mjs':  'text/javascript; charset=utf-8',
	'.css':  'text/css; charset=utf-8',
	'.json': 'application/json; charset=utf-8',
	'.svg':  'image/svg+xml',
	'.png':  'image/png',
	'.ico':  'image/x-icon',
	'.webmanifest': 'application/manifest+json',
}));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// --- environment gates ------------------------------------------------------

const password = process.env.OBS_PASSWORD;

if (!password) {
	console.error('OBS_PASSWORD is not set. Export the obs-websocket password, e.g.:');
	console.error('	export OBS_PASSWORD="$(...)"');
	process.exit(1);
}

if (typeof WebSocket !== 'function') {
	console.error(`FAILED: this Node (${process.version}) has no global WebSocket.`);
	console.error('The browser smoke test needs Node 22 or newer (verified on v24.12.0).');
	process.exit(1);
}

function findChrome () {
	if (process.env.CHROME) {
		if (fs.existsSync(process.env.CHROME))
			return process.env.CHROME;
		console.error(`FAILED: CHROME is set to ${process.env.CHROME} but that file does not exist.`);
		process.exit(1);
	}
	for (const candidate of CHROME_CANDIDATES) {
		if (fs.existsSync(candidate))
			return candidate;
	}
	return null;
}

const chromePath = findChrome();

if (!chromePath) {
	if (process.env.SMOKE_REQUIRE_BROWSER === '1') {
		console.error('FAILED: no Chrome found and SMOKE_REQUIRE_BROWSER=1.');
		console.error(`tried: ${CHROME_CANDIDATES.join(', ')}`);
		process.exit(1);
	}
	console.log('SKIPPED: no Chrome found');
	process.exit(0);
}

// --- static server ----------------------------------------------------------

function startServer () {
	const server = http.createServer((request, response) => {
		let pathname;
		try {
			pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
		} catch (e) {
			response.writeHead(400, { 'content-type': 'text/plain' });
			response.end('bad request');
			return;
		}

		if (pathname.endsWith('/'))
			pathname += 'index.html';

		const file = path.resolve(ROOT, '.' + pathname);
		if (file !== ROOT && !file.startsWith(ROOT + path.sep)) {
			response.writeHead(403, { 'content-type': 'text/plain' });
			response.end('forbidden');
			return;
		}

		fs.readFile(file, (error, data) => {
			if (error) {
				response.writeHead(404, { 'content-type': 'text/plain' });
				response.end('not found');
				return;
			}
			response.writeHead(200, {
				'content-type':  MIME.get(path.extname(file).toLowerCase()) || 'application/octet-stream',
				'cache-control': 'no-store',
			});
			response.end(data);
		});
	});

	return new Promise((resolve, reject) => {
		server.once('error', reject);
		server.listen(0, '127.0.0.1', () => resolve(server));
	});
}

// --- Chrome -----------------------------------------------------------------

function launchChrome (binary, userDataDir, extraFlags) {
	const args = [
		'--headless=new',
		'--disable-gpu',
		'--no-first-run',
		'--no-default-browser-check',
		'--remote-debugging-port=0',
		'--disable-dev-shm-usage',
		`--user-data-dir=${userDataDir}`,
		...extraFlags,
		'about:blank',
	];

	const child = spawn(binary, args, { stdio: ['ignore', 'ignore', 'pipe'] });
	child.spawnError = null;
	child.stderrTail = [];

	// A spawn failure (bad CHROME path, EACCES) arrives asynchronously as 'error'. Without a
	// listener Node throws it out of the run, past every try/finally, leaving the HTTP
	// server and the temp profile behind. Record it so waitForDevToolsPort can surface it.
	child.on('error', error => { child.spawnError = error; });

	if (child.stderr) {
		child.stderr.setEncoding('utf8');
		child.stderr.on('data', chunk => {
			for (const line of chunk.split(/\r?\n/)) {
				if (line.trim())
					child.stderrTail.push(line.trim());
			}
			while (child.stderrTail.length > 20)
				child.stderrTail.shift();
		});
	}
	return child;
}

function killChild (child) {
	try { child.kill('SIGKILL'); } catch (e) { /* already gone */ }
}

function stderrTail (child) {
	return child.stderrTail.length ? `\nchrome stderr:\n  ${child.stderrTail.join('\n  ')}` : '';
}

async function waitForDevToolsPort (userDataDir, child, timeoutMs = 20000) {
	const file    = path.join(userDataDir, 'DevToolsActivePort');
	const deadline = Date.now() + timeoutMs;

	while (Date.now() < deadline) {
		if (child.spawnError) {
			const error = child.spawnError;
			throw new Error(`could not launch Chrome (${error.code || error.message}).`);
		}
		if (child.exitCode !== null)
			throw new Error(`Chrome exited with code ${child.exitCode} before exposing a debug port.${stderrTail(child)}`);
		try {
			const [first] = (await fs.promises.readFile(file, 'utf8')).split(/\r?\n/);
			if (first && Number(first) > 0)
				return Number(first);
		} catch (e) {
			// not written yet
		}
		await sleep(100);
	}

	throw new Error(`Chrome did not write DevToolsActivePort within ${timeoutMs / 1000}s.${stderrTail(child)}`);
}

async function startChrome () {
	// One fresh profile per attempt. Reusing the first profile after killing its Chrome
	// leaves a SingletonLock behind, which makes the retry fail for the wrong reason.
	const launch = async (flags) => {
		const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), 'obs-smoke-chrome-'));
		profileDirs.push(profileDir); // cleanup() owns it from this moment on
		userDataDir = profileDir;

		const child = launchChrome(chromePath, profileDir, flags);
		try {
			return { child, userDataDir: profileDir, port: await waitForDevToolsPort(profileDir, child) };
		} catch (error) {
			killChild(child);
			// Let the child go before the next attempt, so it cannot keep writing its profile
			// while cleanup removes it.
			await new Promise(resolve => {
				if (child.exitCode !== null)
					return resolve();
				const timer = setTimeout(resolve, 2000);
				child.once('exit', () => { clearTimeout(timer); resolve(); });
			});
			throw error;
		}
	};

	try {
		return await launch([]);
	} catch (error) {
		// Chrome in a container without usable user namespaces refuses to start without this;
		// retry once and say so, instead of silently weakening the sandbox.
		console.log('NOTE: Chrome failed to start; retrying with --no-sandbox.');
		try {
			return await launch(['--no-sandbox']);
		} catch (retryError) {
			throw new Error(`${retryError.message} (after the first attempt failed: ${error.message})`);
		}
	}
}

async function getPageTarget (port, timeoutMs = 15000) {
	const deadline = Date.now() + timeoutMs;
	let last = 'no answer';

	while (Date.now() < deadline) {
		try {
			const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
			const page = list.find(target => target.type === 'page' && target.webSocketDebuggerUrl);
			if (page)
				return page;
			last = `no page target among ${list.length} target(s)`;
		} catch (e) {
			last = e.message;
		}
		await sleep(100);
	}

	throw new Error(`no debuggable page target on port ${port} (${last})`);
}

// --- CDP --------------------------------------------------------------------

class CDP {
	constructor (socket) {
		this.socket   = socket;
		this.nextId   = 1;
		this.pending  = new Map();
		this.handlers = new Map();
		this.closed   = false;

		socket.addEventListener('message', event => {
			let message;
			try {
				message = JSON.parse(event.data);
			} catch (e) {
				return;
			}

			if (message.id !== undefined && this.pending.has(message.id)) {
				const call = this.pending.get(message.id);
				this.pending.delete(message.id);
				clearTimeout(call.timer);
				if (message.error)
					call.reject(new Error(`${message.error.message}${message.error.data ? ` (${message.error.data})` : ''}`));
				else
					call.resolve(message.result || {});
				return;
			}

			if (message.method) {
				for (const handler of this.handlers.get(message.method) || []) {
					try { handler(message.params); } catch (e) { /* a listener must not break the run */ }
				}
			}
		});

		socket.addEventListener('close', () => {
			this.closed = true;
			for (const call of this.pending.values()) {
				clearTimeout(call.timer);
				call.reject(new Error('CDP socket closed'));
			}
			this.pending.clear();
		});
	}

	on (method, handler) {
		if (!this.handlers.has(method))
			this.handlers.set(method, new Set());
		this.handlers.get(method).add(handler);
	}

	send (method, params = {}, timeoutMs = 15000) {
		if (this.closed)
			return Promise.reject(new Error(`CDP is closed; cannot send ${method}`));

		const id = this.nextId++;
		return new Promise((resolve, reject) => {
			const timer = setTimeout(() => {
				this.pending.delete(id);
				reject(new Error(`${method} did not answer within ${timeoutMs / 1000}s`));
			}, timeoutMs);
			if (typeof timer.unref === 'function')
				timer.unref();

			this.pending.set(id, { resolve, reject, timer });
			this.socket.send(JSON.stringify({ id, method, params }));
		});
	}

	close () {
		this.closed = true;
		try { this.socket.close(); } catch (e) { /* already closed */ }
	}
}

function openSocket (url, timeoutMs = 10000) {
	return new Promise((resolve, reject) => {
		const socket = new WebSocket(url);
		const timer  = setTimeout(() => {
			try { socket.close(); } catch (e) { /* nothing to close */ }
			reject(new Error(`could not open the CDP socket within ${timeoutMs / 1000}s`));
		}, timeoutMs);

		socket.addEventListener('open', () => { clearTimeout(timer); resolve(socket); }, { once: true });
		socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error(`CDP socket error for ${url}`)); }, { once: true });
	});
}

// --- run --------------------------------------------------------------------

let server        = null;
let chromeProcess = null;
let userDataDir   = null;
let cdp           = null;
let cleanedUp     = false;
let watchdog      = null;
let exitCode      = 0;
let shuttingDown  = false;
let timedOut      = false;

// How many signals have arrived. Deliberately independent of shuttingDown: the shutdown a
// signal lands inside may be the routine restore that ends a successful run, so a signal
// during it is still the FIRST signal and must not cut that restore short.
let signalCount   = 0;

// Every Chrome profile this run created, in launch order: cleanup removes all of them, not
// only the one that ended up serving the page.
const profileDirs = [];

// Where OBS said the program scene was before this run touched anything, and whether the
// run still owes it a restore. Restore state is only armed once a click was dispatched.
let originalScene = null;
let needsRestore  = false;

// The click dispatched for the switch, while its SetCurrentProgramScene may still be in
// flight. The restore settles it before it believes any read of the program scene.
let pendingClick  = null;

const pageExceptions = [];
const consoleErrors  = [];
const consoleWarnings = [];
const logErrors      = [];

async function cleanup () {
	if (cleanedUp)
		return;
	cleanedUp = true;

	if (cdp)
		cdp.close();

	if (chromeProcess && chromeProcess.exitCode === null) {
		try { chromeProcess.kill('SIGKILL'); } catch (e) { /* already gone */ }
		// wait for the child to go, so it cannot rewrite its profile after we delete it
		await new Promise(resolve => {
			const timer = setTimeout(resolve, 2000);
			chromeProcess.once('exit', () => { clearTimeout(timer); resolve(); });
		});
	}

	if (server) {
		await new Promise(resolve => {
			if (typeof server.closeAllConnections === 'function')
				server.closeAllConnections();
			server.close(() => resolve());
		});
	}

	for (const dir of profileDirs) {
		// Chrome can recreate files while it is still winding down, so retry the removal
		for (let attempt = 0; attempt < 5 && fs.existsSync(dir); attempt++) {
			try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) { /* retry */ }
			if (fs.existsSync(dir))
				await sleep(200);
		}
	}
}

async function evaluate (expression, { awaitPromise = false, timeoutMs = 10000 } = {}) {
	const result = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise }, timeoutMs);
	if (result.exceptionDetails) {
		const details = result.exceptionDetails;
		throw new Error(`page evaluation threw: ${details.exception?.description || details.text || 'unknown error'}`);
	}
	return result.result?.value;
}

async function waitForTruthy (expression, timeoutMs, what) {
	const deadline = Date.now() + timeoutMs;
	let lastError  = null;

	while (Date.now() < deadline) {
		try {
			if (await evaluate(expression))
				return;
		} catch (e) {
			lastError = e;
		}
		await sleep(100);
	}

	throw new Error(`${what} did not happen within ${timeoutMs / 1000}s${lastError ? ` (last error: ${lastError.message})` : ''}`);
}

async function pass (label, expression, timeoutMs) {
	await waitForTruthy(expression, timeoutMs, label);
	console.log(`PASS: ${label}`);
}

async function assertNoPageErrors () {
	await sleep(500); // let late errors land

	// The app reports failed RPCs through console.warn, so warnings are evidence too. Only
	// ones that look like a failure count; benign warnings must not redden a healthy run.
	const failedWarnings = consoleWarnings.filter(text => /request|failed|error|reject/i.test(text));

	if (pageExceptions.length === 0 && consoleErrors.length === 0 && failedWarnings.length === 0) {
		console.log('PASS: no uncaught exceptions, no console.error calls and no failed-request warnings');
		return;
	}

	const lines = [];
	if (pageExceptions.length) {
		lines.push('uncaught exceptions:');
		for (const text of pageExceptions)
			lines.push(`  ${text}`);
	}
	if (consoleErrors.length) {
		lines.push('console.error calls:');
		for (const text of consoleErrors)
			lines.push(`  ${text}`);
	}
	if (failedWarnings.length) {
		lines.push('console.warn calls that look like failures:');
		for (const text of failedWarnings)
			lines.push(`  ${text}`);
	}
	throw new Error(lines.join('\n'));
}

async function dumpFailureContext () {
	if (!cdp)
		return;

	try {
		const info = await evaluate(`(() => {
			const element = document.getElementById('obw_ws_messages');
			return {
				text:    element ? element.textContent.trim() : '(no #obw_ws_messages)',
				classes: element ? [...element.classList].join(' ') : '(none)',
				scenes:  document.querySelectorAll('#scene_list li.scene').length,
				wrc:     typeof window.wrc === 'undefined' ? 'missing' : window.wrc.isConnected,
			};
		})()`, { timeoutMs: 5000 });

		console.error(`status line: ${JSON.stringify(info.text)} (class="${info.classes}")`);
		console.error(`scenes rendered: ${info.scenes}; wrc.isConnected: ${JSON.stringify(info.wrc)}`);
	} catch (e) {
		console.error(`could not read the page status: ${e.message}`);
	}

	if (logErrors.length)
		console.error(`browser log errors:\n  ${logErrors.join('\n  ')}`);
}

// --- scene switching (destructive, opt-in) ----------------------------------
//
// The page's rendered list is what gets clicked, never what gets trusted. Program scene
// state is read from OBS through the app's own connection, so a broken or lying UI cannot
// fake a switch or a restore.

const SCENE_NAMES_EXPR = `[...document.querySelectorAll('#scene_list li.scene label')].map(label => label.textContent.trim())`;

function clickSceneExpression (name) {
	return `(() => {
		const item = [...document.querySelectorAll('#scene_list li.scene')].find(candidate => {
			const label = candidate.querySelector('label');
			return label && label.textContent.trim() === ${JSON.stringify(name)};
		});
		if (!item)
			return false;
		item.click();
		return true;
	})()`;
}

const OBS_PROGRAM_EXPR = `(async () => {
	try {
		if (!window.wrc || typeof window.wrc.safeCall !== 'function')
			return { error: 'window.wrc.safeCall is not available' };
		const scene = await window.wrc.safeCall('GetCurrentProgramScene');
		if (!scene || typeof scene.currentProgramSceneName !== 'string')
			return { error: scene ? 'GetCurrentProgramScene answered without currentProgramSceneName' : 'GetCurrentProgramScene failed' };
		return { name: scene.currentProgramSceneName };
	} catch (error) {
		return { error: String((error && error.message) || error) };
	}
})()`;

async function readProgramSceneFromOBS () {
	if (!cdp || cdp.closed)
		return { error: 'the page is no longer reachable' };

	try {
		const answer = await evaluate(OBS_PROGRAM_EXPR, { awaitPromise: true, timeoutMs: 5000 });
		return answer || { error: 'GetCurrentProgramScene gave no answer' };
	} catch (error) {
		return { error: error.message };
	}
}

const RESTORE_TIMEOUT_MS = 15000;  // total budget for the restore
const RESTORE_CLICK_MS   = 2000;   // re-click cadence while the scene is wrong
const RESTORE_QUIET_MS   = 750;    // quiet period between the two confirming reads
const CLICK_SETTLE_MS    = 5000;   // bound on waiting for an interrupted click to answer

// Resolves 'settled' when the promise finishes either way, 'timeout' after timeoutMs. A
// click that never answers must not hold the restore open past its budget.
function settleWithBound (promise, timeoutMs) {
	return new Promise(resolve => {
		const timer = setTimeout(() => resolve('timeout'), timeoutMs);
		if (typeof timer.unref === 'function')
			timer.unref();
		const done = () => { clearTimeout(timer); resolve('settled'); };
		promise.then(done, done);
	});
}

async function waitForProgramScene (name, timeoutMs, what) {
	const deadline = Date.now() + timeoutMs;
	let last = 'no answer from OBS';

	while (Date.now() < deadline) {
		// The restore owns the program scene once shutdown starts: stop polling and never
		// report the switch as a success from a run that is on its way out.
		if (shuttingDown)
			throw new Error(`${what}: interrupted by shutdown, the restore owns the program scene`);

		const current = await readProgramSceneFromOBS();
		if (current.name === name) {
			if (shuttingDown)
				throw new Error(`${what}: interrupted by shutdown, the restore owns the program scene`);
			return;
		}
		last = current.name !== undefined
			? `OBS reports ${JSON.stringify(current.name)}`
			: current.error;
		await sleep(200);
	}

	throw new Error(`${what}: ${last}`);
}

function unconfirmedRestoreError (detail) {
	return new Error(
		`could not confirm the program scene is ${JSON.stringify(originalScene)} again (${detail}).\n` +
		`RESTORE BY HAND: set ${JSON.stringify(originalScene)} as the program scene in OBS.`
	);
}

// The only restore routine. Idempotent, harmless when no switch happened, and it reports
// success on nothing but OBS's own answer about the program scene.
//
// What it guarantees: the click this run dispatched has settled, or was given a bounded
// wait and may still land, and OBS reported the original scene twice with a quiet period
// between the reads. Two reads do not prove no click is still in flight; they make a late
// landing visible before the run claims success. Any read that disagrees, and every
// re-click, discards the earlier confirming read so it has to be earned again.
async function restoreIfNeeded (why) {
	if (!needsRestore || originalScene === null)
		return;
	needsRestore = false; // a second call must not click again

	console.log(`restore (${why}): program scene back to ${JSON.stringify(originalScene)}`);

	// The deadline is fixed before the settle wait, so a click that never answers eats into
	// the budget instead of extending it.
	const deadline = Date.now() + RESTORE_TIMEOUT_MS;

	if (pendingClick) {
		const inflight = pendingClick;
		if (await settleWithBound(inflight, CLICK_SETTLE_MS) === 'timeout')
			console.log(`restore: the interrupted click did not answer within ${CLICK_SETTLE_MS / 1000}s; the switch may still land`);
	}

	let last        = 'OBS gave no answer';
	let lastClickAt = 0;
	let confirming  = 0; // when OBS first reported the original scene, 0 = not yet

	while (Date.now() < deadline) {
		const current = await readProgramSceneFromOBS();

		if (current.name === originalScene) {
			if (confirming === 0) {
				confirming = Date.now();
			} else if (Date.now() - confirming >= RESTORE_QUIET_MS) {
				console.log(`PASS: OBS confirms ${JSON.stringify(originalScene)} is the program scene again (reported twice, ${Date.now() - confirming}ms apart)`);
				return;
			}
			await sleep(250);
			continue;
		}

		// A disagreement, including the interrupted switch landing late, throws the earlier
		// confirming read away: it was evidence, not confirmation.
		confirming = 0;
		last = current.name !== undefined
			? `OBS reports ${JSON.stringify(current.name)}`
			: current.error;

		if (!cdp || cdp.closed)
			throw unconfirmedRestoreError('the page is no longer reachable');

		// Re-click at most every 2s: a click already in flight when the run was interrupted
		// can land after ours, and this makes the restore the last click on the program scene.
		if (Date.now() - lastClickAt >= RESTORE_CLICK_MS) {
			lastClickAt = Date.now();
			confirming  = 0;
			let clicked;
			try {
				clicked = await evaluate(clickSceneExpression(originalScene));
			} catch (error) {
				throw unconfirmedRestoreError(`clicking the scene failed: ${error.message}`);
			}
			if (!clicked)
				throw unconfirmedRestoreError(`no rendered scene item is labelled ${JSON.stringify(originalScene)}`);
		}

		await sleep(250);
	}

	throw unconfirmedRestoreError(last);
}

async function runSceneSwitch (sceneName) {
	const before = await readProgramSceneFromOBS();
	if (before.name === undefined)
		throw new Error(`could not read the program scene from OBS (${before.error}); refusing to switch scenes`);

	originalScene = before.name;
	console.log(`OBS reports the current program scene: ${JSON.stringify(originalScene)}`);

	// A no-op configuration is a no-op even on a live rig: nothing is clicked, so the
	// on-air gate has nothing to protect and must not refuse.
	if (sceneName === originalScene) {
		console.log(`SKIP: SMOKE_SCENE ${JSON.stringify(sceneName)} is already the program scene; no switch needed.`);
		return;
	}

	const statuses = await evaluate(`(async () => {
		const [stream, record, cam] = await Promise.all([
			window.wrc.safeCall('GetStreamStatus'),
			window.wrc.safeCall('GetRecordStatus'),
			window.wrc.safeCall('GetVirtualCamStatus'),
		]);
		return { stream, record, cam };
	})()`, { awaitPromise: true });

	// Every answer must state outputActive === false. A missing field, a null response or a
	// failed call is unknown, and unknown is a refusal; this must never fail open.
	const outputs = {
		streaming:  statuses && statuses.stream ? statuses.stream.outputActive : undefined,
		recording:  statuses && statuses.record ? statuses.record.outputActive : undefined,
		virtualCam: statuses && statuses.cam ? statuses.cam.outputActive : undefined,
	};
	const unknown = Object.keys(outputs).filter(key => outputs[key] !== false && outputs[key] !== true);
	if (unknown.length)
		throw new Error(`could not read ${unknown.join(', ')} state from OBS (outputActive was not a boolean); refusing to switch scenes`);

	const active = Object.keys(outputs).filter(key => outputs[key] === true);
	if (active.length) {
		if (process.env.SMOKE_ALLOW_ON_AIR !== '1')
			throw new Error(`refusing to switch scenes while ${active.join(', ')} is active (set SMOKE_ALLOW_ON_AIR=1 to override)`);
		console.log(`WARN: switching while ${active.join(', ')} is active (SMOKE_ALLOW_ON_AIR=1)`);
	}

	const names = await evaluate(SCENE_NAMES_EXPR);
	if (!Array.isArray(names) || !names.includes(sceneName))
		throw new Error(`SMOKE_SCENE ${JSON.stringify(sceneName)} is not in the scene list; available: ${JSON.stringify(names)}`);

	// Arm the restore before dispatching the click, and keep the click itself: its
	// SetCurrentProgramScene can still be in flight when an interrupt starts the restore,
	// and the restore has to outlive it before it believes anything OBS says.
	if (shuttingDown)
		throw new Error('shutting down before the scene switch; nothing was clicked');
	needsRestore = true;

	const click = evaluate(clickSceneExpression(sceneName))
		.then(value => ({ ok: true, value }), error => ({ ok: false, error }))
		.finally(() => { if (pendingClick === click) pendingClick = null; });
	pendingClick = click;

	const outcome = await click;
	if (!outcome.ok)
		throw new Error(`could not click the scene item for ${JSON.stringify(sceneName)}: ${outcome.error.message}`);
	if (!outcome.value)
		throw new Error(`could not click the scene item for ${JSON.stringify(sceneName)}`);

	await waitForProgramScene(sceneName, 10000, `program scene did not become ${JSON.stringify(sceneName)}`);
	if (shuttingDown)
		return; // the restore owns the program scene now, and it has the last word
	console.log(`PASS: OBS confirms the program scene switched to ${JSON.stringify(sceneName)}`);
}

// --- main -------------------------------------------------------------------

// Every exit goes through finish(): it restores when this run switched, cleans up, and
// only then exits once. The watchdog and the rejection/exception handlers set the exit code
// and hand off. The signal handler exits directly on exactly one path: a genuine second
// signal, which is allowed to abandon a restore and says so in its message.
async function finish (why) {
	if (shuttingDown)
		return; // a second initiator must not restart the pass that is already exiting
	shuttingDown = true;

	// The watchdog stays armed on purpose. It cannot start a second pass (beginShutdown
	// returns while shuttingDown), but if the budget expires during this restore it sets
	// timedOut synchronously, so the restore still completes and the exit code is still 1.

	try {
		await restoreIfNeeded(why);
	} catch (error) {
		// restoreIfNeeded refuses to claim an unverified restore; the message names the
		// scene the operator has to put back by hand.
		console.error(`FAILED: ${error.message}`);
		if (exitCode === 0)
			exitCode = 1;
	}

	try {
		await cleanup();
	} catch (error) {
		console.error(`cleanup failed: ${error.message}`);
		if (exitCode === 0)
			exitCode = 1;
	}

	process.exit(timedOut ? 1 : exitCode);
}

function beginShutdown (code, why) {
	if (shuttingDown)
		return; // one pass only: a racing watchdog tick or rejection must not cut a restore short

	if (exitCode === 0)
		exitCode = code;
	finish(why).catch(error => {
		console.error(`shutdown failed: ${error.message}`);
		process.exit(1);
	});
}

function onSignal (signal, code) {
	signalCount++;
	const first = signalCount === 1;
	const alreadyShuttingDown = shuttingDown;

	console.error(`\nreceived ${signal}${first ? '' : ' again'}; ${needsRestore ? 'restoring the program scene and ' : ''}shutting down`);

	if (!first) {
		// Invariant: the ONLY exit permitted while a restore may be in flight is a genuine
		// second signal. This branch is reached only when signalCount reached 2, so what it
		// says is true, and it does not pretend the cleanup finished.
		console.error(`that was the second ${signal}; exiting now, any restore in flight is abandoned (cleanup may be incomplete)`);
		process.exit(timedOut ? 1 : code);
	}

	// First signal, whatever started the shutdown: this one owns the exit code but never a
	// second restore. Changing exitCode here is enough, because finish() reads it when it
	// finally exits, after the restore and cleanup that are already running.
	if (exitCode === 0)
		exitCode = code;

	if (alreadyShuttingDown) {
		// The routine restore after a successful run, or a watchdog pass, is mid-flight. It
		// is bounded by its own 15s deadline plus cleanup, so letting it finish cannot hang;
		// killing it is exactly how the rig was left on the wrong scene before.
		console.error(`a shutdown was already in flight; letting it finish the restore and cleanup, then exiting ${code}`);
		return;
	}

	beginShutdown(code, signal);
}

process.on('SIGINT',  () => onSignal('SIGINT', 130));
process.on('SIGTERM', () => onSignal('SIGTERM', 143));

// Paths that never reach the try/catch below still restore and clean up through finish().
// The error is printed first, so this does not mask what went wrong.
process.on('unhandledRejection', reason => {
	console.error(`unhandled rejection: ${(reason && reason.stack) || reason}`);
	beginShutdown(1, 'unhandled rejection');
});

process.on('uncaughtException', error => {
	console.error(`uncaught exception: ${(error && error.stack) || error}`);
	beginShutdown(1, 'uncaught exception');
});

watchdog = setTimeout(() => {
	// Decided synchronously, so a main path that finishes in the same tick cannot exit 0.
	timedOut = true;
	exitCode   = 1;
	console.error(`FAILED: the smoke run exceeded its ${BUDGET_MS / 1000}s budget.`);
	// If a shutdown is already running it owns the restore; this tick must not truncate it.
	beginShutdown(1, 'watchdog');
}, BUDGET_MS);
if (typeof watchdog.unref === 'function')
	watchdog.unref();

try {
	console.log(`node ${process.version}, chrome ${chromePath}`);

	server = await startServer();
	const httpPort = server.address().port;
	const pageUrl  = `http://127.0.0.1:${httpPort}/`;
	console.log(`serving ${ROOT} on ${pageUrl}`);
	console.log(`connecting to ${OBS_HOST}`);

	const launched = await startChrome();
	chromeProcess = launched.child;
	userDataDir   = launched.userDataDir;

	const target = await getPageTarget(launched.port);
	cdp = new CDP(await openSocket(target.webSocketDebuggerUrl));

	cdp.on('Runtime.exceptionThrown', params => {
		const details = params.exceptionDetails || {};
		const text    = details.exception?.description || details.text || 'unknown exception';
		const where   = details.url ? ` (${details.url}:${(details.lineNumber ?? 0) + 1})` : '';
		pageExceptions.push(`${text}${where}`);
	});

	cdp.on('Runtime.consoleAPICalled', params => {
		if (params.type !== 'error' && params.type !== 'warning')
			return;
		const text = (params.args || []).map(arg => arg.value ?? arg.description ?? arg.type).join(' ');
		if (params.type === 'error')
			consoleErrors.push(text);
		else
			consoleWarnings.push(text);
	});

	cdp.on('Log.entryAdded', params => {
		const entry = params.entry || {};
		if (entry.level === 'error')
			logErrors.push(`${entry.source || 'log'}: ${entry.text}`);
	});

	await cdp.send('Page.enable');
	await cdp.send('Runtime.enable');
	await cdp.send('Log.enable');

	// Credentials are read once in WebRemoteConnection's constructor, and autoconnect only
	// fires when the password is non-empty, so seed storage before any page script runs.
	await cdp.send('Page.addScriptToEvaluateOnNewDocument', {
		source: `try {
			if (location.protocol === 'http:' || location.protocol === 'https:') {
				localStorage.setItem('host', ${JSON.stringify(OBS_HOST)});
				localStorage.setItem('password', ${JSON.stringify(password)});
			}
		} catch (e) {}`,
	});

	await cdp.send('Page.navigate', { url: pageUrl });

	// a. the app's modules loaded and ran
	await pass('window.wrc exists', 'Boolean(window.wrc)', 10000);

	// b. 1 s autoconnect delay plus the websocket handshake
	await pass('window.wrc.isConnected is true', 'window.wrc.isConnected === true', 20000);

	// c. the scene list rendered, and every item carries a real label
	await pass('#scene_list has scene items', `document.querySelectorAll('#scene_list li.scene').length > 0`, 10000);
	await pass('every rendered scene has a non-empty label', `[...document.querySelectorAll('#scene_list li.scene')].every(item => {
		const label = item.querySelector('label');
		return !!label && label.textContent.trim().length > 0;
	})`, 10000);

	// d. the status line reports success
	await pass('#obw_ws_messages has the good class',
		`document.getElementById('obw_ws_messages').classList.contains('good')`, 10000);

	// e. nothing blew up along the way
	await assertNoPageErrors();

	if (SMOKE_SCENE)
		await runSceneSwitch(SMOKE_SCENE);

	console.log('smoke test passed');
} catch (error) {
	console.error(`FAILED: ${error.message}`);
	await dumpFailureContext();
	if (exitCode === 0)
		exitCode = 1;
}

// The single exit: restores if this run switched, cleans up, exits once.
await finish('run complete');
