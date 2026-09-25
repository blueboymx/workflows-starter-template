import {
	PDFDocument,
	StandardFonts,
	degrees,
	rgb,
	type PDFFont,
	type PDFImage,
	type PDFPage,
} from "pdf-lib";
import { GRID_LAYOUT, autoPhotosPerPage, type ConfirmedGuide } from "./types";
import { detectImageType, readJpegOrientation } from "./lib/image";

export const COMPANY_NAME = "RETAIL INTELIGENCIA ANALITICA";

// Carta vertical, en puntos (1/72 in)
const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 36;

const INK = rgb(0.11, 0.15, 0.23);
const MUTED = rgb(0.42, 0.45, 0.5);
const ACCENT = rgb(0.0, 0.38, 0.72);

export interface PdfPhoto {
	name: string;
	bytes: Uint8Array;
}

export interface PdfInput {
	batchId: string;
	guide: ConfirmedGuide;
	photos: PdfPhoto[];
	logo: Uint8Array | null;
	generatedAt: Date;
	timeZone: string;
}

/** Las fuentes estándar de PDF sólo aceptan WinAnsi; quitamos lo demás. */
function safe(text: string): string {
	return text.replace(/[^\x20-\x7E\u00A0-\u00FF]/g, "");
}

function fitText(font: PDFFont, text: string, maxSize: number, maxWidth: number) {
	let size = maxSize;
	while (size > 8 && font.widthOfTextAtSize(text, size) > maxWidth) size -= 1;
	return size;
}

async function embedImage(doc: PDFDocument, bytes: Uint8Array) {
	const type = detectImageType(bytes);
	if (type === "image/png") return { image: await doc.embedPng(bytes), orientation: 1 };
	if (type === "image/jpeg") {
		return { image: await doc.embedJpg(bytes), orientation: readJpegOrientation(bytes) };
	}
	return null;
}

/**
 * Dibuja la imagen centrada dentro de la caja, respetando la orientación EXIF
 * (3 = 180°, 6 = 90° horario, 8 = 90° antihorario).
 */
function drawPhoto(
	page: PDFPage,
	image: PDFImage,
	orientation: number,
	box: { x: number; y: number; w: number; h: number },
) {
	const rotated = orientation === 6 || orientation === 8;
	const natW = rotated ? image.height : image.width;
	const natH = rotated ? image.width : image.height;
	const scale = Math.min(box.w / natW, box.h / natH, 1.5);
	const dispW = natW * scale;
	const dispH = natH * scale;
	const x = box.x + (box.w - dispW) / 2;
	const y = box.y + (box.h - dispH) / 2;
	const w = image.width * scale;
	const h = image.height * scale;

	page.drawRectangle({
		x: x - 1,
		y: y - 1,
		width: dispW + 2,
		height: dispH + 2,
		borderColor: rgb(0.85, 0.87, 0.9),
		borderWidth: 1,
	});

	if (orientation === 6) {
		page.drawImage(image, { x, y: y + dispH, width: w, height: h, rotate: degrees(-90) });
	} else if (orientation === 8) {
		page.drawImage(image, { x: x + dispW, y, width: w, height: h, rotate: degrees(90) });
	} else if (orientation === 3) {
		page.drawImage(image, {
			x: x + dispW,
			y: y + dispH,
			width: w,
			height: h,
			rotate: degrees(180),
		});
	} else {
		page.drawImage(image, { x, y, width: w, height: h });
	}
}

function drawTextLogo(page: PDFPage, bold: PDFFont, regular: PDFFont, top: number) {
	page.drawRectangle({ x: MARGIN, y: top - 40, width: 5, height: 40, color: ACCENT });
	page.drawText("RETAIL", { x: MARGIN + 12, y: top - 22, size: 22, font: bold, color: INK });
	page.drawText("INTELIGENCIA ANALITICA", {
		x: MARGIN + 12,
		y: top - 37,
		size: 9,
		font: regular,
		color: ACCENT,
	});
}

/**
 * Genera el PDF del lote: encabezado con logotipo y guía, y las fotos en una
 * retícula de 1, 2, 3, 4, 6 o 9 por página.
 */
export async function buildBatchPdf(input: PdfInput): Promise<Uint8Array> {
	const { guide, batchId, timeZone } = input;
	const doc = await PDFDocument.create();
	const bold = await doc.embedFont(StandardFonts.HelveticaBold);
	const regular = await doc.embedFont(StandardFonts.Helvetica);

	const title = safe(`Guía ${guide.guideNumber}`);
	doc.setTitle(title);
	doc.setAuthor(COMPANY_NAME);
	doc.setSubject(`Evidencia fotográfica del envío ${guide.guideNumber}`);
	doc.setKeywords([guide.guideNumber, guide.carrier ?? "", guide.invoiceNumber ?? ""].filter(Boolean));
	doc.setCreator(COMPANY_NAME);
	doc.setCreationDate(input.generatedAt);

	let logo: PDFImage | null = null;
	if (input.logo) {
		const embedded = await embedImage(doc, input.logo).catch(() => null);
		logo = embedded?.image ?? null;
	}

	const dateText = safe(
		input.generatedAt.toLocaleString("es-MX", {
			timeZone,
			dateStyle: "long",
			timeStyle: "short",
		}),
	);
	const details = safe(
		[
			guide.carrier ? `Paquetería: ${guide.carrier}` : null,
			guide.invoiceNumber ? `Factura: ${guide.invoiceNumber}` : null,
			`Lote: ${batchId}`,
		]
			.filter(Boolean)
			.join("   ·   "),
	);

	const images: { image: PDFImage; orientation: number }[] = [];
	for (const photo of input.photos) {
		const embedded = await embedImage(doc, photo.bytes);
		if (embedded) images.push(embedded);
	}
	if (images.length === 0) throw new Error("El lote no tiene imágenes válidas");

	const perPage = guide.photosPerPage ?? autoPhotosPerPage(images.length);
	const { cols, rows } = GRID_LAYOUT[perPage];
	const pageCount = Math.ceil(images.length / perPage);
	const top = PAGE_H - MARGIN;

	// Área de fotos: debajo del título y arriba del pie
	const area = { x: MARGIN, y: MARGIN + 18, w: PAGE_W - 2 * MARGIN, h: 0 };
	area.h = top - 112 - area.y;
	const gap = perPage === 1 ? 0 : 10;
	const captionH = perPage === 1 ? 0 : 12;
	const cellW = (area.w - gap * (cols - 1)) / cols;
	const cellH = (area.h - gap * (rows - 1)) / rows;

	for (let p = 0; p < pageCount; p++) {
		const page = doc.addPage([PAGE_W, PAGE_H]);

		// Encabezado: logotipo + fecha
		if (logo) {
			const s = Math.min(170 / logo.width, 44 / logo.height);
			page.drawImage(logo, {
				x: MARGIN,
				y: top - logo.height * s,
				width: logo.width * s,
				height: logo.height * s,
			});
		} else {
			drawTextLogo(page, bold, regular, top);
		}
		const label = safe("EVIDENCIA DE ENVÍO");
		page.drawText(label, {
			x: PAGE_W - MARGIN - bold.widthOfTextAtSize(label, 9),
			y: top - 14,
			size: 9,
			font: bold,
			color: MUTED,
		});
		page.drawText(dateText, {
			x: PAGE_W - MARGIN - regular.widthOfTextAtSize(dateText, 9),
			y: top - 28,
			size: 9,
			font: regular,
			color: MUTED,
		});
		page.drawLine({
			start: { x: MARGIN, y: top - 52 },
			end: { x: PAGE_W - MARGIN, y: top - 52 },
			thickness: 1,
			color: rgb(0.85, 0.87, 0.9),
		});

		// Título con el número de guía
		const titleSize = fitText(bold, title, 22, PAGE_W - 2 * MARGIN);
		page.drawText(title, { x: MARGIN, y: top - 80, size: titleSize, font: bold, color: INK });
		page.drawText(details, {
			x: MARGIN,
			y: top - 98,
			size: fitText(regular, details, 10, PAGE_W - 2 * MARGIN),
			font: regular,
			color: MUTED,
		});

		// Fotos en retícula, de izquierda a derecha y de arriba abajo
		const pageImages = images.slice(p * perPage, (p + 1) * perPage);
		pageImages.forEach(({ image, orientation }, i) => {
			const col = i % cols;
			const row = Math.floor(i / cols);
			const cellX = area.x + col * (cellW + gap);
			const cellTop = area.y + area.h - row * (cellH + gap);
			drawPhoto(page, image, orientation, {
				x: cellX,
				y: cellTop - cellH + captionH,
				w: cellW,
				h: cellH - captionH,
			});
			if (captionH) {
				const caption = `Foto ${p * perPage + i + 1}`;
				page.drawText(caption, {
					x: cellX + (cellW - regular.widthOfTextAtSize(caption, 7)) / 2,
					y: cellTop - cellH + 2,
					size: 7,
					font: regular,
					color: MUTED,
				});
			}
		});

		// Pie
		const footer = safe(
			`Página ${p + 1} de ${pageCount}   ·   ${images.length} ${images.length === 1 ? "foto" : "fotos"}`,
		);
		page.drawText(footer, { x: MARGIN, y: MARGIN, size: 8, font: regular, color: MUTED });
		page.drawText(COMPANY_NAME, {
			x: PAGE_W - MARGIN - regular.widthOfTextAtSize(COMPANY_NAME, 8),
			y: MARGIN,
			size: 8,
			font: regular,
			color: MUTED,
		});
	}

	return doc.save();
}
