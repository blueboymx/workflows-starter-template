import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";

import { cloudflare } from "@cloudflare/vite-plugin";

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
	plugins: [
		react(),
		// Workers AI siempre es remoto: requiere `npx wrangler login`.
		// `npm run dev:offline` prueba la interfaz sin cuenta de Cloudflare (la IA
		// fallará y la guía se captura a mano).
		cloudflare(
			mode === "offline"
				? { remoteBindings: false, inspectorPort: false }
				: {},
		),
	],
}));
