import { useState } from "react";
import { BatchCard } from "./components/BatchCard";
import { Uploader } from "./components/Uploader";
import { Lightbox } from "./components/ui";
import { useBatches } from "./hooks/useBatches";

function Logo() {
	const [failed, setFailed] = useState(false);
	if (!failed) {
		return (
			<img
				src="/logo.png"
				alt="Retail Inteligencia Analítica"
				className="h-9 w-auto"
				onError={() => setFailed(true)}
			/>
		);
	}
	return (
		<div className="flex items-center gap-2">
			<div className="h-9 w-1 rounded bg-brand" />
			<div className="leading-none">
				<div className="text-lg font-extrabold tracking-tight text-neutral-900 dark:text-white">
					RETAIL
				</div>
				<div className="text-[9px] font-medium tracking-[0.15em] text-brand">
					INTELIGENCIA ANALITICA
				</div>
			</div>
		</div>
	);
}

function App() {
	const { batches, byId, connected, upsert, remove } = useBatches();
	const [zoom, setZoom] = useState<string | null>(null);

	const pending = batches.filter((b) => b.status !== "uploading" && b.status !== "completed");
	const done = batches.filter((b) => b.status === "completed");
	const open = batches.filter((b) => b.status === "uploading");

	const card = (b: (typeof batches)[number]) => (
		<BatchCard key={b.id} batch={b} onUpdated={upsert} onRemoved={remove} onZoom={setZoom} />
	);

	return (
		<div className="min-h-screen bg-neutral-100 dark:bg-neutral-950">
			<header className="sticky top-0 z-30 border-b border-black/5 bg-white/90 backdrop-blur dark:border-white/10 dark:bg-neutral-900/90">
				<div className="mx-auto flex max-w-3xl items-center justify-between px-4 py-3">
					<Logo />
					<div className="text-right">
						<div className="text-sm font-semibold text-neutral-800 dark:text-neutral-100">
							Evidencia de envíos
						</div>
						<div className="flex items-center justify-end gap-1.5 text-xs text-neutral-500">
							<span
								className={`h-2 w-2 rounded-full ${connected ? "bg-emerald-500" : "bg-neutral-400"}`}
							/>
							{connected ? "En vivo" : "Reconectando…"}
						</div>
					</div>
				</div>
			</header>

			<main className="mx-auto grid max-w-3xl gap-6 px-4 py-5">
				<Uploader byId={byId} upsert={upsert} remove={remove} />

				{pending.length > 0 && (
					<section className="grid gap-3">
						<h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
							En proceso
						</h2>
						{pending.map(card)}
					</section>
				)}

				{open.length > 0 && (
					<section className="grid gap-3">
						<h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
							Lotes abiertos
						</h2>
						{open.map(card)}
					</section>
				)}

				<section className="grid gap-3">
					<h2 className="text-sm font-semibold uppercase tracking-wide text-neutral-500">
						PDFs generados
					</h2>
					{done.length > 0 ? (
						done.map(card)
					) : (
						<p className="text-sm text-neutral-500">Todavía no hay PDFs.</p>
					)}
				</section>
			</main>

			<Lightbox src={zoom} onClose={() => setZoom(null)} />
		</div>
	);
}

export default App;
