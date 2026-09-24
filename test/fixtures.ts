// Imágenes mínimas válidas para pruebas
const b64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/** JPEG de 1x1 px */
export const TINY_JPEG = b64(
	"/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=",
);

/** PNG de 1x1 px */
export const TINY_PNG = b64(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
);

/** Inserta un segmento EXIF con la orientación indicada en un JPEG. */
export function jpegWithOrientation(orientation: number, littleEndian = false): Uint8Array {
	const tiff = new DataView(new ArrayBuffer(26));
	tiff.setUint16(0, littleEndian ? 0x4949 : 0x4d4d);
	tiff.setUint16(2, 42, littleEndian);
	tiff.setUint32(4, 8, littleEndian); // offset del IFD0
	tiff.setUint16(8, 1, littleEndian); // 1 entrada
	tiff.setUint16(10, 0x0112, littleEndian); // Orientation
	tiff.setUint16(12, 3, littleEndian); // SHORT
	tiff.setUint32(14, 1, littleEndian);
	tiff.setUint16(18, orientation, littleEndian);
	tiff.setUint32(22, 0, littleEndian);

	const exifHeader = [0x45, 0x78, 0x69, 0x66, 0, 0];
	const segLen = 2 + exifHeader.length + 26;
	const out = new Uint8Array(TINY_JPEG.length + 2 + segLen);
	out.set([0xff, 0xd8, 0xff, 0xe1, segLen >> 8, segLen & 0xff, ...exifHeader], 0);
	out.set(new Uint8Array(tiff.buffer), 12);
	out.set(TINY_JPEG.subarray(2), 38);
	return out;
}
