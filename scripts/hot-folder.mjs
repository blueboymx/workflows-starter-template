#!/usr/bin/env node
/**
 * Hot folder de evidencia de envíos.
 *
 * Vigila una carpeta. Cada SUBCARPETA es un lote (un envío): pon ahí las fotos
 * de ese paquete. Cuando la subcarpeta deja de cambiar durante --settle
 * segundos, se suben sus fotos, se cierra el lote y la subcarpeta se mueve a
 * _procesados/. La confirmación de la guía se hace en la app web.
 *
 * Uso:
 *   node scripts/hot-folder.mjs --url https://evidencia-envios.<cuenta>.workers.dev --dir ./hotfolder
 *
 * Opciones:
 *   --settle <seg>   Segundos sin cambios antes de subir (default 20)
 *   --interval <seg> Cada cuánto revisar la carpeta (default 5)
 *
 * Si la app está protegida con Cloudflare Access, define CF_ACCESS_CLIENT_ID y
 * CF_ACCESS_CLIENT_SECRET (service token).
 *
 * Sólo usa módulos de Node 18+; no requiere npm install.
 */
import { readdir, stat, readFile, rename, mkdir } from "node:fs/promises";
import { join, extname, resolve } from "node:path";

const args = Object.fromEntries(
	process.argv.slice(2).reduce((acc, cur, i, all) => {
		if (cur.startsWith("--")) acc.push([cur.slice(2), all[i + 1]]);
		return acc;
	}, []),
);

const BASE_URL = (args.url || process.env.EVIDENCIA_URL || "").replace(/\/$/, "");
const DIR = resolve(args.dir || "./hotfolder");
const SETTLE_MS = Number(args.settle || 20) * 1000;
const INTERVAL_MS = Number(args.interval || 5) * 1000;
const DONE_DIR = join(DIR, "_procesados");
const ERROR_DIR = join(DIR, "_errores");
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png"]);

if (!BASE_URL) {
	console.error("Falta --url (o la variable EVIDENCIA_URL)");
	process.exit(1);
}

const headers = {};
if (process.env.CF_ACCESS_CLIENT_ID) {
	headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
	headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET ?? "";
}

async function api(path, init = {}) {
	const res = await fetch(`${BASE_URL}${path}`, {
		...init,
		headers: { ...headers, ...init.headers },
	});
	const body = await res.json().catch(() => ({}));
	if (!res.ok) throw new Error(body.error || `HTTP ${res.status} en ${path}`);
	return body;
}

/** Firma de la carpeta: cambia si se agrega, quita o sigue copiando un archivo. */
async function signature(folder) {
	const entries = await readdir(folder, { withFileTypes: true });
	const parts = [];
	for (const e of entries) {
		if (!e.isFile()) continue;
		const s = await stat(join(folder, e.name));
		parts.push(`${e.name}:${s.size}:${s.mtimeMs}`);
	}
	return parts.sort().join("|");
}

async function processFolder(name) {
	const folder = join(DIR, name);
	const files = (await readdir(folder, { withFileTypes: true }))
		.filter((e) => e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase()))
		.map((e) => e.name)
		.sort();

	if (files.length === 0) {
		console.warn(`[${name}] sin fotos JPG/PNG; se ignora`);
		return;
	}

	const batch = await api("/api/batches", {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ source: "hot-folder" }),
	});
	console.log(`[${name}] lote ${batch.id}: subiendo ${files.length} fotos`);

	for (const file of files) {
		const form = new FormData();
		const bytes = await readFile(join(folder, file));
		form.append("photos", new Blob([bytes]), file);
		const res = await api(`/api/batches/${batch.id}/photos`, { method: "POST", body: form });
		for (const r of res.rejected) console.warn(`[${name}] rechazada ${r.name}: ${r.reason}`);
	}

	await api(`/api/batches/${batch.id}/close`, { method: "POST" });
	await mkdir(DONE_DIR, { recursive: true });
	await rename(folder, join(DONE_DIR, `${name}__${batch.id}`));
	console.log(`[${name}] lote ${batch.id} cerrado; confirma la guía en ${BASE_URL}`);
}

const seen = new Map(); // carpeta -> { sig, since }
let running = false;

async function tick() {
	if (running) return;
	running = true;
	try {
		await scan();
	} finally {
		running = false;
	}
}

async function scan() {
	let entries;
	try {
		entries = await readdir(DIR, { withFileTypes: true });
	} catch (err) {
		console.error(`No se puede leer ${DIR}: ${err.message}`);
		return;
	}

	const loose = entries.filter((e) => e.isFile() && IMAGE_EXT.has(extname(e.name).toLowerCase()));
	if (loose.length) {
		console.warn(
			`Hay ${loose.length} fotos sueltas en ${DIR}. Ponlas dentro de una subcarpeta por envío.`,
		);
	}

	for (const e of entries) {
		if (!e.isDirectory() || e.name.startsWith("_") || e.name.startsWith(".")) continue;

		const sig = await signature(join(DIR, e.name)).catch(() => null);
		if (sig === null) continue;
		const prev = seen.get(e.name);
		if (!prev || prev.sig !== sig) {
			seen.set(e.name, { sig, since: Date.now() });
			continue;
		}
		if (Date.now() - prev.since < SETTLE_MS) continue;

		try {
			await processFolder(e.name);
		} catch (err) {
			console.error(`[${e.name}] error: ${err.message}`);
			await mkdir(ERROR_DIR, { recursive: true });
			await rename(join(DIR, e.name), join(ERROR_DIR, `${e.name}__${Date.now()}`)).catch(() => {});
		} finally {
			seen.delete(e.name);
		}
	}
}

await mkdir(DIR, { recursive: true });
console.log(`Vigilando ${DIR} → ${BASE_URL} (espera ${SETTLE_MS / 1000}s sin cambios por lote)`);
await tick();
setInterval(tick, INTERVAL_MS);
