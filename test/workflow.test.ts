import { SELF, env, introspectWorkflowInstance } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { PDFDocument } from "pdf-lib";
import type { Batch, PhotoAnalysis } from "../worker/types";
import { TINY_JPEG, TINY_PNG } from "./fixtures";

const api = (path: string, init?: RequestInit) =>
	SELF.fetch(`https://example.com${path}`, init);

async function createBatchWithPhotos() {
	const batch = (await (await api("/api/batches", { method: "POST" })).json()) as Batch;
	const form = new FormData();
	form.append("photos", new File([TINY_JPEG], "caja.jpg"));
	form.append("photos", new File([TINY_PNG], "guia.png"));
	form.append("photos", new File(["hola"], "notas.txt"));
	const res = await api(`/api/batches/${batch.id}/photos`, { method: "POST", body: form });
	const body = (await res.json()) as { batch: Batch; rejected: unknown[] };
	return { res, ...body };
}

const getBatch = async (id: string) =>
	(await (await api(`/api/batches/${id}`)).json()) as Batch;

const analysis = (a: Partial<PhotoAnalysis>): PhotoAnalysis => ({
	kind: "otro",
	trackingNumber: null,
	carrier: null,
	invoiceNumber: null,
	confidence: 0.9,
	visibleText: "",
	...a,
});

describe("flujo de un lote", () => {
	it("sube fotos, detecta la guía, espera confirmación y genera el PDF", async () => {
		const { res, batch, rejected } = await createBatchWithPhotos();
		expect(res.status).toBe(200);
		expect(batch.photos).toHaveLength(2);
		expect(rejected).toHaveLength(1);
		const [box, label] = batch.photos;

		await using instance = await introspectWorkflowInstance(
			env.PACKAGE_WORKFLOW,
			batch.id,
		);
		await instance.modify(async (m) => {
			await m.mockStepResult(
				{ name: `analyze ${box.id}` },
				analysis({ kind: "paquete" }),
			);
			await m.mockStepResult(
				{ name: `analyze ${label.id}` },
				analysis({ kind: "guia", trackingNumber: "7946 1234 5678", carrier: "FedEx" }),
			);
		});

		expect((await api(`/api/batches/${batch.id}/close`, { method: "POST" })).status).toBe(200);

		// Ya cerrado: no acepta más fotos (evita mezclar lotes)
		const form = new FormData();
		form.append("photos", new File([TINY_JPEG], "otra.jpg"));
		expect(
			(await api(`/api/batches/${batch.id}/photos`, { method: "POST", body: form })).status,
		).toBe(409);

		await vi.waitUntil(
			async () => (await getBatch(batch.id)).status === "awaiting_confirmation",
			{ timeout: 10_000, interval: 100 },
		);
		const waiting = await getBatch(batch.id);
		expect(waiting.candidates[0]).toMatchObject({
			type: "guia",
			value: "7946 1234 5678",
			carrier: "FedEx",
			photoId: label.id,
		});

		const confirm = await api(`/api/batches/${batch.id}/confirm`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				guideNumber: "794612345678",
				carrier: "FedEx",
				sourcePhotoId: label.id,
				photosPerPage: 4,
			}),
		});
		expect(confirm.status).toBe(200);

		await instance.waitForStatus("complete");
		const done = await getBatch(batch.id);
		expect(done).toMatchObject({ status: "completed", pdfName: "794612345678.pdf" });

		const pdf = await api(`/api/batches/${batch.id}/pdf`);
		expect(pdf.headers.get("Content-Type")).toBe("application/pdf");
		const doc = await PDFDocument.load(new Uint8Array(await pdf.arrayBuffer()));
		expect(doc.getPageCount()).toBe(1); // 2 fotos en retícula de 4
		expect(doc.getTitle()).toBe("Guía 794612345678");
	});

	it("marca error si nadie confirma la guía", async () => {
		const { batch } = await createBatchWithPhotos();

		await using instance = await introspectWorkflowInstance(
			env.PACKAGE_WORKFLOW,
			batch.id,
		);
		await instance.modify(async (m) => {
			for (const p of batch.photos) {
				await m.mockStepResult({ name: `analyze ${p.id}` }, analysis({}));
			}
			await m.forceEventTimeout({ name: "wait for guide confirmation" });
		});

		await api(`/api/batches/${batch.id}/close`, { method: "POST" });
		await instance.waitForStatus("errored");
		expect((await getBatch(batch.id)).status).toBe("error");
	});

	it("permite descartar un lote abierto", async () => {
		const { batch } = await createBatchWithPhotos();
		expect((await api(`/api/batches/${batch.id}`, { method: "DELETE" })).status).toBe(200);
		expect((await api(`/api/batches/${batch.id}`)).status).toBe(404);
		expect(await env.PHOTOS.get(batch.photos[0].key)).toBeNull();
	});
});
