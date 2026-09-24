import type { Batch, PhotoAnalysis } from "../../worker/types";
import { api, pdfUrl, photoUrl } from "../api";
import { ConfirmForm } from "./ConfirmForm";
import { Button, Spinner, StatusBadge } from "./ui";

const KIND_LABELS: Record<PhotoAnalysis["kind"], string> = {
	guia: "Guía",
	factura: "Factura",
	paquete: "Paquete",
	otro: "Otro",
};

type Props = {
	batch: Batch;
	onUpdated: (batch: Batch) => void;
	onRemoved: (id: string) => void;
	onZoom: (src: string) => void;
};

export function BatchCard({ batch, onUpdated, onRemoved, onZoom }: Props) {
	const time = new Date(batch.createdAt).toLocaleString("es-MX", {
		dateStyle: "medium",
		timeStyle: "short",
	});

	const discard = async () => {
		if (!confirm("¿Borrar este lote y sus fotos?")) return;
		try {
			await api.discardBatch(batch.id);
			onRemoved(batch.id);
		} catch (err) {
			alert(err instanceof Error ? err.message : "No se pudo borrar");
		}
	};

	return (
		<article className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10">
			<header className="flex flex-wrap items-start justify-between gap-2">
				<div>
					<h3 className="font-semibold text-neutral-900 dark:text-white">
						{batch.guide ? `Guía ${batch.guide.guideNumber}` : `Lote ${batch.id}`}
					</h3>
					<p className="text-xs text-neutral-500">
						{time} · {batch.photos.length} {batch.photos.length === 1 ? "foto" : "fotos"}
						{batch.source === "hot-folder" ? " · hot folder" : ""}
						{batch.guide ? ` · lote ${batch.id}` : ""}
					</p>
				</div>
				<StatusBadge status={batch.status} />
			</header>

			{batch.photos.length > 0 && (
				<div className="mt-3 flex gap-2 overflow-x-auto pb-1">
					{batch.photos.map((photo) => (
						<button
							key={photo.id}
							type="button"
							onClick={() => onZoom(photoUrl(batch.id, photo.id))}
							className="relative h-20 w-20 flex-none overflow-hidden rounded-lg bg-neutral-100 dark:bg-neutral-800"
						>
							<img
								src={photoUrl(batch.id, photo.id)}
								alt={photo.name}
								loading="lazy"
								className="h-full w-full object-cover"
							/>
							{photo.analysis ? (
								<span
									className={`absolute inset-x-0 bottom-0 px-1 py-0.5 text-[10px] font-semibold text-white ${
										photo.analysis.kind === "guia" ? "bg-brand" : "bg-black/60"
									}`}
								>
									{KIND_LABELS[photo.analysis.kind]}
								</span>
							) : photo.analysisError ? (
								<span className="absolute inset-x-0 bottom-0 bg-red-600 px-1 py-0.5 text-[10px] font-semibold text-white">
									Sin leer
								</span>
							) : batch.status === "analyzing" ? (
								<span className="absolute inset-0 flex items-center justify-center bg-black/30 text-white">
									<Spinner />
								</span>
							) : null}
						</button>
					))}
				</div>
			)}

			{batch.status === "awaiting_confirmation" && (
				<ConfirmForm batch={batch} onUpdated={onUpdated} onZoom={onZoom} />
			)}

			{batch.status === "completed" && batch.pdfName && (
				<div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-emerald-50 p-3 dark:bg-emerald-950/40">
					<div className="text-sm text-emerald-900 dark:text-emerald-100">
						{batch.guide?.carrier && <div>Paquetería: {batch.guide.carrier}</div>}
						{batch.guide?.invoiceNumber && <div>Factura: {batch.guide.invoiceNumber}</div>}
						<div className="font-mono text-xs">{batch.pdfName}</div>
					</div>
					<a
						href={pdfUrl(batch.id)}
						target="_blank"
						rel="noopener"
						className="inline-flex min-h-11 items-center rounded-xl bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-700"
					>
						Ver / descargar PDF
					</a>
				</div>
			)}

			{batch.status === "uploading" && (
				<div className="mt-3 flex items-center justify-between gap-2 text-sm text-neutral-500">
					<span>Esperando más fotos antes de procesar.</span>
					<Button variant="danger" onClick={discard}>
						Descartar
					</Button>
				</div>
			)}

			{batch.status === "error" && (
				<div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950/40 dark:text-red-200">
					<span>{batch.error ?? "Ocurrió un error"}</span>
					<Button variant="danger" onClick={discard}>
						Borrar lote
					</Button>
				</div>
			)}
		</article>
	);
}
