/** Detecta JPEG/PNG por los bytes iniciales (no confiamos en la extensión). */
export function detectImageType(
	bytes: Uint8Array,
): "image/jpeg" | "image/png" | null {
	if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
		return "image/jpeg";
	}
	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		return "image/png";
	}
	return null;
}

/**
 * Lee la orientación EXIF (1-8) de un JPEG. Las fotos del teléfono suelen
 * venir "acostadas" con orientación 6 u 8; el PDF las gira según este valor.
 * Devuelve 1 si no hay EXIF o no se puede leer.
 */
export function readJpegOrientation(bytes: Uint8Array): number {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	if (view.byteLength < 4 || view.getUint16(0) !== 0xffd8) return 1;

	let offset = 2;
	while (offset + 4 <= view.byteLength) {
		const marker = view.getUint16(offset);
		if ((marker & 0xff00) !== 0xff00) return 1;
		const size = view.getUint16(offset + 2);
		if (marker === 0xffe1) {
			return readExifOrientation(view, offset + 4, size - 2);
		}
		if (marker === 0xffda) return 1; // inicio de datos de imagen
		offset += 2 + size;
	}
	return 1;
}

function readExifOrientation(
	view: DataView,
	start: number,
	length: number,
): number {
	const end = Math.min(view.byteLength, start + length);
	// "Exif\0\0"
	if (start + 14 > end || view.getUint32(start) !== 0x45786966) return 1;
	const tiff = start + 6;
	const byteOrder = view.getUint16(tiff);
	if (byteOrder !== 0x4949 && byteOrder !== 0x4d4d) return 1;
	const little = byteOrder === 0x4949;
	const ifd = tiff + view.getUint32(tiff + 4, little);
	if (ifd + 2 > end) return 1;
	const entries = view.getUint16(ifd, little);
	for (let i = 0; i < entries; i++) {
		const entry = ifd + 2 + i * 12;
		if (entry + 12 > end) return 1;
		if (view.getUint16(entry, little) === 0x0112) {
			const value = view.getUint16(entry + 8, little);
			return value >= 1 && value <= 8 ? value : 1;
		}
	}
	return 1;
}
