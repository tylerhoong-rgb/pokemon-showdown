# Set editor

A visual editor for `data/random-battles/gen9/sets.json`.

```
node tools/set-editor/server.mjs            # edits data/random-battles/gen9/sets.json
node tools/set-editor/server.mjs path/to/other-sets.json --port 9000
```

Then open the printed address (default http://localhost:8765). **Ctrl+S** saves straight to the file.

You can also open `index.html` directly in Chrome/Edge and use **Open…** (saves in place via the browser's file access),
or in any other browser (Save downloads the file instead).

- Autocomplete for moves, abilities, items and species, generated from this repo's `data/` files.
- Saving keeps the file's compact formatting, so git diffs only show what you changed.
- Checks for unknown names, EVs over 252/510, empty movepools/abilities, and abilities the species doesn't have.
- Undo/redo (Ctrl+Z / Ctrl+Shift+Z) and a **{ } JSON** preview of exactly what will be written.

After adding moves/items/abilities/species to `data/`, refresh the autocomplete lists with:

```
node tools/set-editor/build-data.mts
```
