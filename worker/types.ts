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

/** Retícula del PDF: cuántas fotos van en cada página. */
export const PHOTOS_PER_PAGE = [1, 2, 3, 4, 6, 9] as const;
export type PhotosPerPage = (typeof PHOTOS_PER_PAGE)[number];

/** Columnas x filas de cada retícula (página carta vertical). */
export const GRID_LAYOUT: Record<PhotosPerPage, { cols: number; rows: number }> = {
	1: { cols: 1, rows: 1 },
	2: { cols: 1, rows: 2 },
	3: { cols: 1, rows: 3 },
	4: { cols: 2, rows: 2 },
	6: { cols: 2, rows: 3 },
	9: { cols: 3, rows: 3 },
};

/** Retícula más chica en la que caben todas las fotos (máx. 9 por página). */
export function autoPhotosPerPage(photoCount: number): PhotosPerPage {
	return PHOTOS_PER_PAGE.find((n) => n >= photoCount) ?? 9;
}

export function isPhotosPerPage(value: unknown): value is PhotosPerPage {
	return PHOTOS_PER_PAGE.includes(value as PhotosPerPage);
}

export interface ConfirmedGuide {
	guideNumber: string;
	carrier: string | null;
	invoiceNumber: string | null;
	sourcePhotoId: string | null;
	/** null = automático según el número de fotos */
	photosPerPage?: PhotosPerPage | null;
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
