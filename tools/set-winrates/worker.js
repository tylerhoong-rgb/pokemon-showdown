/**
 * One worker thread for tools/set-winrates: plays batches of battles it is sent (see startPool in index.js).
 * It holds its own copy of the simulator, loaded once when the worker starts.
 */

'use strict';

const { parentPort, workerData } = require('worker_threads');
const winrates = require('./index');

const sim = winrates.loadSim();
const format = sim.Dex.formats.get(workerData.formatId);

parentPort.on('message', async ({ jobs }) => {
	const results = [];
	for (const job of jobs) {
		try {
			results.push(await winrates.playJob(sim, format, workerData.entries, job));
		} catch (err) {
			results.push({ error: String(err && err.stack || err) });
		}
	}
	parentPort.postMessage({ results });
});
