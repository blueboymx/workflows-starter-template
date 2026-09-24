import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
	test: {
		poolOptions: {
			workers: {
				// Workers AI se simula en las pruebas; no requiere sesión de Cloudflare
				remoteBindings: false,
				wrangler: { configPath: "./wrangler.jsonc" },
			},
		},
	},
});
