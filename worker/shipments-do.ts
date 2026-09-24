import { DurableObject } from "cloudflare:workers";
import type {
	Batch,
	BatchSource,
	BatchStatus,
	Candidate,
	ConfirmedGuide,
	Photo,
	PhotoAnalysis,
	ServerMessage,
} from "./types";

const LIST_LIMIT = 50;

export class BatchStateError extends Error {}

/**
 * ShipmentsDO - fuente de verdad de los lotes de fotos.
 *
 * Hay una sola instancia ("global"): el volumen es de decenas de lotes al día,
 * así que un solo objeto simplifica el listado y permite que todas las
 * pantallas (teléfono, escritorio, hot folder) vean los mismos lotes en vivo.
 *
 * - Guarda cada lote como JSON en SQLite.
 * - Valida las transiciones de estado (p. ej. no se aceptan fotos en un lote
 *   cerrado, que es lo que evita mezclar lotes).
 * - Transmite cada cambio a los WebSockets conectados.
 */
export class ShipmentsDO extends DurableObject<Env> {
	constructor(ctx: DurableObjectState, env: Env) {
		super(ctx, env);
		ctx.storage.sql.exec(`
			CREATE TABLE IF NOT EXISTS batches (
				id TEXT PRIMARY KEY,
				created_at INTEGER NOT NULL,
				data TEXT NOT NULL
			)
		`);
	}

	async fetch(request: Request): Promise<Response> {
		if (request.headers.get("Upgrade") !== "websocket") {
			return new Response("Expected WebSocket", { status: 400 });
		}
		const pair = new WebSocketPair();
		const [client, server] = Object.values(pair);
		this.ctx.acceptWebSocket(server);
		server.send(
			JSON.stringify({
				type: "snapshot",
				batches: this.listBatches(),
			} satisfies ServerMessage),
		);
		return new Response(null, { status: 101, webSocket: client });
	}

	async webSocketMessage(ws: WebSocket): Promise<void> {
		// Cualquier mensaje del cliente pide un snapshot fresco.
		ws.send(
			JSON.stringify({
				type: "snapshot",
				batches: this.listBatches(),
			} satisfies ServerMessage),
		);
	}

	async webSocketClose(ws: WebSocket, code: number, reason: string) {
		ws.close(code, reason);
	}

	// ---------------------------------------------------------------- lectura

	getBatch(id: string): Batch | null {
		const row = this.ctx.storage.sql
			.exec<{ data: string }>("SELECT data FROM batches WHERE id = ?", id)
			.toArray()[0];
		return row ? (JSON.parse(row.data) as Batch) : null;
	}

	listBatches(): Batch[] {
		return this.ctx.storage.sql
			.exec<{
				data: string;
			}>("SELECT data FROM batches ORDER BY created_at DESC LIMIT ?", LIST_LIMIT)
			.toArray()
			.map((row) => JSON.parse(row.data) as Batch);
	}

	// ------------------------------------------------------ acciones del usuario

	createBatch(id: string, source: BatchSource): Batch {
		const now = Date.now();
		const batch: Batch = {
			id,
			source,
			status: "uploading",
			createdAt: now,
			updatedAt: now,
			photos: [],
			candidates: [],
			guide: null,
			pdfKey: null,
			pdfName: null,
			error: null,
		};
		this.ctx.storage.sql.exec(
			"INSERT INTO batches (id, created_at, data) VALUES (?, ?, ?)",
			id,
			now,
			JSON.stringify(batch),
		);
		this.broadcast(batch);
		return batch;
	}

	addPhoto(id: string, photo: Photo): Batch {
		return this.mutate(id, ["uploading"], (b) => {
			b.photos.push(photo);
		});
	}

	/** Cierra el lote: ya no acepta fotos y pasa a análisis. */
	closeBatch(id: string): Batch {
		return this.mutate(id, ["uploading"], (b) => {
			if (b.photos.length === 0) {
				throw new BatchStateError("El lote no tiene fotos");
			}
			b.status = "analyzing";
		});
	}

	/** Borra un lote abierto (por ejemplo, si se subieron fotos equivocadas). */
	discardBatch(id: string): Photo[] {
		const batch = this.requireBatch(id, ["uploading", "error"]);
		this.ctx.storage.sql.exec("DELETE FROM batches WHERE id = ?", id);
		this.broadcastSnapshot();
		return batch.photos;
	}

	markConfirmed(id: string, guide: ConfirmedGuide): Batch {
		return this.mutate(id, ["awaiting_confirmation"], (b) => {
			b.guide = guide;
			b.status = "generating";
		});
	}

	// ------------------------------------------------ llamadas desde el workflow

	setPhotoAnalysis(
		id: string,
		photoId: string,
		analysis: PhotoAnalysis | null,
		error?: string,
	): Batch {
		return this.mutate(id, null, (b) => {
			const photo = b.photos.find((p) => p.id === photoId);
			if (!photo) return;
			if (analysis) photo.analysis = analysis;
			photo.analysisError = error;
		});
	}

	setCandidates(id: string, candidates: Candidate[]): Batch {
		return this.mutate(id, null, (b) => {
			b.candidates = candidates;
			if (b.status === "analyzing") b.status = "awaiting_confirmation";
		});
	}

	complete(
		id: string,
		guide: ConfirmedGuide,
		pdfKey: string,
		pdfName: string,
	): Batch {
		return this.mutate(id, null, (b) => {
			b.guide = guide;
			b.pdfKey = pdfKey;
			b.pdfName = pdfName;
			b.status = "completed";
			b.error = null;
		});
	}

	fail(id: string, message: string): Batch {
		return this.mutate(id, null, (b) => {
			b.status = "error";
			b.error = message;
		});
	}

	// ---------------------------------------------------------------- helpers

	private requireBatch(id: string, allowed: BatchStatus[] | null): Batch {
		const batch = this.getBatch(id);
		if (!batch) throw new BatchStateError("Lote no encontrado");
		if (allowed && !allowed.includes(batch.status)) {
			throw new BatchStateError(
				`El lote está en estado "${batch.status}" y no admite esta acción`,
			);
		}
		return batch;
	}

	private mutate(
		id: string,
		allowed: BatchStatus[] | null,
		fn: (batch: Batch) => void,
	): Batch {
		const batch = this.requireBatch(id, allowed);
		fn(batch);
		batch.updatedAt = Date.now();
		this.ctx.storage.sql.exec(
			"UPDATE batches SET data = ? WHERE id = ?",
			JSON.stringify(batch),
			id,
		);
		this.broadcast(batch);
		return batch;
	}

	private broadcast(batch: Batch) {
		this.send({ type: "batch", batch });
	}

	private broadcastSnapshot() {
		this.send({ type: "snapshot", batches: this.listBatches() });
	}

	private send(message: ServerMessage) {
		const json = JSON.stringify(message);
		for (const socket of this.ctx.getWebSockets()) {
			try {
				socket.send(json);
			} catch {
				// socket desconectado
			}
		}
	}
}
