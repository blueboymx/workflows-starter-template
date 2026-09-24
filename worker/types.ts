/**
 * Tipos compartidos entre el Worker y el frontend.
 * El frontend los importa con `import type`, así que este archivo sólo debe
 * contener tipos y constantes sin dependencias del runtime de Workers.
 */

export type BatchStatus =
	| "uploading" // lote abierto: se pueden seguir agregando fotos
	| "analyzing" // lote cerrado: la IA está leyendo las fotos
	| "awaiting_confirmation" // esperando que una persona confirme la guía
	| "generating" // generando el PDF
	| "completed"
	| "error";

export type BatchSource = "web" | "hot-folder";

/** Lo que la IA encontró en una foto. */
export interface PhotoAnalysis {
	kind: "guia" | "factura" | "paquete" | "otro";
	trackingNumber: string | null;
	carrier: string | null;
	invoiceNumber: string | null;
	/** 0..1 */
	confidence: number;
	visibleText: string;
}

export interface Photo {
	id: string;
	key: string;
	name: string;
	contentType: "image/jpeg" | "image/png";
	size: number;
	uploadedAt: number;
	analysis?: PhotoAnalysis;
	analysisError?: string;
}

/** Posible número de guía o factura detectado en alguna foto. */
export interface Candidate {
	type: "guia" | "factura";
	value: string;
	carrier: string | null;
	photoId: string | null;
	score: number;
}

export interface ConfirmedGuide {
	guideNumber: string;
	carrier: string | null;
	invoiceNumber: string | null;
	sourcePhotoId: string | null;
}

export interface Batch {
	id: string;
	source: BatchSource;
	status: BatchStatus;
	createdAt: number;
	updatedAt: number;
	photos: Photo[];
	candidates: Candidate[];
	guide: ConfirmedGuide | null;
	pdfKey: string | null;
	pdfName: string | null;
	error: string | null;
}

export type ServerMessage =
	| { type: "snapshot"; batches: Batch[] }
	| { type: "batch"; batch: Batch };

export const STATUS_LABELS: Record<BatchStatus, string> = {
	uploading: "Recibiendo fotos",
	analyzing: "Analizando fotos",
	awaiting_confirmation: "Confirma la guía",
	generating: "Generando PDF",
	completed: "PDF listo",
	error: "Error",
};
