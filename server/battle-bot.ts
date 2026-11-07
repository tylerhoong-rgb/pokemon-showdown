/**
 * Computer player
 *
 * The decision logic for computer-controlled players in a RoomBattle (see /autoplay in
 * chat-plugins/autoplay.ts and `RoomBattlePlayerOptions.computer` in room-battle.ts).
 *
 * It is intentionally simple: a random usable move, a random switch when forced to, and the
 * simulator's own default choice for anything it doesn't understand (doubles, team preview, ...).
 * Only singles formats are supported by /autoplay.
 */
import { PRNG } from '../sim/prng';

/** Delay before a computer player answers a request, so a human can follow the battle. */
export const COMPUTER_CHOICE_DELAY_MS = 800;

/** How often the computer Terastallizes when it can. */
const TERA_CHANCE = [1, 4] as const;

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
		if (active.canTerastallize && prng.randomChance(...TERA_CHANCE)) choice += ' terastallize';
		return choice;
	}

	return 'default';
}
