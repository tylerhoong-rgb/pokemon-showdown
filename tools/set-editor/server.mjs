#!/usr/bin/env node
/**
 * Tiny zero-dependency server for the set editor. It serves the editor and lets it load/save the real
 * sets.json in place.
 *
 *   node tools/set-editor/server.mjs [path/to/sets.json] [--port 8765]
 *
 * Default file: data/random-battles/gen9/sets.json. Listens on 127.0.0.1 only.
 */
import * as http from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..', '..');

const args = process.argv.slice(2);
let port = 8765;
let file = path.join(root, 'data', 'random-battles', 'gen9', 'sets.json');
for (let i = 0; i < args.length; i++) {
	if (args[i] === '--port') port = Number(args[++i]);
	else file = path.resolve(args[i]);
}

const STATIC = {
	'/': ['index.html', 'text/html; charset=utf-8'],
	'/index.html': ['index.html', 'text/html; charset=utf-8'],
	'/format.js': ['format.js', 'text/javascript; charset=utf-8'],
	'/dex-data.js': ['dex-data.js', 'text/javascript; charset=utf-8'],
};

const server = http.createServer((req, res) => {
	const url = new URL(req.url, 'http://localhost');
	const send = (code, body, type = 'text/plain; charset=utf-8') => {
		res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store' });
		res.end(body);
	};
	// Only accept requests addressed to localhost (guards against DNS-rebinding)
	const host = (req.headers.host || '').replace(/:\d+$/, '');
	if (host !== 'localhost' && host !== '127.0.0.1') return send(403, 'Forbidden');

	if (req.method === 'GET' && STATIC[url.pathname]) {
		const [name, type] = STATIC[url.pathname];
		try {
			return send(200, fs.readFileSync(path.join(here, name)), type);
		} catch {
			return send(404, `Missing ${name}` + (name === 'dex-data.js' ? ' - run: node tools/set-editor/build-data.mts' : ''));
		}
	}
	if (url.pathname === '/api/sets') {
		if (req.method === 'GET') {
			try {
				return send(200, JSON.stringify({ file: path.relative(root, file), text: fs.readFileSync(file, 'utf8') }), 'application/json');
			} catch (e) {
				return send(500, `Could not read ${file}: ${e.message}`);
			}
		}
		if (req.method === 'PUT') {
			// Custom header: a page on another origin can't send it without a CORS preflight, which we never grant.
			if (req.headers['x-set-editor'] !== '1') return send(403, 'Forbidden');
			const chunks = [];
			let size = 0;
			req.on('data', c => {
				size += c.length;
				if (size > 20e6) req.destroy();
				else chunks.push(c);
			});
			req.on('end', () => {
				const text = Buffer.concat(chunks).toString('utf8');
				try {
					const parsed = JSON.parse(text);
					if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('Top level must be an object');
				} catch (e) {
					return send(400, 'Invalid JSON: ' + e.message);
				}
				try {
					fs.writeFileSync(file + '.tmp', text);
					fs.renameSync(file + '.tmp', file);
				} catch (e) {
					return send(500, 'Write failed: ' + e.message);
				}
				send(200, JSON.stringify({ ok: true, bytes: text.length }), 'application/json');
			});
			return;
		}
	}
	send(404, 'Not found');
});

server.listen(port, '127.0.0.1', () => {
	console.log(`Set editor:  http://localhost:${port}`);
	console.log(`Editing:     ${path.relative(process.cwd(), file) || file}`);
});
