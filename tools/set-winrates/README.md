# Set win rates

A local bot-vs-bot tester for **Metronome 1v1**. It plays battles between random sets from
`data/random-battles/gen9/metronome_sets.json` with the same computer player as `/autoplay`, and keeps a running
win/loss/tie record for every individual set.

```
node tools/set-winrates                  # play 1000 more battles, then show the table
node tools/set-winrates --games 5000     # play more
node tools/set-winrates --report         # just show the table, play nothing
node tools/set-winrates --reset          # forget all records
node tools/set-winrates --reset --games 2000   # forget them, then play 2000 fresh battles
```

Every run builds first, so it always tests the sets as they are in the file right now. It is safe to stop with
Ctrl+C: the battles in progress finish, the records are saved, and the table is shown. Records pile up across runs.

## Speed

Battles are shared between several threads, one per CPU core by default, and each thread plays roughly 100 battles a
second. That's about 1.7x as fast as a single thread on 2 cores, and more on a machine with more. `--workers N`
chooses the number of threads, and `--workers 1` plays on a single thread. Very short runs aren't split up, since each
thread takes a moment to load the simulator.

The results don't depend on the number of threads: for a given `--seed`, `--workers 1` and `--workers 8` end up with
exactly the same records.

## Reading the table

```
Species   Set        Games    W-L-T  Win rate  95% range
Garchomp  1/2 bulky    122  104-18-0     85.2%  77.9 to 90.5
Magikarp  1/1 joke     130  13-117-0     10.0%   5.9 to 16.4
```

- **Set** is its place within the species (`1/2` is the first of two) and its `role` label.
- **Win rate** counts a tie as half a win. A battle still going after 300 turns is stopped and counted as a tie.
- **95% range** is how far the true win rate could plausibly be from the number shown. It is wide for a set with few
  games and narrows as games pile up, so don't read much into a set until its range is tight.
- Each battle pairs two sets drawn evenly from all of the sets in the file, and **both** sides are recorded. So every
  set is measured against the same field, "all the sets in the file", and the overall win rate is always 50%. Read the
  numbers as how a set does relative to the others, not as an absolute strength. Note that this draws evenly over
  *sets*, so a species with several sets turns up more often than one with a single set. The real format picks the
  species first, so there each species is equally likely.
- A set's moves, ability, item and Tera type are re-rolled from its pools every battle, so a set's win rate is its
  average over everything it might roll.

## Changing sets and resetting

Each set's record is kept under the species plus a fingerprint of what the set does. You don't need to do anything
after editing the sets file:

- **Edit a set** (moves, ability, item, Tera types, EVs, IVs, nature, or the species' level) and it starts again from
  0 games. Every set you didn't touch keeps its record.
- **Change only a set's `role` label, or reorder the items in its lists,** and its record is kept.
- The old record of an edited or deleted set is kept but hidden, and the table says how many there are.

`--reset` throws away all of the records at once, which is what you want after changing something that isn't in the
sets file (the computer player, a move's data, the format's rules). The old file is saved next to it as `<name>.bak`,
so a slip isn't fatal. Only one backup is kept: resetting twice overwrites it.

Records live in `logs/set-winrates/<format>.json`, which git ignores.

## Options

| Option | |
| --- | --- |
| `--games N` | How many more battles to play (default 1000). |
| `--report` | Show the table without playing. |
| `--reset` | Forget every record first. On its own, it only resets. |
| `--format ID` | Another format. It must have exactly one Pokemon per player (`Max Team Size = 1`). |
| `--sets FILE` | Test the sets in `FILE` instead of the format's own sets file. |
| `--records FILE` | Keep the records in `FILE`, for example to compare two versions of your sets. |
| `--workers N` | How many threads to play on (default: one per CPU core). |
| `--seed N` | Make the pairings and the battles repeatable. |
| `--no-build` | Skip the build. Only for quick re-runs when nothing has changed. |

Any problem in the sets file (an unknown move, an empty file, ...) is reported up front, naming the set, before any
battle is played.
