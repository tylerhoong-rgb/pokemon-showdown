/**
 * Generates dex-data.js (names, types, abilities, ...) for the set editor's autocomplete.
 * Run from the repo root:  node tools/set-editor/build-data.mts
 * Re-run it whenever you add moves/items/abilities/species to the data/ files.
 */
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');
const load = async (f: string) => import(path.join(root, 'data', f));

const toID = (s: string) => ('' + s).toLowerCase().replace(/[^a-z0-9]+/g, '');

const { Pokedex } = await load('pokedex.ts');
const { Moves } = await load('moves.ts');
const { Abilities } = await load('abilities.ts');
const { Items } = await load('items.ts');
const { Natures } = await load('natures.ts');
const { TypeChart } = await load('typechart.ts');

/** 1 = not usable in current-gen play (Past/Future/CAP/Unobtainable/...), used only to rank suggestions lower */
const ns = (x: any) => (x.isNonstandard ? 1 : 0);

const species = Object.entries<any>(Pokedex).map(([id, p]) => {
	const sprite = p.baseSpecies && p.forme ? `${toID(p.baseSpecies)}-${toID(p.forme)}` : id;
	return {
		id, name: p.name, num: p.num, types: p.types, abilities: Object.values(p.abilities || {}), sprite,
		bs: p.baseStats ? [p.baseStats.hp, p.baseStats.atk, p.baseStats.def, p.baseStats.spa, p.baseStats.spd, p.baseStats.spe] : [],
		ns: ns(p),
	};
});
const moves = Object.values<any>(Moves).map(m => ({
	name: m.name, type: m.type, cat: m.category[0], bp: m.basePower, ns: ns(m),
}));
const abilities = Object.values<any>(Abilities).filter(a => a.name !== 'No Ability').map(a => ({ name: a.name, ns: ns(a) }));
const items = Object.values<any>(Items).map(i => ({ name: i.name, ns: ns(i) }));
const natures = Object.values<any>(Natures).map(n => ({ name: n.name, plus: n.plus || null, minus: n.minus || null }));
const types = Object.keys(TypeChart).map(t => t[0].toUpperCase() + t.slice(1)).filter(t => t !== 'Stellar');

const out = { species, moves, abilities, items, natures, types };
fs.writeFileSync(path.join(here, 'dex-data.js'), `window.DEX = ${JSON.stringify(out)};\n`);
console.log(Object.fromEntries(Object.entries(out).map(([k, v]) => [k, (v as any[]).length])));
