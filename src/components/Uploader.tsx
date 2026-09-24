import { useEffect, useRef, useState } from "react";
import type { Batch } from "../../worker/types";
import { api } from "../api";
import { prepareImage } from "../lib/resizeImage";
import { Button, Spinner } from "./ui";

const ACTIVE_KEY = "lote-activo";

function readActive(): string | null {
	try {
		return localStorage.getItem(ACTIVE_KEY);
	} catch {
		return null;
	}
}

function writeActive(id: string | null) {
	try {
		if (id) localStorage.setItem(ACTIVE_KEY, id);
		else localStorage.removeItem(ACTIVE_KEY);
	} catch {
		// modo privado
	}
}

type Props = {
	byId: Record<string, Batch>;
	upsert: (batch: Batch) => void;
	remove: (id: string) => void;
};

/**
 * Sube fotos a un lote abierto. Después de cada tanda pregunta si hay más
 * fotos del mismo envío; al contestar "No" el lote se cierra y se procesa.
 * Mientras un lote está abierto todas las fotos van a ese lote, y uno cerrado
 * ya no acepta fotos: así no se mezclan dos envíos.
 */
export function Uploader({ byId, upsert, remove }: Props) {
	const [activeId, setActiveId] = useState<string | null>(readActive);
	const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
	const [askMore, setAskMore] = useState<{ added: number; rejected: string[] } | null>(null);
	const [busy, setBusy] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const cameraRef = useRef<HTMLInputElement>(null);
	const galleryRef = useRef<HTMLInputElement>(null);

	const active = activeId ? byId[activeId] : undefined;

	const setActive = (id: string | null) => {
		writeActive(id);
		setActiveId(id);
	};

	// Si el lote se cerró o borró desde otro dispositivo, lo soltamos
	useEffect(() => {
		if (active && active.status !== "uploading") {
			writeActive(null);
			setActiveId(null);
		}
	}, [active]);

	const pick = (mode: "camera" | "gallery") => {
		setAskMore(null);
		setError(null);
		(mode === "camera" ? cameraRef : galleryRef).current?.click();
	};

	const handleFiles = async (list: FileList | null) => {
		const files = list ? Array.from(list) : [];
		if (files.length === 0) return;
		setError(null);
		setProgress({ done: 0, total: files.length });

		try {
			let batchId: string | null = null;
			if (activeId) {
				// Puede que el WebSocket aún no haya traído el lote: lo consultamos
				const current = active ?? (await api.getBatch(activeId).catch(() => null));
				if (current?.status === "uploading") batchId = current.id;
			}
			if (!batchId) {
				const batch = await api.createBatch();
				upsert(batch);
				batchId = batch.id;
				setActive(batchId);
			}

			let added = 0;
			const rejected: string[] = [];
			for (const [i, file] of files.entries()) {
				const { blob, name } = await prepareImage(file);
				const res = await api.uploadPhotos(batchId, [blob], [name]);
				upsert(res.batch);
				added += res.added.length;
				rejected.push(...res.rejected.map((r) => `${r.name}: ${r.reason}`));
				setProgress({ done: i + 1, total: files.length });
			}
			setAskMore({ added, rejected });
		} catch (err) {
			setError(err instanceof Error ? err.message : "No se pudieron subir las fotos");
		} finally {
			setProgress(null);
		}
	};

	const finish = async () => {
		if (!active) return;
		setBusy(true);
		setError(null);
		try {
			upsert(await api.closeBatch(active.id));
			setAskMore(null);
			setActive(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "No se pudo cerrar el lote");
		} finally {
			setBusy(false);
		}
	};

	const discard = async () => {
		if (!active || !confirm("¿Descartar este lote y todas sus fotos?")) return;
		setBusy(true);
		try {
			await api.discardBatch(active.id);
			remove(active.id);
			setAskMore(null);
			setActive(null);
		} catch (err) {
			setError(err instanceof Error ? err.message : "No se pudo descartar");
		} finally {
			setBusy(false);
		}
	};

	const uploading = progress !== null;
	const photoCount = active?.photos.length ?? 0;

	return (
		<section className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5 dark:bg-neutral-900 dark:ring-white/10 sm:p-5">
			<input
				ref={cameraRef}
				type="file"
				accept="image/*"
				capture="environment"
				className="hidden"
				onChange={(e) => {
					handleFiles(e.target.files);
					e.target.value = "";
				}}
			/>
			<input
				ref={galleryRef}
				type="file"
				accept="image/jpeg,image/png,image/*"
				multiple
				className="hidden"
				onChange={(e) => {
					handleFiles(e.target.files);
					e.target.value = "";
				}}
			/>

			{active ? (
				<div className="mb-4 rounded-xl bg-sky-50 p-3 text-sm text-sky-900 dark:bg-sky-950/60 dark:text-sky-100">
					<div className="font-semibold">Lote abierto · {active.id}</div>
					<div>
						{photoCount} {photoCount === 1 ? "foto" : "fotos"}. Todo lo que subas ahora se
						agrega a este envío.
					</div>
				</div>
			) : (
				<p className="mb-4 text-sm text-neutral-600 dark:text-neutral-400">
					Toma o selecciona las fotos de <strong>un solo envío</strong> (caja, guía,
					factura). Al terminar se leen con IA y te preguntamos cuál es la guía.
				</p>
			)}

			<div className="grid grid-cols-2 gap-3">
				<Button onClick={() => pick("camera")} disabled={uploading || busy}>
					<CameraIcon /> Tomar foto
				</Button>
				<Button variant="secondary" onClick={() => pick("gallery")} disabled={uploading || busy}>
					<ImagesIcon /> Elegir fotos
				</Button>
			</div>

			{uploading && (
				<div className="mt-4">
					<div className="mb-1 flex items-center gap-2 text-sm text-neutral-600 dark:text-neutral-300">
						<Spinner /> Subiendo {progress.done} de {progress.total}…
					</div>
					<div className="h-2 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
						<div
							className="h-full bg-brand transition-all"
							style={{ width: `${(progress.done / progress.total) * 100}%` }}
						/>
					</div>
				</div>
			)}

			{active && !uploading && (
				<div className="mt-3 flex flex-wrap gap-2">
					<Button onClick={finish} disabled={busy || photoCount === 0} className="flex-1">
						{busy ? <Spinner /> : null} Terminar y procesar lote
					</Button>
					<Button variant="danger" onClick={discard} disabled={busy}>
						Descartar
					</Button>
				</div>
			)}

			{error && (
				<p className="mt-3 rounded-lg bg-red-50 p-2 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
					{error}
				</p>
			)}

			{askMore && active && (
				<div
					className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-4 sm:items-center"
					role="dialog"
					aria-modal
				>
					<div className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-xl dark:bg-neutral-900">
						<h2 className="text-lg font-semibold text-neutral-900 dark:text-white">
							¿Hay más fotos de este envío?
						</h2>
						<p className="mt-1 text-sm text-neutral-600 dark:text-neutral-400">
							Se {askMore.added === 1 ? "subió 1 foto" : `subieron ${askMore.added} fotos`}.
							El lote {active.id} tiene {photoCount} en total.
						</p>
						{askMore.rejected.length > 0 && (
							<ul className="mt-2 list-disc pl-5 text-xs text-red-700 dark:text-red-300">
								{askMore.rejected.map((r) => (
									<li key={r}>{r}</li>
								))}
							</ul>
						)}
						<div className="mt-4 grid gap-2">
							<Button onClick={() => pick("camera")}>
								<CameraIcon /> Sí, tomar otra foto
							</Button>
							<Button variant="secondary" onClick={() => pick("gallery")}>
								<ImagesIcon /> Sí, elegir de la galería
							</Button>
							<Button
								variant="secondary"
								onClick={finish}
								disabled={busy || photoCount === 0}
								className="!ring-emerald-500 !text-emerald-800 dark:!text-emerald-300"
							>
								{busy ? <Spinner /> : null} No, ya son todas: procesar
							</Button>
							<Button variant="ghost" onClick={() => setAskMore(null)}>
								Decidir después
							</Button>
						</div>
					</div>
				</div>
			)}
		</section>
	);
}

function CameraIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<path d="M3 8a2 2 0 0 1 2-2h2l2-2h6l2 2h2a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
			<circle cx="12" cy="13" r="4" />
		</svg>
	);
}

function ImagesIcon() {
	return (
		<svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden>
			<rect x="3" y="3" width="18" height="18" rx="2" />
			<circle cx="9" cy="9" r="2" />
			<path d="m21 15-5-5L5 21" />
		</svg>
	);
}
