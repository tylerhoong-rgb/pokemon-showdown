/**
 * Tests for the set win-rate tester (tools/set-winrates)
 */

'use strict';

const assert = require('assert').strict;
const fs = require('fs');
const os = require('os');
const path = require('path');

const winrates = require('../../tools/set-winrates');

const SET = {
	role: 'bulky',
	movepool: ['Metronome', 'Rest'],
	abilities: ['Rough Skin'],
	item: ['Leftovers', 'Life Orb'],
	evs: { HP: 252, Def: 252 },
	nature: 'Impish',
};
const key = (set, level = 100, species = 'garchomp') => winrates.setKey(species, level, set);

describe('Set win rates', () => {
	describe('identifying sets', () => {
		it('should give the same key to a set that plays the same', () => {
			const same = {
				nature: 'Impish',
				evs: { def: 252, hp: 252, atk: 0 }, // other case, a zero left in
				abilities: ['Rough Skin'],
				item: ['Life Orb', 'Leftovers'], // pools in another order
				movepool: ['Rest', 'Metronome'],
				role: 'a different label',
				ivs: { Atk: 31 }, // the default
			};
			assert.equal(key(same), key(SET));
		});

		it('should give a set a new key when anything that matters changes', () => {
			const original = key(SET);
			assert.notEqual(key({ ...SET, nature: 'Adamant' }), original);
			assert.notEqual(key({ ...SET, movepool: ['Metronome'] }), original);
			assert.notEqual(key({ ...SET, evs: { HP: 252, Def: 248 } }), original);
			assert.notEqual(key({ ...SET, ivs: { Spe: 0 } }), original);
			assert.notEqual(key({ ...SET, item: 'Leftovers' }), original);
			assert.notEqual(key(SET, 90), original, 'the species\' level is part of the set');
			assert.notEqual(key(SET, 100, 'garchompmega'), original);
		});

		it('should tell "no EVs" (85 in everything) apart from "all EVs zero"', () => {
			const { evs, ...noEvs } = SET;
			assert.notEqual(key(noEvs), key({ ...SET, evs: {} }));
		});

		it('should list each distinct set once, in file order, with its place in the species', () => {
			const entries = winrates.listSets({
				garchomp: { level: 100, sets: [SET, { ...SET, nature: 'Adamant' }, { ...SET, role: 'dupe' }] },
				magikarp: { sets: [{ movepool: ['Splash'], abilities: ['Swift Swim'] }] },
			});
			assert.deepEqual(entries.map(entry => [entry.speciesId, entry.index, entry.count]), [
				['garchomp', 0, 3], ['garchomp', 1, 3], ['magikarp', 0, 1],
			]);
		});
	});

	describe('statistics', () => {
		it('should give a Wilson interval that contains the estimate and narrows with more games', () => {
			const [lowFew, highFew] = winrates.wilson(5, 10);
			const [lowMany, highMany] = winrates.wilson(500, 1000);
			assert(lowFew < 0.5 && 0.5 < highFew);
			assert(lowMany < 0.5 && 0.5 < highMany);
			assert(highMany - lowMany < highFew - lowFew);
			assert.deepEqual(winrates.wilson(0, 0), [0, 1]);
			const [low, high] = winrates.wilson(10, 10);
			assert(high <= 1 && low > 0.6);
		});
	});

	describe('records', () => {
		let dir;
		before(() => {
			dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-winrates-'));
		});
		after(() => {
			fs.rmSync(dir, { recursive: true, force: true });
		});

		const entry = (speciesId, set = SET) => ({ key: key(set, 100, speciesId), speciesId, level: 100, index: 0, count: 1, set });

		it('should record wins, losses and ties for both sides', () => {
			const a = entry('garchomp');
			const b = entry('magikarp');
			const records = { version: 1, format: 'f', battles: 0, sets: {} };
			winrates.applyGame(records, a, b, 0);
			winrates.applyGame(records, a, b, 1);
			winrates.applyGame(records, a, b, null);
			winrates.applyGame(records, a, b, 0);
			assert.deepEqual(records.sets[a.key], { species: 'garchomp', wins: 2, losses: 1, ties: 1 });
			assert.deepEqual(records.sets[b.key], { species: 'magikarp', wins: 1, losses: 2, ties: 1 });
			assert.equal(records.battles, 4);
		});

		it('should record a mirror match as one win and one loss for the same set', () => {
			const a = entry('garchomp');
			const records = { version: 1, format: 'f', battles: 0, sets: {} };
			winrates.applyGame(records, a, a, 1);
			assert.deepEqual(records.sets[a.key], { species: 'garchomp', wins: 1, losses: 1, ties: 0 });
		});

		it('should save, load, back up and reset', () => {
			const file = path.join(dir, 'nested', 'records.json');
			const records = { version: 1, format: 'f', battles: 1, sets: {} };
			winrates.applyGame(records, entry('garchomp'), entry('magikarp'), 0);
			winrates.saveRecords(file, records);
			assert.deepEqual(winrates.loadRecords(file, 'f'), records);
			assert.throws(() => winrates.loadRecords(file, 'other-format'), /not other-format/);

			assert.equal(winrates.resetRecords(file), 2);
			assert(!fs.existsSync(file), 'the records file should be gone');
			assert.deepEqual(JSON.parse(fs.readFileSync(file + '.bak', 'utf8')), records, 'and kept as a backup');
			assert.equal(winrates.resetRecords(file), null);
			assert.deepEqual(winrates.loadRecords(file, 'f'), { version: 1, format: 'f', battles: 0, sets: {} });
		});

		it('should only report sets that are in the file now, and count the leftovers', () => {
			const old = entry('garchomp');
			const edited = entry('garchomp', { ...SET, nature: 'Adamant' });
			const records = { version: 1, format: 'f', battles: 0, sets: {} };
			winrates.applyGame(records, old, entry('magikarp'), 0);

			const report = winrates.buildReport(records, [edited, entry('magikarp')]);
			assert.deepEqual(report.rows.map(row => [row.entry.key === edited.key, row.games]), [[false, 1], [true, 0]]);
			assert.equal(report.rows[0].rate, 0);
			assert.equal(report.rows[1].rate, null, 'a set with no games has no win rate');
			assert.equal(report.staleSets, 1);
			assert.equal(report.staleGames, 1);
			assert(winrates.formatReport(report, { formatName: 'F', records }).includes('1 more record(s)'));
		});
	});

	describe('playing battles', function () {
		this.timeout(60000);

		it('should give identical records for the same seed whatever the number of workers', async () => {
			const sim = winrates.loadSim();
			const format = sim.Dex.formats.get(winrates.DEFAULT_FORMAT);
			const entries = winrates.listSets({
				garchomp: { level: 100, sets: [
					{ movepool: ['Metronome'], abilities: ['Rough Skin'], item: 'Leftovers' },
					{ movepool: ['Metronome'], abilities: ['Sand Veil'], item: ['Choice Scarf', 'Life Orb'], nature: 'Jolly' },
				] },
				magikarp: { level: 5, sets: [{ movepool: ['Metronome'], abilities: ['Swift Swim'] }] },
			});
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-winrates-'));
			try {
				const play = async workers => {
					const records = { version: 1, format: format.id, battles: 0, sets: {} };
					const stats = await winrates.runGames({
						sim, format, entries, records, recordsFile: path.join(dir, `records-${workers}.json`),
						games: 100, prng: new sim.PRNG([5, 6, 7, 8]), workers,
					});
					return { records, stats };
				};
				const single = await play(1);
				const parallel = await play(2);
				assert.equal(single.stats.workers, 1);
				assert.equal(parallel.stats.workers, 2, 'the battles should have been shared between two threads');
				assert.equal(parallel.stats.played, 100);
				assert.equal(parallel.stats.failed, 0, parallel.stats.firstError && parallel.stats.firstError.stack);
				assert.deepEqual(parallel.records, single.records);
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});

		it('should rate a far stronger set above a far weaker one, and keep wins and losses in balance', async () => {
			const sim = winrates.loadSim();
			const format = sim.Dex.formats.get(winrates.DEFAULT_FORMAT);
			const strong = { movepool: ['Metronome'], abilities: ['Rough Skin'], item: 'Leftovers', evs: { HP: 252, Def: 252 } };
			const weak = { movepool: ['Metronome'], abilities: ['Swift Swim'], item: 'Leftovers' };
			const entries = winrates.listSets({
				garchomp: { level: 100, sets: [strong] },
				magikarp: { level: 5, sets: [weak] },
			});
			const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'set-winrates-'));
			try {
				const records = { version: 1, format: format.id, battles: 0, sets: {} };
				const stats = await winrates.runGames({
					sim, format, entries, records, recordsFile: path.join(dir, 'records.json'),
					games: 40, prng: new sim.PRNG([1, 2, 3, 4]),
				});
				assert.equal(stats.failed, 0, stats.firstError && stats.firstError.stack);
				assert.equal(stats.played, 40);
				assert.equal(records.battles, 40);

				const [chomp, karp] = entries.map(entry => records.sets[entry.key]);
				assert.equal(chomp.wins + chomp.losses + chomp.ties + karp.wins + karp.losses + karp.ties, 80);
				assert.equal(chomp.wins + karp.wins, chomp.losses + karp.losses, 'every win is somebody\'s loss');
				const rate = rec => (rec.wins + rec.ties / 2) / (rec.wins + rec.losses + rec.ties);
				// Half the pairings are mirror matches (50% each), so expect roughly 73% against 27%, not 100% against 0%
				assert(rate(chomp) > rate(karp) + 0.25, `Garchomp won ${rate(chomp)} of its games, Magikarp ${rate(karp)}`);
				assert.deepEqual(winrates.loadRecords(path.join(dir, 'records.json'), format.id), records, 'records were saved');
			} finally {
				fs.rmSync(dir, { recursive: true, force: true });
			}
		});
	});
});
