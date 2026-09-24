import type { PhotoAnalysis } from "./types";
import { parseAnalysis } from "./lib/guide";

const DEFAULT_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

const SYSTEM_PROMPT = `Eres un asistente de logística que revisa fotos de paquetes enviados desde México.
Para cada foto decide qué muestra:
- "guia": etiqueta o guía de paquetería (FedEx, DHL, Estafeta, UPS, Paquetexpress, Redpack, 99minutos, Mercado Envíos, etc.)
- "factura": factura, remisión, nota o ticket
- "paquete": sólo la caja o el contenido
- "otro": cualquier otra cosa
Extrae el número de guía (tracking) y el número de factura sólo si se leen claramente.
Nunca inventes números: si no son legibles usa null.
Responde únicamente con JSON.`;

const USER_PROMPT = `Analiza la foto y responde con este JSON:
{"kind": "guia|factura|paquete|otro", "trackingNumber": string|null, "carrier": string|null, "invoiceNumber": string|null, "confidence": número entre 0 y 1, "visibleText": "texto relevante que alcances a leer (máx. 500 caracteres)"}`;

const RESPONSE_SCHEMA = {
	type: "object",
	properties: {
		kind: { type: "string", enum: ["guia", "factura", "paquete", "otro"] },
		trackingNumber: { type: ["string", "null"] },
		carrier: { type: ["string", "null"] },
		invoiceNumber: { type: ["string", "null"] },
		confidence: { type: "number" },
		visibleText: { type: "string" },
	},
	required: ["kind", "trackingNumber", "carrier", "invoiceNumber", "confidence"],
};

function toBase64(bytes: Uint8Array): string {
	let binary = "";
	const chunk = 0x8000;
	for (let i = 0; i < bytes.length; i += chunk) {
		binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
	}
	return btoa(binary);
}

/** Envía una foto al modelo de visión de Workers AI y devuelve lo detectado. */
export async function analyzePhoto(
	env: Env,
	bytes: Uint8Array,
	contentType: string,
): Promise<PhotoAnalysis> {
	const model = env.VISION_MODEL || DEFAULT_MODEL;
	const dataUrl = `data:${contentType};base64,${toBase64(bytes)}`;

	// El modelo es configurable, así que usamos una firma genérica.
	const run = env.AI.run.bind(env.AI) as unknown as (
		model: string,
		input: Record<string, unknown>,
	) => Promise<{ response?: unknown }>;

	const result = await run(model, {
		messages: [
			{ role: "system", content: SYSTEM_PROMPT },
			{
				role: "user",
				content: [
					{ type: "text", text: USER_PROMPT },
					{ type: "image_url", image_url: { url: dataUrl } },
				],
			},
		],
		response_format: { type: "json_schema", json_schema: RESPONSE_SCHEMA },
		max_tokens: 600,
		temperature: 0,
	});

	return parseAnalysis(result?.response ?? result);
}
