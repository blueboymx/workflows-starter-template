// Secretos opcionales (wrangler secret put ...). No aparecen en
// worker-configuration.d.ts porque `wrangler types` sólo ve los que existen.
declare namespace Cloudflare {
	interface Env {
		/** URL que recibe un POST cuando el PDF de un lote está listo. */
		SHIPMENTS_WEBHOOK_URL?: string;
		/** Token Bearer para ese webhook. */
		SHIPMENTS_WEBHOOK_TOKEN?: string;
	}
}
