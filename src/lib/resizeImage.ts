const MAX_SIDE = 2000;
const QUALITY = 0.85;

/**
 * Reduce la foto a máx. 2000 px por lado y la convierte a JPEG, aplicando la
 * rotación EXIF. Así las fotos del teléfono suben más rápido, la IA las lee
 * mejor y el PDF queda ligero. Si el navegador no puede decodificarla, se
 * sube el archivo original.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; name: string }> {
	const baseName = file.name.replace(/\.[^.]+$/, "") || "foto";
	try {
		const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
		const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
		const width = Math.round(bitmap.width * scale);
		const height = Math.round(bitmap.height * scale);

		const canvas = document.createElement("canvas");
		canvas.width = width;
		canvas.height = height;
		const ctx = canvas.getContext("2d");
		if (!ctx) throw new Error("Canvas no disponible");
		ctx.drawImage(bitmap, 0, 0, width, height);
		bitmap.close();

		const blob = await new Promise<Blob | null>((resolve) =>
			canvas.toBlob(resolve, "image/jpeg", QUALITY),
		);
		if (!blob) throw new Error("No se pudo convertir");
		return { blob, name: `${baseName}.jpg` };
	} catch {
		return { blob: file, name: file.name };
	}
}
