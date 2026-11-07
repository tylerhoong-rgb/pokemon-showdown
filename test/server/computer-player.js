/**
 * Tests for computer-controlled battle players (see server/battle-bot.ts and /autoplay)
 */

'use strict';

const assert = require('assert').strict;

const { makeUser } = require('../users-utils');

const PACKED_TEAM = 'Weavile||lifeorb||swordsdance,knockoff,iceshard,iciclecrash|Jolly|,252,,,4,252|||||';
const FORMAT = 'gen9customgame';

/** Resolves once the battle has ended, or fails after `ms`. `onTick` runs every few milliseconds meanwhile. */
async function untilEnded(battle, ms, onTick = () => {}) {
	const deadline = Date.now() + ms;
	while (!battle.ended) {
		if (Date.now() > deadline) assert.fail(`the battle had not ended after ${ms}ms (turn ${battle.turn})`);
		onTick();
		await new Promise(resolve => setTimeout(resolve, 5));
	}
}

describe('Computer players', function () {
	let user, other, room, oldDelay;
	before(() => {
		oldDelay = Config.computerchoicedelay;
		Config.computerchoicedelay = 0;
	});
	after(() => {
		Config.computerchoicedelay = oldDelay;
	});
	afterEach(() => {
		for (const u of [user, other]) {
			if (u) {
				u.disconnectAll();
				u.destroy();
			}
		}
		if (room) room.destroy();
		user = other = room = undefined;
	});

	it('should play a whole battle on both sides with no human input', async () => {
		user = makeUser('Watcher');
		room = Rooms.createBattle({
			format: FORMAT,
			players: [
				{ user, team: PACKED_TEAM, computer: true },
				{ user: null, name: 'Computer', team: PACKED_TEAM, computer: true },
			],
		});
		assert(room?.battle);
		await untilEnded(room.battle, 20000);
		assert(room.battle.score, 'the battle should have a result');
	});

	it('should answer a human opponent, using the name it was given', async () => {
		user = makeUser('Human');
		room = Rooms.createBattle({
			format: FORMAT,
			players: [
				{ user, team: PACKED_TEAM },
				{ user: null, name: 'Computer', team: PACKED_TEAM, computer: true },
			],
		});
		const battle = room.battle;
		assert(battle);
		assert.equal(battle.p2.name, 'Computer');
		assert.equal(battle.p2.computer, true);
		assert.equal(battle.p1.computer, false);
		assert(room.title.includes('Computer'), `room title was "${room.title}"`);

		// The human uses Knock Off every turn; the battle can only end if the computer answers every request
		await untilEnded(battle, 20000, () => {
			if (battle.p1.request.isWait === false) battle.choose(user, 'move 2');
		});
		assert(battle.turn > 0);
	});

	it('should not let anyone take over the computer\'s slot', () => {
		user = makeUser('Human');
		other = makeUser('Spectator');
		room = Rooms.createBattle({
			format: FORMAT,
			players: [
				{ user, team: PACKED_TEAM },
				{ user: null, name: 'Computer', team: PACKED_TEAM, computer: true },
			],
		});
		const battle = room.battle;
		room.auth.set(other.id, Users.PLAYER_SYMBOL);
		assert.equal(battle.joinGame(other, 'p2'), false);
		assert.equal(battle.joinGame(other), false);
		assert.equal(battle.playerTable[other.id], undefined);
		assert.equal(battle.p2.name, 'Computer');
	});

	it('should not be treated as disconnected by the battle timer', () => {
		user = makeUser('Human');
		room = Rooms.createBattle({
			format: FORMAT,
			players: [
				{ user, team: PACKED_TEAM },
				{ user: null, name: 'Computer', team: PACKED_TEAM, computer: true },
			],
		});
		assert.equal(room.battle.p2.active, true);
		assert.equal(room.battle.p2.knownActive, true);
	});
});
