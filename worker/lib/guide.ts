import type { Candidate, Photo, PhotoAnalysis } from "../types";

const KINDS: PhotoAnalysis["kind"][] = ["guia", "factura", "paquete", "otro"];

/** Quita espacios y guiones para comparar números de guía. */
export function normalizeCode(value: string): string {
	return value.replace(/[\s\-_.]/g, "").toUpperCase();
}

function cleanString(value: unknown, max = 80): string | null {
	if (typeof value !== "string") return null;
	const trimmed = value.trim();
	if (!trimmed || /^(null|n\/?a|none|desconocido|ilegible)$/i.test(trimmed)) {
		return null;
	}
	return trimmed.slice(0, max);
}

/**
 * Convierte la respuesta del modelo (objeto o texto con JSON, a veces envuelto
 * en ```json) en un PhotoAnalysis válido. Nunca lanza: si no se puede leer,
 * devuelve un análisis vacío con el texto crudo.
 */
export function parseAnalysis(raw: unknown): PhotoAnalysis {
	let data: unknown = raw;
	if (typeof raw === "string") {
		const match = raw.match(/\{[\s\S]*\}/);
		try {
			data = match ? JSON.parse(match[0]) : null;
		} catch {
			data = null;
		}
		if (!data) {
			return {
				kind: "otro",
				trackingNumber: null,
				carrier: null,
				invoiceNumber: null,
				confidence: 0,
				visibleText: raw.slice(0, 1000),
			};
		}
	}

	const obj = (data ?? {}) as Record<string, unknown>;
	const kind = KINDS.includes(obj.kind as PhotoAnalysis["kind"])
		? (obj.kind as PhotoAnalysis["kind"])
		: "otro";
	const confidence = Number(obj.confidence);

	return {
		kind,
		trackingNumber: cleanString(obj.trackingNumber),
		carrier: cleanString(obj.carrier, 40),
		invoiceNumber: cleanString(obj.invoiceNumber),
		confidence: Number.isFinite(confidence)
			? Math.min(1, Math.max(0, confidence))
			: 0.5,
		visibleText: cleanString(obj.visibleText, 1000) ?? "",
	};
}

/**
 * Busca en texto libre cadenas que parecen números de guía: UPS (1Z...) o
 * tokens de 10 a 22 caracteres con al menos 8 dígitos (FedEx, DHL, Estafeta,
 * Paquetexpress, etc.).
 */
export function findTrackingLikeCodes(text: string): string[] {
	const found = new Set<string>();
	for (const m of text.matchAll(/\b1Z[0-9A-Z]{16}\b/gi)) {
		found.add(m[0].toUpperCase());
	}
	const accept = (raw: string) => {
		const code = normalizeCode(raw);
		const digits = code.replace(/\D/g, "").length;
		if (code.length >= 10 && code.length <= 22 && digits >= 8) {
			found.add(code);
		}
	};
	// Dígitos agrupados con espacios o guiones: "7946 1234 5678"
	for (const m of text.matchAll(/\b\d{2,6}(?:[ -]\d{2,6}){1,6}\b/g)) {
		accept(m[0]);
	}
	// Tokens alfanuméricos continuos
	for (const m of text.matchAll(/\b[0-9A-Z]{10,22}\b/gi)) {
		accept(m[0]);
	}
	return [...found];
}

/**
 * Junta lo detectado en todas las fotos y lo ordena por probabilidad de ser
 * la guía. Las guías van antes que las facturas.
 */
export function rankCandidates(photos: Photo[]): Candidate[] {
	const byValue = new Map<string, Candidate>();
	const add = (c: Candidate) => {
		const key = `${c.type}:${normalizeCode(c.value)}`;
		const prev = byValue.get(key);
		if (!prev || prev.score < c.score) {
			byValue.set(key, { ...c, carrier: c.carrier ?? prev?.carrier ?? null });
		} else if (!prev.carrier && c.carrier) {
			prev.carrier = c.carrier;
		}
	};

	for (const photo of photos) {
		const a = photo.analysis;
		if (!a) continue;
		const kindBonus = a.kind === "guia" ? 0.3 : 0;

		if (a.trackingNumber) {
			add({
				type: "guia",
				value: a.trackingNumber,
				carrier: a.carrier,
				photoId: photo.id,
				score: a.confidence + kindBonus,
			});
		} else if (a.kind === "guia") {
			for (const code of findTrackingLikeCodes(a.visibleText)) {
				add({
					type: "guia",
					value: code,
					carrier: a.carrier,
					photoId: photo.id,
					score: 0.2,
				});
			}
		}

		if (a.invoiceNumber) {
			add({
				type: "factura",
				value: a.invoiceNumber,
				carrier: null,
				photoId: photo.id,
				score: a.confidence * 0.5 + (a.kind === "factura" ? 0.2 : 0),
			});
		}
	}

	return [...byValue.values()].sort((x, y) => {
		if (x.type !== y.type) return x.type === "guia" ? -1 : 1;
		return y.score - x.score;
	});
}

/** Nombre de archivo seguro a partir del número de guía. */
export function toFileName(value: string, fallback: string): string {
	const safe = value
		.normalize("NFD")
		.replace(/[̀-ͯ]/g, "")
		.replace(/[^A-Za-z0-9._-]+/g, "-")
		.replace(/-{2,}/g, "-")
		.replace(/^[-.]+|[-.]+$/g, "")
		.slice(0, 80);
	return safe || fallback;
}
