import { useState, type FormEvent } from "react";
import type { Batch, Candidate } from "../../worker/types";
import { toFileName } from "../../worker/lib/guide";
import { api, photoUrl } from "../api";
import { Button, Spinner } from "./ui";

type Props = {
	batch: Batch;
	onUpdated: (batch: Batch) => void;
	onZoom: (src: string) => void;
};

/** Pregunta cuál es la guía del envío, con las sugerencias de la IA. */
export function ConfirmForm({ batch, onUpdated, onZoom }: Props) {
	const guides = batch.candidates.filter((c) => c.type === "guia");
	const invoices = batch.candidates.filter((c) => c.type === "factura");
	const first = guides[0] ?? null;

	const [selected, setSelected] = useState<Candidate | null>(first);
	const [guideNumber, setGuideNumber] = useState(first?.value ?? "");
	const [carrier, setCarrier] = useState(first?.carrier ?? "");
	const [invoiceNumber, setInvoiceNumber] = useState(invoices[0]?.value ?? "");
	const [sending, setSending] = useState(false);
	const [error, setError] = useState<string | null>(null);

	const choose = (c: Candidate) => {
		if (c.type === "factura") {
			setInvoiceNumber(c.value);
			return;
		}
		setSelected(c);
		setGuideNumber(c.value);
		if (c.carrier) setCarrier(c.carrier);
	};

	const submit = async (e: FormEvent) => {
		e.preventDefault();
		if (!guideNumber.trim()) return;
		setSending(true);
		setError(null);
		try {
			onUpdated(
				await api.confirmGuide(batch.id, {
					guideNumber: guideNumber.trim(),
					carrier: carrier.trim() || null,
					invoiceNumber: invoiceNumber.trim() || null,
					sourcePhotoId:
						selected && selected.value === guideNumber ? selected.photoId : null,
				}),
			);
		} catch (err) {
			setError(err instanceof Error ? err.message : "No se pudo confirmar");
			setSending(false);
		}
	};

	const fileName = `${toFileName(guideNumber.trim(), batch.id)}.pdf`;
	const input =
		"mt-1 block w-full rounded-lg border-0 bg-white px-3 py-2.5 text-base text-neutral-900 ring-1 ring-neutral-300 focus:ring-2 focus:ring-brand dark:bg-neutral-800 dark:text-white dark:ring-neutral-600";

	return (
		<form onSubmit={submit} className="mt-4 rounded-xl bg-amber-50 p-4 dark:bg-amber-950/40">
			<h3 className="font-semibold text-amber-950 dark:text-amber-100">
				¿Cuál es la guía de este envío?
			</h3>

			{batch.candidates.length > 0 ? (
				<>
					<p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
						Esto es lo que encontramos en las fotos. Toca una opción o corrígela abajo.
					</p>
					<div className="mt-3 grid gap-2">
						{batch.candidates.map((c) => {
							const isSelected =
								c.type === "guia"
									? selected === c && guideNumber === c.value
									: invoiceNumber === c.value;
							return (
								<button
									type="button"
									key={`${c.type}-${c.value}`}
									onClick={() => choose(c)}
									className={`flex items-center gap-3 rounded-lg p-2 text-left ring-1 transition ${
										isSelected
											? "bg-white ring-2 ring-brand dark:bg-neutral-900"
											: "bg-white/60 ring-black/10 dark:bg-neutral-900/50 dark:ring-white/10"
									}`}
								>
									{c.photoId && (
										<img
											src={photoUrl(batch.id, c.photoId)}
											alt=""
											className="h-12 w-12 flex-none rounded object-cover"
											onClick={(e) => {
												e.stopPropagation();
												onZoom(photoUrl(batch.id, c.photoId!));
											}}
										/>
									)}
									<div className="min-w-0">
										<div className="text-xs font-medium uppercase tracking-wide text-neutral-500">
											{c.type === "guia" ? "Guía" : "Factura"}
											{c.carrier ? ` · ${c.carrier}` : ""}
										</div>
										<div className="truncate font-mono text-base font-semibold text-neutral-900 dark:text-white">
											{c.value}
										</div>
									</div>
								</button>
							);
						})}
					</div>
				</>
			) : (
				<p className="mt-1 text-sm text-amber-900/80 dark:text-amber-200/80">
					No encontramos un número legible. Revisa las fotos y captúralo a mano.
				</p>
			)}

			<div className="mt-4 grid gap-3 sm:grid-cols-3">
				<label className="text-sm font-medium text-neutral-700 dark:text-neutral-200 sm:col-span-3">
					Número de guía *
					<input
						className={`${input} font-mono`}
						value={guideNumber}
						onChange={(e) => setGuideNumber(e.target.value)}
						required
						autoCapitalize="characters"
						autoComplete="off"
					/>
				</label>
				<label className="text-sm font-medium text-neutral-700 dark:text-neutral-200">
					Paquetería
					<input
						className={input}
						value={carrier}
						onChange={(e) => setCarrier(e.target.value)}
						placeholder="FedEx, DHL, Estafeta…"
					/>
				</label>
				<label className="text-sm font-medium text-neutral-700 dark:text-neutral-200 sm:col-span-2">
					Factura
					<input
						className={`${input} font-mono`}
						value={invoiceNumber}
						onChange={(e) => setInvoiceNumber(e.target.value)}
						autoComplete="off"
					/>
				</label>
			</div>

			{guideNumber.trim() && (
				<p className="mt-3 text-xs text-neutral-600 dark:text-neutral-400">
					Se generará <span className="font-mono font-semibold">{fileName}</span>
				</p>
			)}
			{error && <p className="mt-2 text-sm text-red-700 dark:text-red-300">{error}</p>}

			<Button type="submit" disabled={sending || !guideNumber.trim()} className="mt-3 w-full">
				{sending ? <Spinner /> : null} Confirmar y generar PDF
			</Button>
		</form>
	);
}
