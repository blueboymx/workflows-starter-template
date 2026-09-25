import { isPhotosPerPage, type BatchSource, type ConfirmedGuide, type Photo } from "./types";
import { detectImageType } from "./lib/image";
import { GUIDE_CONFIRMED_EVENT, shipmentsStub } from "./workflow";

export { PackageBatchWorkflow } from "./workflow";
export { ShipmentsDO } from "./shipments-do";

const MAX_PHOTO_BYTES = 20 * 1024 * 1024;

/**
 * API de lotes de fotos de envíos:
 *
 * - GET    /api/batches                      Últimos lotes
 * - POST   /api/batches                      Abre un lote nuevo
 * - GET    /api/batches/:id                  Detalle
 * - POST   /api/batches/:id/photos           Sube fotos (multipart, campo "photos")
 * - POST   /api/batches/:id/close            Ya no hay más fotos: inicia el workflow
 * - POST   /api/batches/:id/confirm          Confirma el número de guía
 * - DELETE /api/batches/:id                  Descarta un lote abierto
 * - GET    /api/batches/:id/pdf              Descarga el PDF
 * - GET    /api/batches/:id/photos/:photoId  Imagen original
 * - GET    /ws                               Actualizaciones en vivo
 */
export default {
	async fetch(request: Request, env: Env): Promise<Response> {
		const url = new URL(request.url);
		const parts = url.pathname.split("/").filter(Boolean);
		const method = request.method;

		try {
			if (url.pathname === "/ws") {
				if (request.headers.get("Upgrade") !== "websocket") {
					return new Response("Expected Upgrade: websocket", { status: 426 });
				}
				return shipmentsStub(env).fetch(request);
			}

			if (parts[0] !== "api" || parts[1] !== "batches") {
				return json({ error: "No encontrado" }, 404);
			}

			const [, , batchId, sub, subId] = parts;

			if (!batchId) {
				if (method === "GET") return json(await shipmentsStub(env).listBatches());
				if (method === "POST") return createBatch(request, env);
			} else if (!sub) {
				if (method === "GET") return getBatch(env, batchId);
				if (method === "DELETE") return discardBatch(env, batchId);
			} else if (sub === "photos") {
				if (method === "POST" && !subId) return uploadPhotos(request, env, batchId);
				if (method === "GET" && subId) return getPhoto(env, batchId, subId);
			} else if (sub === "close" && method === "POST") {
				return closeBatch(env, batchId, url.origin);
			} else if (sub === "confirm" && method === "POST") {
				return confirmGuide(request, env, batchId);
			} else if (sub === "pdf" && method === "GET") {
				return getPdf(env, batchId);
			}

			return json({ error: "No encontrado" }, 404);
		} catch (err) {
			// Los errores de validación del Durable Object llegan por RPC
			const message = err instanceof Error ? err.message : "Error inesperado";
			console.error(err);
			return json({ error: message }, 409);
		}
	},
} satisfies ExportedHandler<Env>;

function json(data: unknown, status = 200): Response {
	return Response.json(data, { status });
}

function newBatchId(timeZone: string): string {
	// en-CA da el formato AAAA-MM-DD
	const date = new Date()
		.toLocaleDateString("en-CA", { timeZone })
		.replaceAll("-", "");
	const random = crypto.randomUUID().replaceAll("-", "").slice(0, 6);
	return `${date}-${random}`;
}

async function createBatch(request: Request, env: Env) {
	const body = (await request.json().catch(() => ({}))) as { source?: string };
	const source: BatchSource = body.source === "hot-folder" ? "hot-folder" : "web";
	const id = newBatchId(env.TIMEZONE || "America/Mexico_City");
	return json(await shipmentsStub(env).createBatch(id, source), 201);
}

async function getBatch(env: Env, batchId: string) {
	const batch = await shipmentsStub(env).getBatch(batchId);
	return batch ? json(batch) : json({ error: "Lote no encontrado" }, 404);
}

async function uploadPhotos(request: Request, env: Env, batchId: string) {
	const stub = shipmentsStub(env);
	const batch = await stub.getBatch(batchId);
	if (!batch) return json({ error: "Lote no encontrado" }, 404);
	if (batch.status !== "uploading") {
		return json({ error: "Este lote ya se cerró; abre uno nuevo" }, 409);
	}

	const form = await request.formData();
	const files = form.getAll("photos").filter((f): f is File => f instanceof File);
	if (files.length === 0) return json({ error: "No se recibieron fotos" }, 400);

	const added: Photo[] = [];
	const rejected: { name: string; reason: string }[] = [];

	for (const file of files) {
		if (file.size > MAX_PHOTO_BYTES) {
			rejected.push({ name: file.name, reason: "Supera 20 MB" });
			continue;
		}
		const bytes = new Uint8Array(await file.arrayBuffer());
		const contentType = detectImageType(bytes);
		if (!contentType) {
			rejected.push({ name: file.name, reason: "Sólo se aceptan JPG o PNG" });
			continue;
		}
		const id = crypto.randomUUID().replaceAll("-", "").slice(0, 12);
		const key = `batches/${batchId}/${id}.${contentType === "image/png" ? "png" : "jpg"}`;
		await env.PHOTOS.put(key, bytes, { httpMetadata: { contentType } });

		const photo: Photo = {
			id,
			key,
			name: file.name || `${id}.jpg`,
			contentType,
			size: bytes.byteLength,
			uploadedAt: Date.now(),
		};
		try {
			await stub.addPhoto(batchId, photo);
			added.push(photo);
		} catch (err) {
			// El lote se cerró mientras subíamos: no dejamos la foto huérfana
			await env.PHOTOS.delete(key);
			throw err;
		}
	}

	return json({ added, rejected, batch: await stub.getBatch(batchId) });
}

async function closeBatch(env: Env, batchId: string, origin: string) {
	const stub = shipmentsStub(env);
	const batch = await stub.closeBatch(batchId);
	try {
		await env.PACKAGE_WORKFLOW.create({ id: batchId, params: { batchId, origin } });
	} catch (err) {
		await stub.fail(batchId, "No se pudo iniciar el procesamiento");
		throw err;
	}
	return json(batch);
}

async function confirmGuide(request: Request, env: Env, batchId: string) {
	const body = (await request.json().catch(() => null)) as Partial<ConfirmedGuide> | null;
	const clean = (v: unknown) =>
		typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null;
	const guideNumber = clean(body?.guideNumber);
	if (!guideNumber) return json({ error: "Captura el número de guía" }, 400);

	const guide: ConfirmedGuide = {
		guideNumber,
		carrier: clean(body?.carrier),
		invoiceNumber: clean(body?.invoiceNumber),
		sourcePhotoId: clean(body?.sourcePhotoId),
		photosPerPage: isPhotosPerPage(body?.photosPerPage) ? body.photosPerPage : null,
	};

	const stub = shipmentsStub(env);
	const batch = await stub.getBatch(batchId);
	if (!batch) return json({ error: "Lote no encontrado" }, 404);
	if (batch.status !== "awaiting_confirmation") {
		return json({ error: "El lote no está esperando confirmación" }, 409);
	}

	const instance = await env.PACKAGE_WORKFLOW.get(batchId);
	await instance.sendEvent({ type: GUIDE_CONFIRMED_EVENT, payload: guide });
	return json(await stub.markConfirmed(batchId, guide));
}

async function discardBatch(env: Env, batchId: string) {
	const photos = await shipmentsStub(env).discardBatch(batchId);
	if (photos.length) await env.PHOTOS.delete(photos.map((p) => p.key));
	return json({ ok: true });
}

async function getPdf(env: Env, batchId: string) {
	const batch = await shipmentsStub(env).getBatch(batchId);
	if (!batch?.pdfKey) return json({ error: "PDF no disponible" }, 404);
	const object = await env.PHOTOS.get(batch.pdfKey);
	if (!object) return json({ error: "PDF no encontrado" }, 404);
	const name = batch.pdfName ?? `${batchId}.pdf`;
	return new Response(object.body, {
		headers: {
			"Content-Type": "application/pdf",
			"Content-Disposition": `inline; filename="${name}"; filename*=UTF-8''${encodeURIComponent(name)}`,
		},
	});
}

async function getPhoto(env: Env, batchId: string, photoId: string) {
	const batch = await shipmentsStub(env).getBatch(batchId);
	const photo = batch?.photos.find((p) => p.id === photoId);
	if (!photo) return json({ error: "Foto no encontrada" }, 404);
	const object = await env.PHOTOS.get(photo.key);
	if (!object) return json({ error: "Foto no encontrada" }, 404);
	return new Response(object.body, {
		headers: {
			"Content-Type": photo.contentType,
			"Cache-Control": "private, max-age=86400, immutable",
		},
	});
}
