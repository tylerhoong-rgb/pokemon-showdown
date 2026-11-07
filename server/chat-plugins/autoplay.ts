/**
 * Autoplay
 *
 * One-click battles against the computer.
 *
 *   /autoplay                  Play the computer. You choose your own moves.
 *   /autoplay watch            Watch the computer play itself (it chooses your moves too).
 *   /autoplay [format]         The same, in another random singles format.
 *
 * Lobby visitors also get a banner with a button for each, since the official client can't be changed
 * to add one. The computer's decision logic is in server/battle-bot.ts.
 */

const DEFAULT_FORMAT = 'gen9metronome1v1randombattle';
const COMPUTER_NAME = 'Computer';

function showsAutoplayBanner(room: BasicRoom) {
	return room.roomid === 'lobby';
}

export const commands: Chat.ChatCommands = {
	autoplay: 'vscomputer',
	vsbot: 'vscomputer',
	vscomputer(target, room, user) {
		let watch = false;
		let formatText = '';
		for (const arg of target.split(',').map(part => part.trim()).filter(Boolean)) {
			if (toID(arg) === 'watch') {
				watch = true;
			} else {
				formatText = arg;
			}
		}

		const format = Dex.formats.get(formatText || DEFAULT_FORMAT);
		if (!format.exists) {
			throw new Chat.ErrorMessage(`The format "${formatText}" does not exist. Try /formats to see what is available.`);
		}
		if (!format.team || format.gameType !== 'singles') {
			throw new Chat.ErrorMessage(
				`${format.name} can't be played against the computer. Only random singles formats can.`
			);
		}

		// Check that teams can be made first (e.g. a sets file that is still empty), so the user gets a clear message
		// instead of a battle that crashes as it starts
		try {
			Teams.generate(format.id);
		} catch (err: any) {
			throw new Chat.ErrorMessage(`${format.name} can't make teams right now: ${err.message}`);
		}

		const battleRoom = Rooms.createBattle({
			format: format.id,
			players: [
				// Random formats generate their teams when the battle starts, so the team is ''
				{ user, team: '', computer: watch },
				{ user: null, name: COMPUTER_NAME, team: '', computer: true },
			],
			rated: false,
			challengeType: 'unrated',
		});
		// createBattle already told the user why if it couldn't start a battle (e.g. the server is restarting)
		if (!battleRoom) return;
	},
	vscomputerhelp: [
		`/autoplay [format], [watch] - Starts a battle against the computer, in ${DEFAULT_FORMAT} unless you name another random singles format.`,
		`Add "watch" to let the computer choose your moves too, so you can just watch.`,
		`Aliases: /vscomputer, /vsbot`,
	],
};

export const handlers: Chat.Handlers = {
	onRoomJoin(room, user, connection) {
		if (!showsAutoplayBanner(room)) return;
		connection.sendTo(room, `|uhtml|autoplay|<div class="infobox" style="text-align: center">` +
			`<strong>Play the computer</strong><br />` +
			`<button class="button" name="send" value="/autoplay">Battle the computer</button> ` +
			`<button class="button" name="send" value="/autoplay watch">Watch the computer play</button>` +
			`</div>`);
	},
};
