import { describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import { buildBatchPdf } from "../worker/pdf";
import { TINY_JPEG, TINY_PNG, jpegWithOrientation } from "./fixtures";

describe("buildBatchPdf", () => {
	it("genera una página carta vertical por foto con el título de la guía", async () => {
		const bytes = await buildBatchPdf({
			batchId: "20260924-abc123",
			guide: {
				guideNumber: "794612345678",
				carrier: "FedEx",
				invoiceNumber: "A-1520",
				sourcePhotoId: null,
			},
			photos: [
				{ name: "a.jpg", bytes: TINY_JPEG },
				{ name: "b.png", bytes: TINY_PNG },
				{ name: "c.jpg", bytes: jpegWithOrientation(6) },
			],
			logo: null,
			generatedAt: new Date("2026-09-24T18:00:00Z"),
			timeZone: "America/Mexico_City",
		});

		const doc = await PDFDocument.load(bytes);
		expect(doc.getPageCount()).toBe(3);
		const { width, height } = doc.getPage(0).getSize();
		expect([width, height]).toEqual([612, 792]);
		expect(doc.getTitle()).toBe("Guía 794612345678");
		expect(doc.getAuthor()).toBe("RETAIL INTELIGENCIA ANALITICA");
	});

	it("usa el logotipo si existe", async () => {
		const bytes = await buildBatchPdf({
			batchId: "x",
			guide: { guideNumber: "1", carrier: null, invoiceNumber: null, sourcePhotoId: null },
			photos: [{ name: "a.jpg", bytes: TINY_JPEG }],
			logo: TINY_PNG,
			generatedAt: new Date(),
			timeZone: "UTC",
		});
		expect((await PDFDocument.load(bytes)).getPageCount()).toBe(1);
	});
});
