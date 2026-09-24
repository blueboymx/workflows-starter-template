import type { ReactNode } from "react";
import type { BatchStatus } from "../../worker/types";
import { STATUS_LABELS } from "../../worker/types";

const STATUS_STYLES: Record<BatchStatus, string> = {
	uploading: "bg-sky-100 text-sky-800 dark:bg-sky-900/50 dark:text-sky-200",
	analyzing: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
	awaiting_confirmation:
		"bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-200",
	generating: "bg-violet-100 text-violet-800 dark:bg-violet-900/50 dark:text-violet-200",
	completed: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/50 dark:text-emerald-200",
	error: "bg-red-100 text-red-800 dark:bg-red-900/50 dark:text-red-200",
};

export function StatusBadge({ status }: { status: BatchStatus }) {
	const busy = status === "analyzing" || status === "generating";
	return (
		<span
			className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ${STATUS_STYLES[status]}`}
		>
			{busy && <Spinner className="h-3 w-3" />}
			{STATUS_LABELS[status]}
		</span>
	);
}

export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
	return (
		<svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
			<circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" opacity="0.25" />
			<path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="3" />
		</svg>
	);
}

type ButtonProps = {
	children: ReactNode;
	onClick?: () => void;
	variant?: "primary" | "secondary" | "danger" | "ghost";
	disabled?: boolean;
	type?: "button" | "submit";
	className?: string;
};

const VARIANTS = {
	primary: "bg-brand text-white hover:bg-brand-dark disabled:bg-brand/50",
	secondary:
		"bg-white text-neutral-800 ring-1 ring-neutral-300 hover:bg-neutral-50 dark:bg-neutral-800 dark:text-neutral-100 dark:ring-neutral-600 dark:hover:bg-neutral-700",
	danger: "text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950",
	ghost: "text-neutral-600 hover:bg-neutral-100 dark:text-neutral-300 dark:hover:bg-neutral-800",
};

export function Button({
	children,
	onClick,
	variant = "primary",
	disabled,
	type = "button",
	className = "",
}: ButtonProps) {
	return (
		<button
			type={type}
			onClick={onClick}
			disabled={disabled}
			className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors disabled:cursor-not-allowed ${VARIANTS[variant]} ${className}`}
		>
			{children}
		</button>
	);
}

export function Lightbox({ src, onClose }: { src: string | null; onClose: () => void }) {
	if (!src) return null;
	return (
		<div
			className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 p-4"
			onClick={onClose}
			role="dialog"
			aria-modal
		>
			<img src={src} alt="" className="max-h-full max-w-full rounded-lg object-contain" />
			<button
				className="absolute right-4 top-4 rounded-full bg-white/15 px-3 py-1 text-sm text-white"
				onClick={onClose}
			>
				Cerrar
			</button>
		</div>
	);
}
