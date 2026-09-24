import { useEffect, useMemo, useState } from "react";
import type { Batch, ServerMessage } from "../../worker/types";

/**
 * Mantiene la lista de lotes sincronizada por WebSocket, con reconexión
 * automática (los teléfonos cortan la conexión al bloquear la pantalla).
 */
export function useBatches() {
	const [batches, setBatches] = useState<Record<string, Batch>>({});
	const [connected, setConnected] = useState(false);

	useEffect(() => {
		let ws: WebSocket | null = null;
		let retry = 0;
		let timer: ReturnType<typeof setTimeout> | undefined;
		let stopped = false;

		const connect = () => {
			const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
			ws = new WebSocket(`${protocol}//${window.location.host}/ws`);

			ws.onopen = () => {
				retry = 0;
				setConnected(true);
			};
			ws.onclose = () => {
				setConnected(false);
				if (stopped) return;
				timer = setTimeout(connect, Math.min(10_000, 500 * 2 ** retry++));
			};
			ws.onmessage = (event) => {
				try {
					const msg = JSON.parse(event.data) as ServerMessage;
					if (msg.type === "snapshot") {
						setBatches(Object.fromEntries(msg.batches.map((b) => [b.id, b])));
					} else if (msg.type === "batch") {
						setBatches((prev) => ({ ...prev, [msg.batch.id]: msg.batch }));
					}
				} catch {
					// mensaje inválido
				}
			};
		};

		// Al volver a la pestaña pedimos un snapshot fresco
		const onVisible = () => {
			if (document.visibilityState === "visible" && ws?.readyState === WebSocket.OPEN) {
				ws.send("refresh");
			}
		};

		connect();
		document.addEventListener("visibilitychange", onVisible);
		return () => {
			stopped = true;
			clearTimeout(timer);
			document.removeEventListener("visibilitychange", onVisible);
			ws?.close();
		};
	}, []);

	const list = useMemo(
		() => Object.values(batches).sort((a, b) => b.createdAt - a.createdAt),
		[batches],
	);

	/** Aplica de inmediato una respuesta de la API (sin esperar al WebSocket). */
	const upsert = (batch: Batch) =>
		setBatches((prev) =>
			(prev[batch.id]?.updatedAt ?? 0) > batch.updatedAt
				? prev
				: { ...prev, [batch.id]: batch },
		);
	const remove = (id: string) =>
		setBatches((prev) => {
			const next = { ...prev };
			delete next[id];
			return next;
		});

	return { batches: list, byId: batches, connected, upsert, remove };
}
