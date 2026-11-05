/**
 * Serializer that writes sets.json in the file's existing style, so saving from the editor
 * produces minimal git diffs:
 *   - 4-space indent for species, "sets" and each set's fields
 *   - arrays and objects *inside* a set (movepool, evs, ...) on one line: ["A", "B"], {"HP": 252}
 * Works in the browser (window.SetFormat) and in Node (require).
 */
(function (root) {
	const IND = '    ';
	const inline = v => {
		if (Array.isArray(v)) return '[' + v.map(inline).join(', ') + ']';
		if (v && typeof v === 'object') {
			return '{' + Object.entries(v).map(([k, x]) => JSON.stringify(k) + ': ' + inline(x)).join(', ') + '}';
		}
		return JSON.stringify(v);
	};
	function serialize(data) {
		const speciesIds = Object.keys(data);
		if (!speciesIds.length) return '{}\n';
		const out = speciesIds.map(id => {
			const sp = data[id];
			const lines = [];
			for (const [k, v] of Object.entries(sp)) {
				if (k !== 'sets') { lines.push(IND + IND + JSON.stringify(k) + ': ' + inline(v)); continue; }
				if (!v.length) { lines.push(IND + IND + '"sets": []'); continue; }
				const sets = v.map(set => {
					const f = Object.entries(set).map(([sk, sv]) => IND.repeat(4) + JSON.stringify(sk) + ': ' + inline(sv));
					return IND.repeat(3) + '{\n' + f.join(',\n') + '\n' + IND.repeat(3) + '}';
				});
				lines.push(IND + IND + '"sets": [\n' + sets.join(',\n') + '\n' + IND + IND + ']');
			}
			return IND + JSON.stringify(id) + ': {\n' + lines.join(',\n') + '\n' + IND + '}';
		});
		return '{\n' + out.join(',\n') + '\n}\n';
	}
	const api = { serialize };
	if (typeof module !== 'undefined' && module.exports) module.exports = api;
	else root.SetFormat = api;
})(typeof window !== 'undefined' ? window : this);
