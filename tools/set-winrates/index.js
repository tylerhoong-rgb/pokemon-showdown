/**
 * Set win rates
 *
 * Local bot-vs-bot testing for formats where each player brings a single Pokemon (Metronome 1v1 by default).
 * It plays battles between random pairs of sets from the sets file, using the same computer player as
 * /autoplay (server/battle-bot.ts), and keeps a running win/loss/tie record for every individual set.
 *
 *   node tools/set-winrates                    Play 1000 more battles, then show the table
 *   node tools/set-winrates --report           Just show the table
 *   node tools/set-winrates --reset            Forget all records (the old ones are kept as a .bak file)
 *
 * Refer to README.md for all the options and for how to read the results.
 */

'use strict';

const child_process = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..', '..');
const DEFAULT_FORMAT = 'gen9metronome1v1randombattle';
const DEFAULT_GAMES = 1000;
/** A battle still going after this many turns is stopped and counted as a tie. */
const TURN_LIMIT = 300;
/** The records file is rewritten after this many battles (and at the end, and on Ctrl+C). */
const SAVE_EVERY = 50;
const RECORDS_VERSION = 1;

const USAGE = `Usage: node tools/set-winrates [options]

  --games N       Play N more battles (default ${DEFAULT_GAMES}).
  --report        Don't play anything, just show the table of results so far.
  --reset         Forget every record first. The old file is kept next to it as <name>.bak.
                  On its own this only resets; add --games N to reset and then play.
  --format ID     The format to test (default ${DEFAULT_FORMAT}). It must be one where
                  every player brings exactly one Pokemon.
  --sets FILE     Test the sets in FILE instead of the format's own sets file.
  --records FILE  Keep the records in FILE (default logs/set-winrates/<format>.json).
  --seed N        Make the pairings and battles repeatable.
  --no-build      Don't rebuild first. Only safe if you haven't touched the sets or the code.
  --help          Show this message.
`;

class UsageError extends Error {}

// ---------------------------------------------------------------------------------------------------------------
// Identifying sets
// ---------------------------------------------------------------------------------------------------------------

/** EV/IV tables with lower-case keys and the default value left out, so that equal tables compare equal. */
function normalizeStats(stats, defaultValue) {
	const lowered = {};
	for (const name of Object.keys(stats)) {
		if (stats[name] !== defaultValue) lowered[name.toLowerCase()] = stats[name];
	}
	const sorted = {};
	for (const name of Object.keys(lowered).sort()) sorted[name] = lowered[name];
	return sorted;
}

/** What a set actually does when it is played: everything except its label, and with the pools unordered. */
function normalizeSet(set) {
	const out = {};
	for (const key of Object.keys(set).sort()) {
		const value = set[key];
		if (key === 'role') continue; // a label only
		if (key === 'item' && !value) continue; // "" and no item are the same
		if (key === 'evs') {
			out.evs = normalizeStats(value || {}, 0);
		} else if (key === 'ivs') {
			const ivs = normalizeStats(value || {}, 31);
			if (Object.keys(ivs).length) out.ivs = ivs;
		} else if (Array.isArray(value)) {
			out[key] = [...value].sort();
		} else {
			out[key] = value;
		}
	}
	return out;
}

/**
 * The name a set's record is kept under: the species plus a hash of the set's contents. Editing a set
 * (moves, ability, item, EVs, nature, the species' level, ...) therefore gives it a brand new, empty record,
 * while every set you left alone keeps its old one. Changing only a set's role or the order of its lists doesn't.
 */
function setKey(speciesId, level, set) {
	const text = JSON.stringify([speciesId, level ?? 100, normalizeSet(set)]);
	return `${speciesId}:${crypto.createHash('sha1').update(text).digest('hex').slice(0, 8)}`;
}

/** Every distinct set in a sets file, in file order. */
function listSets(randomSets) {
	const entries = [];
	const seen = new Set();
	for (const speciesId of Object.keys(randomSets)) {
		const data = randomSets[speciesId];
		const sets = Array.isArray(data?.sets) ? data.sets : [];
		for (const [index, set] of sets.entries()) {
			const key = setKey(speciesId, data.level, set);
			if (seen.has(key)) continue; // an exact duplicate shares its twin's record
			seen.add(key);
			entries.push({ key, speciesId, level: data.level, index, count: sets.length, set });
		}
	}
	return entries;
}

// ---------------------------------------------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------------------------------------------

function emptyRecords(formatId) {
	return { version: RECORDS_VERSION, format: formatId, battles: 0, sets: {} };
}

function loadRecords(file, formatId) {
	let text;
	try {
		text = fs.readFileSync(file, 'utf8');
	} catch (err) {
		if (err.code === 'ENOENT') return emptyRecords(formatId);
		throw err;
	}
	let records;
	try {
		records = JSON.parse(text);
	} catch {
		throw new UsageError(`${file} isn't valid JSON. Run with --reset to start over (it is backed up first).`);
	}
	if (records.version !== RECORDS_VERSION || records.format !== formatId) {
		throw new UsageError(
			`${file} holds records for ${records.format} (version ${records.version}), not ${formatId}. ` +
			`Use --records to keep them in a different file, or --reset to start over.`
		);
	}
	return records;
}

function saveRecords(file, records) {
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file + '.tmp', JSON.stringify(records, null, '\t') + '\n');
	fs.renameSync(file + '.tmp', file);
}

/** Deletes the records file, keeping a copy as <file>.bak. Returns how many sets had a record, or null if there was no file. */
function resetRecords(file) {
	if (!fs.existsSync(file)) return null;
	let count = 0;
	try {
		count = Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).sets).length;
	} catch {}
	fs.copyFileSync(file, file + '.bak');
	fs.unlinkSync(file);
	return count;
}

/** Adds one finished battle to the records. `winner` is 0 if the first set won, 1 if the second did, null for a tie. */
function applyGame(records, first, second, winner) {
	const blank = entry => ({ species: entry.speciesId, wins: 0, losses: 0, ties: 0 });
	const a = records.sets[first.key] ??= blank(first);
	const b = records.sets[second.key] ??= blank(second);
	if (winner === null) {
		a.ties++;
		b.ties++;
	} else {
		(winner === 0 ? a : b).wins++;
		(winner === 0 ? b : a).losses++;
	}
	records.battles++;
}

// ---------------------------------------------------------------------------------------------------------------
// Statistics and the report
// ---------------------------------------------------------------------------------------------------------------

/** The 95% Wilson score interval for `successes` out of `n`. */
function wilson(successes, n, z = 1.96) {
	if (!n) return [0, 1];
	const p = successes / n;
	const z2 = z * z;
	const denominator = 1 + z2 / n;
	const centre = (p + z2 / (2 * n)) / denominator;
	const half = (z * Math.sqrt(p * (1 - p) / n + z2 / (4 * n * n))) / denominator;
	return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

/** One row per set that is in the sets file right now, plus a count of records that belong to sets that aren't. */
function buildReport(records, entries) {
	const current = new Set(entries.map(entry => entry.key));
	const rows = entries.map(entry => {
		const { wins = 0, losses = 0, ties = 0 } = records.sets[entry.key] || {};
		const games = wins + losses + ties;
		const score = wins + ties / 2;
		const [low, high] = wilson(score, games);
		return { entry, wins, losses, ties, games, rate: games ? score / games : null, low, high };
	});
	rows.sort((a, b) => {
		if ((a.rate === null) !== (b.rate === null)) return a.rate === null ? 1 : -1;
		return (b.rate ?? 0) - (a.rate ?? 0) || b.games - a.games || a.entry.speciesId.localeCompare(b.entry.speciesId);
	});
	let staleSets = 0;
	let staleGames = 0;
	for (const [key, rec] of Object.entries(records.sets)) {
		if (current.has(key)) continue;
		staleSets++;
		staleGames += rec.wins + rec.losses + rec.ties;
	}
	return { rows, staleSets, staleGames };
}

function formatReport(report, { formatName, records, nameOf = id => id }) {
	const pct = value => (value * 100).toFixed(1);
	const table = report.rows.map(row => [
		nameOf(row.entry.speciesId),
		`${row.entry.index + 1}/${row.entry.count}${row.entry.set.role ? ` ${row.entry.set.role}` : ''}`,
		String(row.games),
		`${row.wins}-${row.losses}-${row.ties}`,
		row.rate === null ? '-' : `${pct(row.rate)}%`,
		row.rate === null ? '-' : `${pct(row.low)} to ${pct(row.high)}`,
	]);
	const head = ['Species', 'Set', 'Games', 'W-L-T', 'Win rate', '95% range'];
	const widths = head.map((title, col) => Math.max(title.length, ...table.map(line => line[col].length)));
	const line = cells => cells.map((cell, col) => (col >= 2 && col <= 4 ? cell.padStart(widths[col]) : cell.padEnd(widths[col]))).join('  ').trimEnd();

	const out = [
		`${formatName}: ${report.rows.length} sets, ${records.battles} battles on record`,
		'',
		line(head),
		widths.map(width => '-'.repeat(width)).join('  '),
		...table.map(line),
		'',
		'Win rate counts a tie as half a win. The 95% range shows how far the true win rate could plausibly be',
		'from the number above; a wide range means that set needs more games.',
	];
	if (report.staleSets) {
		out.push(
			'',
			`${report.staleSets} more record(s) (${report.staleGames} games) belong to sets that have since been changed ` +
			`or removed. They are kept but not shown; --reset clears them.`
		);
	}
	return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Playing battles
// ---------------------------------------------------------------------------------------------------------------

/** Loads the simulator and the computer player from dist/ (so `node build` must have run). */
function loadSim() {
	const sim = require('../../dist/sim');
	return {
		Dex: sim.Dex,
		Teams: sim.Teams,
		PRNG: sim.PRNG,
		BattleStream: sim.BattleStream,
		chooseComputerAction: require('../../dist/server/battle-bot').chooseComputerAction,
	};
}

/** The packed team that results from playing exactly this set. */
function packTeam(sim, format, entry, seed) {
	const generator = sim.Teams.getGenerator(format, seed);
	// The generator picks species and sets at random from `randomSets`, so give it only the one we want
	generator.randomSets = { [entry.speciesId]: { level: entry.level, sets: [entry.set] } };
	return sim.Teams.pack(generator.getTeam());
}

const randomSeed = prng => [prng.random(65536), prng.random(65536), prng.random(65536), prng.random(65536)];

/** Plays one battle between two packed teams with the computer player on both sides. */
async function playGame(sim, formatId, teams, prng) {
	const stream = new sim.BattleStream();
	const botPRNG = new sim.PRNG(randomSeed(prng));
	void stream.write([
		`>start ${JSON.stringify({ formatid: formatId, seed: randomSeed(prng) })}`,
		`>player p1 ${JSON.stringify({ name: 'Left', team: teams[0] })}`,
		`>player p2 ${JSON.stringify({ name: 'Right', team: teams[1] })}`,
	].join('\n'));

	let turn = 0;
	let finished = false;
	let winner = null;
	let choiceErrors = 0;
	for await (const chunk of stream) {
		const lines = chunk.split('\n');
		if (lines[0] === 'update') {
			for (const line of lines) {
				if (line.startsWith('|turn|')) {
					turn = Number(line.slice(6));
				} else if (line.startsWith('|win|')) {
					winner = line.slice(5) === 'Left' ? 0 : 1;
					finished = true;
				} else if (line === '|tie') {
					finished = true;
				}
			}
		} else if (lines[0] === 'sideupdate') {
			const [, slot, message = ''] = lines;
			if (message.startsWith('|request|')) {
				const choice = sim.chooseComputerAction(JSON.parse(message.slice(9)), botPRNG);
				if (choice) void stream.write(`>${slot} ${choice}`);
			} else if (message.startsWith('|error|')) {
				if (++choiceErrors > 5) throw new Error(`the computer player kept making invalid choices (${message})`);
				void stream.write(`>${slot} default`);
			}
		}
		if (finished) break;
		if (turn > TURN_LIMIT) return { winner: null, timedOut: true };
	}
	if (!finished) throw new Error('the battle stopped without a result');
	return { winner, timedOut: false };
}

/**
 * Plays `games` battles between random pairs of sets (both drawn evenly from every set, so each set faces the same
 * field and both sides of every battle are recorded), saving the records as it goes.
 */
async function runGames({ sim, format, entries, records, recordsFile, games, prng, onProgress, shouldStop }) {
	const stats = { played: 0, timedOut: 0, failed: 0, firstError: null };
	let failuresInARow = 0;
	for (let i = 0; i < games && !(shouldStop && shouldStop()); i++) {
		// The battles are driven entirely by promises, which never give the event loop a turn. Without this,
		// Ctrl+C (and anything else waiting on the event loop) would never be noticed.
		await new Promise(resolve => setImmediate(resolve));
		const first = entries[prng.random(entries.length)];
		const second = entries[prng.random(entries.length)];
		try {
			const teams = [
				packTeam(sim, format, first, randomSeed(prng)),
				packTeam(sim, format, second, randomSeed(prng)),
			];
			const result = await playGame(sim, format.id, teams, prng);
			applyGame(records, first, second, result.winner);
			stats.played++;
			if (result.timedOut) stats.timedOut++;
			failuresInARow = 0;
		} catch (err) {
			stats.failed++;
			stats.firstError ??= err;
			if (++failuresInARow > 10) throw err;
			continue;
		}
		if (stats.played % SAVE_EVERY === 0) saveRecords(recordsFile, records);
		if (onProgress) onProgress(stats.played, games);
	}
	saveRecords(recordsFile, records);
	return stats;
}

// ---------------------------------------------------------------------------------------------------------------
// Command line
// ---------------------------------------------------------------------------------------------------------------

function parseArgs(argv) {
	const opts = { games: null, report: false, reset: false, format: DEFAULT_FORMAT, sets: null, records: null, seed: null, build: true, help: false };
	const positiveInt = (flag, value) => {
		if (!/^\d+$/.test(value || '') || Number(value) < 1) throw new UsageError(`${flag} needs a whole number of at least 1.`);
		return Number(value);
	};
	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		switch (arg) {
		case '--games': opts.games = positiveInt(arg, argv[++i]); break;
		case '--seed': opts.seed = positiveInt(arg, argv[++i]); break;
		case '--format': opts.format = argv[++i] || ''; break;
		case '--sets': opts.sets = argv[++i] || ''; break;
		case '--records': opts.records = argv[++i] || ''; break;
		case '--report': opts.report = true; break;
		case '--reset': opts.reset = true; break;
		case '--no-build': opts.build = false; break;
		case '--help': case '-h': opts.help = true; break;
		default: throw new UsageError(`Unknown option "${arg}".`);
		}
	}
	if (!opts.format) throw new UsageError('--format needs a format name.');
	if (opts.sets === '') throw new UsageError('--sets needs a file name.');
	if (opts.records === '') throw new UsageError('--records needs a file name.');
	if (opts.report && opts.games) throw new UsageError('--report only shows results; it can\'t be combined with --games.');
	return opts;
}

async function main(argv) {
	const opts = parseArgs(argv);
	if (opts.help) return console.log(USAGE);

	const formatKey = opts.format.toLowerCase().replace(/[^a-z0-9]+/g, '');
	const recordsFile = path.resolve(opts.records || path.join(ROOT, 'logs', 'set-winrates', `${formatKey}.json`));
	const shownFile = path.relative(process.cwd(), recordsFile) || recordsFile;

	if (opts.reset) {
		const count = resetRecords(recordsFile);
		console.log(count === null ?
			`Nothing to reset: ${shownFile} doesn't exist yet.` :
			`Cleared the records for ${count} set(s). The old file is kept as ${shownFile}.bak.`);
		if (!opts.games) return;
	}

	if (opts.build) {
		// Like tools/simulate: dist/ has its own copy of the sets file, so build to be sure it's current
		child_process.execSync(`"${process.execPath}" "${path.join(ROOT, 'build')}"`, { stdio: ['ignore', 'ignore', 'inherit'] });
	}
	const sim = loadSim();

	const format = sim.Dex.formats.get(opts.format);
	if (!format.exists) throw new UsageError(`The format "${opts.format}" does not exist.`);
	if (!format.team) throw new UsageError(`${format.name} doesn't use random sets, so there are no sets to test.`);
	if (sim.Dex.formats.getRuleTable(format).maxTeamSize !== 1) {
		throw new UsageError(
			`${format.name} has more than one Pokemon per team, so one set's win rate can't be told apart from its teammates'. ` +
			`Only formats with "Max Team Size = 1" (like Metronome 1v1) can be tested.`
		);
	}

	let randomSets;
	if (opts.sets) {
		try {
			randomSets = JSON.parse(fs.readFileSync(opts.sets, 'utf8'));
		} catch (err) {
			throw new UsageError(`Couldn't read ${opts.sets}: ${err.message}`);
		}
	} else {
		randomSets = sim.Teams.getGenerator(format).randomSets;
	}
	const entries = listSets(randomSets);
	if (!entries.length) {
		throw new UsageError(
			`There are no sets to test yet. Add some first, for example with:\n` +
			`  node tools/set-editor/server.mjs data/random-battles/gen9/metronome_sets.json`
		);
	}
	// Fail now, with the offending set named, rather than part way through (unknown moves and so on)
	for (const entry of entries) {
		try {
			packTeam(sim, format, entry, [1, 2, 3, 4]);
		} catch (err) {
			throw new UsageError(`${entry.speciesId} set ${entry.index + 1}: ${err.message}`);
		}
	}

	const records = loadRecords(recordsFile, format.id);

	if (!opts.report) {
		const games = opts.games || DEFAULT_GAMES;
		const prng = new sim.PRNG(opts.seed === null ?
			[Math.floor(Math.random() * 65536), Math.floor(Math.random() * 65536), 0x2c0d, 0x7a41] :
			[opts.seed & 0xffff, (opts.seed >>> 16) & 0xffff, 0x2c0d, 0x7a41]);
		let stopRequested = false;
		process.once('SIGINT', () => {
			stopRequested = true;
			console.log('\nStopping after the current battle (press Ctrl+C again to quit immediately)...');
		});
		const start = Date.now();
		const interactive = process.stdout.isTTY;
		console.log(`Playing ${games} battles across ${entries.length} sets in ${format.name}...`);
		const stats = await runGames({
			sim, format, entries, records, recordsFile, games, prng,
			shouldStop: () => stopRequested,
			onProgress: (played, total) => {
				if (interactive ? played % 10 === 0 : played % 250 === 0) {
					const rate = played / ((Date.now() - start) / 1000);
					const text = `  ${played}/${total} battles (${rate.toFixed(1)}/s)`;
					if (interactive) process.stdout.write(`\r${text}  `); else console.log(text);
				}
			},
		});
		if (interactive) process.stdout.write('\r' + ' '.repeat(50) + '\r');
		console.log(`Played ${stats.played} battles in ${((Date.now() - start) / 1000).toFixed(1)}s.`);
		if (stats.timedOut) console.log(`${stats.timedOut} hit the ${TURN_LIMIT}-turn limit and were counted as ties.`);
		if (stats.failed) console.log(`${stats.failed} battle(s) crashed and weren't counted. The first error: ${stats.firstError.stack || stats.firstError}`);
		console.log(`Records saved to ${shownFile}\n`);
	}

	console.log(formatReport(buildReport(records, entries), {
		formatName: format.name,
		records,
		nameOf: id => sim.Dex.species.get(id).name,
	}));
}

module.exports = {
	setKey, listSets, loadRecords, saveRecords, resetRecords, applyGame, wilson, buildReport, formatReport,
	loadSim, runGames, DEFAULT_FORMAT,
};

if (require.main === module) {
	main(process.argv.slice(2)).catch(err => {
		if (err instanceof UsageError) {
			console.error(err.message);
		} else {
			console.error(err);
		}
		process.exit(1);
	});
}
