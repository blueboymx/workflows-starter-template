import { describe, expect, it } from "vitest";
import {
	findTrackingLikeCodes,
	parseAnalysis,
	rankCandidates,
	toFileName,
} from "../worker/lib/guide";
import { detectImageType, readJpegOrientation } from "../worker/lib/image";
import type { Photo, PhotoAnalysis } from "../worker/types";
import { autoPhotosPerPage, isPhotosPerPage } from "../worker/types";
import { TINY_JPEG, TINY_PNG, jpegWithOrientation } from "./fixtures";

const photo = (id: string, analysis: Partial<PhotoAnalysis>): Photo => ({
	id,
	key: `k/${id}`,
	name: `${id}.jpg`,
	contentType: "image/jpeg",
	size: 1,
	uploadedAt: 0,
	analysis: {
		kind: "otro",
		trackingNumber: null,
		carrier: null,
		invoiceNumber: null,
		confidence: 0.5,
		visibleText: "",
		...analysis,
	},
});

describe("parseAnalysis", () => {
	it("lee JSON envuelto en texto y limpia valores", () => {
		const a = parseAnalysis(
			'```json\n{"kind":"guia","trackingNumber":" 794612345678 ","carrier":"FedEx","invoiceNumber":"null","confidence":1.4}\n```',
		);
		expect(a).toMatchObject({
			kind: "guia",
			trackingNumber: "794612345678",
			carrier: "FedEx",
			invoiceNumber: null,
			confidence: 1,
		});
	});

	it("acepta objetos y corrige tipos desconocidos", () => {
		expect(parseAnalysis({ kind: "caja", confidence: "x" })).toMatchObject({
			kind: "otro",
			confidence: 0.5,
		});
	});

	it("no truena con texto sin JSON", () => {
		expect(parseAnalysis("no pude leer nada")).toMatchObject({
			kind: "otro",
			confidence: 0,
			visibleText: "no pude leer nada",
		});
	});
});

describe("findTrackingLikeCodes", () => {
	it("encuentra guías UPS, agrupadas y continuas", () => {
		const codes = findTrackingLikeCodes(
			"UPS 1Z999AA10123456784 · FedEx 7946 1234 5678 · Estafeta 8055241528464720099314 · CP 06600 Tel 5512345",
		);
		expect(codes).toContain("1Z999AA10123456784");
		expect(codes).toContain("794612345678");
		expect(codes).toContain("8055241528464720099314");
		expect(codes).not.toContain("06600");
	});
});

describe("rankCandidates", () => {
	it("prioriza guías de fotos de etiqueta y deduplica", () => {
		const ranked = rankCandidates([
			photo("a", { kind: "paquete", trackingNumber: "7946-1234-5678", confidence: 0.6 }),
			photo("b", { kind: "guia", trackingNumber: "794612345678", carrier: "FedEx", confidence: 0.8 }),
			photo("c", { kind: "factura", invoiceNumber: "A-1520", confidence: 0.9 }),
		]);
		expect(ranked.map((c) => [c.type, c.photoId])).toEqual([
			["guia", "b"],
			["factura", "c"],
		]);
		expect(ranked[0].carrier).toBe("FedEx");
	});

	it("usa el texto visible si la IA no dio número", () => {
		const ranked = rankCandidates([
			photo("a", { kind: "guia", visibleText: "GUIA 1234 5678 90" }),
		]);
		expect(ranked[0]).toMatchObject({ type: "guia", value: "1234567890" });
	});
});

describe("toFileName", () => {
	it("genera nombres seguros", () => {
		expect(toFileName(" Guía #7946 1234/5678 ", "x")).toBe("Guia-7946-1234-5678");
		expect(toFileName("///", "lote-1")).toBe("lote-1");
	});
});

describe("imágenes", () => {
	it("detecta tipo por bytes", () => {
		expect(detectImageType(TINY_JPEG)).toBe("image/jpeg");
		expect(detectImageType(TINY_PNG)).toBe("image/png");
		expect(detectImageType(new TextEncoder().encode("<html>"))).toBeNull();
	});

	it("lee la orientación EXIF", () => {
		expect(readJpegOrientation(TINY_JPEG)).toBe(1);
		expect(readJpegOrientation(jpegWithOrientation(6))).toBe(6);
		expect(readJpegOrientation(jpegWithOrientation(8, true))).toBe(8);
	});
});

describe("retícula", () => {
	it("elige la retícula más chica donde caben las fotos", () => {
		expect([1, 2, 3, 4, 5, 6, 7, 9, 20].map(autoPhotosPerPage)).toEqual([
			1, 2, 3, 4, 6, 6, 9, 9, 9,
		]);
	});
	it("sólo acepta 1, 2, 3, 4, 6 o 9", () => {
		expect([1, 2, 3, 4, 6, 9].every(isPhotosPerPage)).toBe(true);
		expect([0, 5, 8, "4", null].some(isPhotosPerPage)).toBe(false);
	});
});
