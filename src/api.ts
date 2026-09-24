import type { Batch, ConfirmedGuide, Photo } from "../worker/types";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, init);
	const body = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error((body as { error?: string }).error ?? `Error ${res.status}`);
	}
	return body as T;
}

export const api = {
	getBatch: (batchId: string) => request<Batch>(`/api/batches/${batchId}`),

	createBatch: () => request<Batch>("/api/batches", { method: "POST" }),

	uploadPhotos: (batchId: string, files: Blob[], names: string[]) => {
		const form = new FormData();
		files.forEach((file, i) => form.append("photos", file, names[i]));
		return request<{
			added: Photo[];
			rejected: { name: string; reason: string }[];
			batch: Batch;
		}>(`/api/batches/${batchId}/photos`, { method: "POST", body: form });
	},

	closeBatch: (batchId: string) =>
		request<Batch>(`/api/batches/${batchId}/close`, { method: "POST" }),

	discardBatch: (batchId: string) =>
		request<{ ok: true }>(`/api/batches/${batchId}`, { method: "DELETE" }),

	confirmGuide: (batchId: string, guide: ConfirmedGuide) =>
		request<Batch>(`/api/batches/${batchId}/confirm`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(guide),
		}),
};

export const photoUrl = (batchId: string, photoId: string) =>
	`/api/batches/${batchId}/photos/${photoId}`;

export const pdfUrl = (batchId: string) => `/api/batches/${batchId}/pdf`;
