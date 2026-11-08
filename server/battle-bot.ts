/**
 * Computer player
 *
 * The decision logic for computer-controlled players in a RoomBattle (see /autoplay in
 * chat-plugins/autoplay.ts and `RoomBattlePlayerOptions.computer` in room-battle.ts).
 *
 * It is intentionally simple: a random usable move, a random switch when forced to, and the
 * simulator's own default choice for anything it doesn't understand (doubles, team preview, ...).
 * Only singles formats are supported by /autoplay.
 *
 * Three things are not random: it always Mega Evolves as soon as it can (turn 1 for a Pokemon that starts
 * holding its Mega Stone), a Pokemon that can Mega Evolve never Terastallizes (not even after it has
 * Mega Evolved), and Ogerpon always Terastallizes as soon as it can (turn 1), since that is what turns on
 * its mask's Embody Aspect boost and its Tera-only Terastal forme.
 */
import { PRNG } from '../sim/prng';

/** Delay before a computer player answers a request, so a human can follow the battle. */
export const COMPUTER_CHOICE_DELAY_MS = 800;

/** How often the computer Terastallizes when it can (Pokemon in ALWAYS_TERA never wait). */
const TERA_CHANCE = [1, 4] as const;

/** Base species that always Terastallize the first chance they get. */
const ALWAYS_TERA = ['Ogerpon'];

/** Whether the active Pokemon is a Mega Evolution, i.e. it could Mega Evolve and so may never Terastallize. */
function isMega(request: AnyObject): boolean {
	const name: string = request.side?.pokemon?.[0]?.details?.split(',')[0] || '';
	return /-Mega(-|$)/.test(name);
}

/** Whether the active Pokemon is one of ALWAYS_TERA, from its `details` (e.g. "Ogerpon-Wellspring, L100, F"). */
function alwaysTeras(request: AnyObject): boolean {
	const name: string = request.side?.pokemon?.[0]?.details?.split(',')[0] || '';
	return ALWAYS_TERA.some(species => name === species || name.startsWith(`${species}-`));
}

/**
 * Returns the choice string to send for a (parsed) choice request, or null if no choice is needed.
 * The result is what would follow `>p2 ` in the simulator's input, e.g. `move 3` or `switch 2`.
 */
export function chooseComputerAction(request: AnyObject, prng: PRNG): string | null {
	if (request.wait) return null;

	const pokemon: AnyObject[] = request.side?.pokemon || [];
	const isFainted = (mon: AnyObject | undefined) => !mon || mon.condition.endsWith(' fnt');

	if (request.forceSwitch) {
		if (request.forceSwitch.length !== 1) return 'default';
		const options: number[] = [];
		for (const [i, mon] of pokemon.entries()) {
			if (i === 0 || isFainted(mon)) continue; // slot 0 is the active Pokemon
			options.push(i + 1);
		}
		return options.length ? `switch ${prng.sample(options)}` : 'default';
	}

	if (request.teamPreview) return 'default';

	if (request.active) {
		if (request.active.length !== 1) return 'default';
		const active = request.active[0];
		const moves: { move: string, disabled?: boolean }[] = active.moves || [];
		const usable: number[] = [];
		for (const [i, move] of moves.entries()) {
			if (!move.disabled) usable.push(i + 1);
		}
		if (!usable.length) return 'default';
		let choice = `move ${prng.sample(usable)}`;
		// A Pokemon that can Mega Evolve (or already has) never Terastallizes
		if (active.canMegaEvo) {
			choice += ' mega';
		} else if (active.canTerastallize && !isMega(request) &&
			(alwaysTeras(request) || prng.randomChance(...TERA_CHANCE))) {
			choice += ' terastallize';
		}
		return choice;
	}

	return 'default';
}
