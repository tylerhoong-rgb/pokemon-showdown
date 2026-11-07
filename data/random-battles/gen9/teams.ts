/**
 * Gen 9 Random Battle team generator (simple version).
 *
 * Teams are built from the premade sets in ./sets.json:
 *   1. Pick species at random (no repeated base species).
 *   2. For each species pick one of its sets at random.
 *   3. Build the Pokemon from that set.
 *
 * There are no team-building restrictions (type limits, weakness limits, lead rules, ...).
 * See sets.json for the format of a set.
 */
import { Dex, toID } from '../../../sim/dex';
import { PRNG, type PRNGSeed } from '../../../sim/prng';

/** One premade set. Anything left out falls back to the default noted below. */
interface SetData {
	/** Unused by the generator (label only). */
	role?: string;
	/** Up to `maxMoveCount` moves are chosen from this list at random (all of them if it is short enough). */
	movepool: string[];
	/** One is chosen at random. */
	abilities: string[];
	/** One is chosen at random. Default: the species' first type. */
	teraTypes?: string[];
	/** One is chosen at random if it is a list. Default: no item. */
	item?: string | string[];
	/** Stats not listed are 0. Default when missing entirely: 85 in everything. Keys may be any case. */
	evs?: { [stat: string]: number };
	/** Stats not listed are 31. Keys may be any case. */
	ivs?: { [stat: string]: number };
	/** Default: Serious (neutral). */
	nature?: string;
}
interface SpeciesData {
	/** Default: 100 */
	level?: number;
	sets: SetData[];
}

const STATS = ['hp', 'atk', 'def', 'spa', 'spd', 'spe'] as const;
const DEFAULT_LEVEL = 100;

/**
 * Picks the sets file for a format from the format's `team` value (see config/formats.ts).
 * Every other format uses sets.json.
 */
function loadSets(team: string | undefined): [string, { [species: string]: SpeciesData }] {
	if (team === 'randomMetronome1v1') return ['metronome_sets.json', require('./metronome_sets.json')];
	return ['sets.json', require('./sets.json')];
}

export class RandomTeams {
	readonly dex: ModdedDex;
	gen: number;
	format: Format;
	prng: PRNG;
	readonly maxTeamSize: number;
	readonly adjustLevel: number | null;
	readonly maxMoveCount: number;
	readonly forceTeraType: string | undefined;

	/** Name of the sets file in use, for error messages. */
	readonly setsFile: string;
	randomSets: { [species: string]: SpeciesData };

	constructor(format: Format | string, prng: PRNG | PRNGSeed | null) {
		format = Dex.formats.get(format);
		[this.setsFile, this.randomSets] = loadSets(format.team);
		this.dex = Dex.forFormat(format);
		this.gen = this.dex.gen;

		const ruleTable = Dex.formats.getRuleTable(format);
		this.maxTeamSize = ruleTable.maxTeamSize;
		this.adjustLevel = ruleTable.adjustLevel;
		this.maxMoveCount = ruleTable.maxMoveCount;
		const forceTeraType = ruleTable.valueRules.get('forceteratype');
		this.forceTeraType = forceTeraType && this.dex.types.get(forceTeraType).exists ?
			this.dex.types.get(forceTeraType).name : undefined;

		this.format = format;
		this.prng = PRNG.get(prng);
	}

	setSeed(prng?: PRNG | PRNGSeed) {
		this.prng = PRNG.get(prng);
	}

	getTeam(options: PlayerOptions | null = null): PokemonSet[] {
		// Every set built here has all six EVs/IVs and a nature filled in, which is what PokemonSet requires.
		return this.randomTeam() as unknown as PokemonSet[];
	}

	sample<T>(items: readonly T[]): T {
		return this.prng.sample(items);
	}

	sampleIfArray<T>(item: T | T[]): T {
		return Array.isArray(item) ? this.sample(item) : item;
	}

	/** Removes and returns a random element. */
	sampleNoReplace<T>(items: T[]): T {
		const index = this.prng.random(items.length);
		const item = items[index];
		items[index] = items[items.length - 1];
		items.pop();
		return item;
	}

	randomChance(numerator: number, denominator: number) {
		return this.prng.randomChance(numerator, denominator);
	}

	randomTeam(): RandomTeamsTypes.RandomSet[] {
		const pool = Object.keys(this.randomSets);
		if (!pool.length) {
			throw new Error(`${this.setsFile} has no sets yet, so ${this.format.name} cannot make teams. ` +
				`Add some (for example with tools/set-editor).`);
		}
		const team: RandomTeamsTypes.RandomSet[] = [];
		const usedBaseSpecies = new Set<string>();

		while (team.length < this.maxTeamSize && pool.length) {
			const id = this.sampleNoReplace(pool);
			const species = this.dex.species.get(id);
			if (!species.exists) throw new Error(`${this.setsFile}: unknown species "${id}"`);
			// Species Clause
			if (usedBaseSpecies.has(species.baseSpecies)) continue;
			usedBaseSpecies.add(species.baseSpecies);

			team.push(this.randomSet(species));
		}
		return team;
	}

	randomSet(species: Species): RandomTeamsTypes.RandomSet {
		const data = this.randomSets[species.id];
		if (!data?.sets?.length) throw new Error(`${this.setsFile}: "${species.id}" has no sets`);
		const set = this.sample(data.sets);
		const where = `${this.setsFile}: ${species.id}`;

		// Moves: all of them, or a random selection if the movepool is bigger than the move limit
		const movePool = set.movepool.map(name => {
			const move = this.dex.moves.get(name);
			if (!move.exists) throw new Error(`${where} has unknown move "${name}"`);
			return move.id as string;
		});
		const moves: string[] = [];
		while (moves.length < this.maxMoveCount && movePool.length) {
			moves.push(this.sampleNoReplace(movePool));
		}

		const abilityName = this.sample(set.abilities);
		if (!this.dex.abilities.get(abilityName).exists) throw new Error(`${where} has unknown ability "${abilityName}"`);

		const itemName = set.item ? this.sampleIfArray(set.item) : '';
		if (itemName && !this.dex.items.get(itemName).exists) throw new Error(`${where} has unknown item "${itemName}"`);

		let teraType = set.teraTypes?.length ? this.sample(set.teraTypes) : species.types[0];
		if (!this.dex.types.get(teraType).exists) throw new Error(`${where} has unknown tera type "${teraType}"`);
		if (this.forceTeraType) teraType = this.forceTeraType;

		const nature = set.nature || 'Serious';
		if (!this.dex.natures.get(nature).exists) throw new Error(`${where} has unknown nature "${nature}"`);

		return {
			name: species.baseSpecies,
			species: this.getForme(species),
			speciesId: species.id,
			gender: species.gender || (this.randomChance(1, 2) ? 'M' : 'F'),
			shiny: this.randomChance(1, 1024),
			level: this.adjustLevel || data.level || DEFAULT_LEVEL,
			moves,
			ability: abilityName,
			evs: this.statsTable(set.evs, set.evs ? 0 : 85),
			ivs: this.statsTable(set.ivs, 31),
			item: itemName,
			teraType,
			nature,
			role: (set.role || '') as RandomTeamsTypes.Role,
		};
	}

	/** Reads a stat table whose keys may be in any case (HP, Atk, SpA, ...). Stats not listed get `missing`. */
	private statsTable(input: { [stat: string]: number } | undefined, missing: number): SparseStatsTable {
		const lowered: { [stat: string]: number } = {};
		for (const key in input) lowered[key.toLowerCase()] = input[key];
		const result: SparseStatsTable = {};
		for (const stat of STATS) result[stat] = lowered[stat] ?? missing;
		return result;
	}

	getForme(species: Species): string {
		if (typeof species.battleOnly === 'string') return species.battleOnly;
		if (species.cosmeticFormes) return this.sample([species.name].concat(species.cosmeticFormes));
		if (species.name.endsWith('-Gmax')) return species.name.slice(0, -5);
		return species.name;
	}
}

export default RandomTeams;
