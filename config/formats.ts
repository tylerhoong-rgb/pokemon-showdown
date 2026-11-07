// Note: This is the list of formats
// The rules that formats use are stored in data/rulesets.ts

export const Formats: import('../sim/dex-formats').FormatList = [

	{
		section: "Randomized Battles",
	},
	{
		name: "[Gen 9] Random Battle",
		desc: `Randomized teams of Pok&eacute;mon with sets that are generated to be competitively viable.`,
		mod: 'gen9',
		team: 'random',
		bestOfDefault: true,
		ruleset: ['PotD', 'Obtainable', 'Species Clause', 'HP Percentage Mod', 'Cancel Mod', 'Sleep Clause Mod', 'Illusion Level Mod'],
	},
	{
		name: "[Gen 9] Metronome 1v1 Random Battle",
		desc: `1v1 with random sets from data/random-battles/gen9/metronome_sets.json. Type /autoplay to play the computer in one click.`,
		mod: 'gen9',
		team: 'randomMetronome1v1',
		ruleset: ['HP Percentage Mod', 'Cancel Mod', 'Sleep Clause Mod', 'Max Team Size = 1'],
	},
];
