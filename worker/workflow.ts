import { WorkflowEntrypoint, WorkflowStep } from "cloudflare:workers";
import type { WorkflowEvent } from "cloudflare:workers";
import { NonRetryableError } from "cloudflare:workflows";
import type { ConfirmedGuide, Photo, PhotoAnalysis } from "./types";
import { analyzePhoto } from "./ai";
import { buildBatchPdf } from "./pdf";
import { detectImageType } from "./lib/image";
import { rankCandidates, toFileName } from "./lib/guide";

export interface BatchParams {
	batchId: string;
	/** Origen público de la app, para armar el enlace al PDF. */
	origin: string;
}

export const GUIDE_CONFIRMED_EVENT = "guide-confirmed";
const CONFIRMATION_TIMEOUT = "7 days";

export function shipmentsStub(env: Env) {
	return env.SHIPMENTS.get(env.SHIPMENTS.idFromName("global"));
}

/**
 * Procesa un lote cerrado de fotos:
 *
 * 1. Analiza cada foto con IA (un paso durable por foto, con reintentos).
 * 2. Ordena los posibles números de guía / factura.
 * 3. Se pausa hasta que una persona confirma la guía (step.waitForEvent).
 * 4. Genera el PDF tamaño carta con todas las fotos y lo guarda en R2.
 * 5. Avisa al flujo de envíos (webhook opcional).
 */
export class PackageBatchWorkflow extends WorkflowEntrypoint<Env, BatchParams> {
	async run(event: WorkflowEvent<BatchParams>, step: WorkflowStep) {
		const { batchId, origin } = event.payload;
		const stub = () => shipmentsStub(this.env);

		try {
			const photos = await step.do("load batch", async () => {
				const batch = await stub().getBatch(batchId);
				if (!batch) throw new NonRetryableError(`Lote ${batchId} no encontrado`);
				return batch.photos.map(({ id, key, name, contentType }) => ({
					id,
					key,
					name,
					contentType,
				}));
			});

			// 1. Analizar cada foto
			const analyzed: Photo[] = [];
			for (const photo of photos) {
				let analysis: PhotoAnalysis | null = null;
				let error: string | undefined;
				try {
					analysis = await step.do(
						`analyze ${photo.id}`,
						{
							retries: { limit: 3, delay: "5 seconds", backoff: "exponential" },
							timeout: "2 minutes",
						},
						async () => {
							const object = await this.env.PHOTOS.get(photo.key);
							if (!object) throw new NonRetryableError("Foto no encontrada en R2");
							const bytes = new Uint8Array(await object.arrayBuffer());
							return analyzePhoto(this.env, bytes, photo.contentType);
						},
					);
				} catch (err) {
					// Una foto ilegible no detiene el lote: la persona puede capturar
					// la guía a mano en la confirmación.
					error = err instanceof Error ? err.message : String(err);
				}
				await step.do(`save analysis ${photo.id}`, async () => {
					await stub().setPhotoAnalysis(batchId, photo.id, analysis, error);
				});
				analyzed.push({
					...photo,
					size: 0,
					uploadedAt: 0,
					analysis: analysis ?? undefined,
				});
			}

			// 2. Proponer candidatos y pedir confirmación
			const candidates = rankCandidates(analyzed);
			await step.do("save candidates", async () => {
				await stub().setCandidates(batchId, candidates);
			});

			// 3. Esperar a que una persona confirme el número de guía
			let guide: ConfirmedGuide;
			try {
				const confirmation = await step.waitForEvent<ConfirmedGuide>(
					"wait for guide confirmation",
					{ type: GUIDE_CONFIRMED_EVENT, timeout: CONFIRMATION_TIMEOUT },
				);
				guide = confirmation.payload;
			} catch {
				throw new Error(`Nadie confirmó la guía en ${CONFIRMATION_TIMEOUT}`);
			}

			// 4. Generar el PDF
			const pdf = await step.do(
				"generate pdf",
				{ retries: { limit: 2, delay: "5 seconds" }, timeout: "5 minutes" },
				async () => {
					const ordered = [
						...photos.filter((p) => p.id === guide.sourcePhotoId),
						...photos.filter((p) => p.id !== guide.sourcePhotoId),
					];
					const images = [];
					for (const photo of ordered) {
						const object = await this.env.PHOTOS.get(photo.key);
						if (object) {
							images.push({
								name: photo.name,
								bytes: new Uint8Array(await object.arrayBuffer()),
							});
						}
					}

					const bytes = await buildBatchPdf({
						batchId,
						guide,
						photos: images,
						logo: await loadLogo(this.env),
						generatedAt: new Date(),
						timeZone: this.env.TIMEZONE || "America/Mexico_City",
					});

					const fileName = `${toFileName(guide.guideNumber, batchId)}.pdf`;
					const key = `pdfs/${batchId}/${fileName}`;
					await this.env.PHOTOS.put(key, bytes, {
						httpMetadata: { contentType: "application/pdf" },
						customMetadata: {
							batchId,
							guideNumber: guide.guideNumber,
							carrier: guide.carrier ?? "",
							invoiceNumber: guide.invoiceNumber ?? "",
						},
					});
					return { key, fileName };
				},
			);

			// 5. Flujo complementario de envíos (opcional)
			const webhook = this.env.SHIPMENTS_WEBHOOK_URL;
			if (webhook) {
				try {
					await step.do(
						"notify shipments flow",
						{ retries: { limit: 5, delay: "30 seconds", backoff: "exponential" } },
						async () => {
							const res = await fetch(webhook, {
								method: "POST",
								headers: {
									"Content-Type": "application/json",
									...(this.env.SHIPMENTS_WEBHOOK_TOKEN
										? { Authorization: `Bearer ${this.env.SHIPMENTS_WEBHOOK_TOKEN}` }
										: {}),
								},
								body: JSON.stringify({
									event: "shipment.evidence_ready",
									batchId,
									guideNumber: guide.guideNumber,
									carrier: guide.carrier,
									invoiceNumber: guide.invoiceNumber,
									photoCount: photos.length,
									pdfName: pdf.fileName,
									pdfUrl: `${origin}/api/batches/${batchId}/pdf`,
								}),
							});
							if (!res.ok) throw new Error(`Webhook respondió ${res.status}`);
						},
					);
				} catch (err) {
					// El PDF ya existe; un fallo del webhook no invalida el lote.
					console.error("No se pudo notificar al flujo de envíos", err);
				}
			}

			await step.do("mark completed", async () => {
				await stub().complete(batchId, guide, pdf.key, pdf.fileName);
			});

			return { batchId, guide, pdf };
		} catch (err) {
			const message = err instanceof Error ? err.message : String(err);
			await step.do("mark error", async () => {
				await stub().fail(batchId, message);
			});
			throw err;
		}
	}
}

/** Busca /logo.png o /logo.jpg entre los assets estáticos (carpeta public/). */
async function loadLogo(env: Env): Promise<Uint8Array | null> {
	for (const path of ["/logo.png", "/logo.jpg"]) {
		try {
			const res = await env.ASSETS.fetch(new Request(`https://assets.local${path}`));
			if (!res.ok) continue;
			const bytes = new Uint8Array(await res.arrayBuffer());
			// Con SPA fallback una ruta inexistente regresa index.html
			if (detectImageType(bytes)) return bytes;
		} catch {
			// sin logo: se dibuja el logotipo en texto
		}
	}
	return null;
}
