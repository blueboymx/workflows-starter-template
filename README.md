# Evidencia de envíos · Retail Inteligencia Analítica

App web (pensada para el teléfono) para identificar las fotos de los paquetes que se envían:

1. **Subir fotos por lote.** Desde el teléfono (cámara o galería) o dejándolas en un *hot folder* en la computadora. Cada lote es **un solo envío**.
2. **"¿Hay más fotos de este envío?"** Después de cada subida la app pregunta. Mientras el lote está abierto, todas las fotos van a ese lote. Al contestar "No" se cierra y **ya no acepta más fotos**, así que dos envíos no se mezclan.
3. **Detección con IA.** Workers AI (modelo de visión) revisa cada foto: si es guía, factura o paquete, y lee el número de guía, la paquetería y el número de factura.
4. **Confirmación.** La app muestra lo que encontró y pregunta cuál es la guía. Se puede corregir o capturar a mano.
5. **PDF.** Se genera un PDF **tamaño carta vertical** con el logotipo de RETAIL INTELIGENCIA ANALITICA, el número de guía en el título y todas las fotos del lote (una por página, primero la de la guía). El archivo se llama `<número de guía>.pdf`.
6. **Flujo de envíos (opcional).** Al terminar se manda un webhook con la guía, la factura y el enlace al PDF, para conectar el flujo complementario de envíos.

## Arquitectura (Cloudflare)

| Pieza | Uso |
| --- | --- |
| Worker (`worker/index.ts`) | API REST y archivos estáticos de la app React |
| Workflow (`worker/workflow.ts`) | Pasos durables: análisis por foto → candidatos → **espera la confirmación** (`waitForEvent`, hasta 7 días) → PDF → webhook |
| Durable Object (`worker/shipments-do.ts`) | Estado de los lotes (SQLite), reglas de estado y WebSocket en vivo para todas las pantallas |
| R2 (`PHOTOS`) | Fotos originales (`batches/…`) y PDFs (`pdfs/<lote>/<guía>.pdf`) |
| Workers AI (`AI`) | Lectura de guías y facturas (`VISION_MODEL` en `wrangler.jsonc`) |

## Puesta en marcha

```bash
npm install
npx wrangler login
npx wrangler r2 bucket create evidencia-envios
npm run deploy
```

### Logotipo

Coloca el logotipo oficial en `public/logo.png` (o `public/logo.jpg`) y vuelve a desplegar. Se usa en la app y en el encabezado del PDF. Si no existe, se dibuja un logotipo de texto "RETAIL / INTELIGENCIA ANALITICA".

### Webhook para el flujo de envíos (opcional)

```bash
npx wrangler secret put SHIPMENTS_WEBHOOK_URL
npx wrangler secret put SHIPMENTS_WEBHOOK_TOKEN   # opcional, se manda como Bearer
```

Payload:

```json
{
  "event": "shipment.evidence_ready",
  "batchId": "20260924-a1b2c3",
  "guideNumber": "794612345678",
  "carrier": "FedEx",
  "invoiceNumber": "A-1520",
  "photoCount": 4,
  "pdfName": "794612345678.pdf",
  "pdfUrl": "https://…/api/batches/20260924-a1b2c3/pdf"
}
```

### Acceso

La app no incluye inicio de sesión. Las fotos y facturas son información sensible, así que protege el dominio con **Cloudflare Access (Zero Trust)** antes de usarla en producción.

## Hot folder (computadora)

```bash
npm run hot-folder -- --url https://evidencia-envios.<tu-cuenta>.workers.dev --dir ./hotfolder
```

- Crea **una subcarpeta por envío** dentro de `hotfolder/` y copia ahí sus fotos (JPG/PNG).
- Cuando la subcarpeta pasa 20 s sin cambios (`--settle`), se suben las fotos, se cierra el lote y la carpeta se mueve a `_procesados/`. Si falla, se mueve a `_errores/`.
- Las fotos sueltas en la raíz se ignoran a propósito, para no mezclar envíos.
- La confirmación de la guía se hace en la app web.
- Con Cloudflare Access usa un *service token*: `CF_ACCESS_CLIENT_ID` y `CF_ACCESS_CLIENT_SECRET`.

## Desarrollo

```bash
npm run dev           # requiere wrangler login (Workers AI es remoto)
npm run dev:offline   # sin cuenta: la IA falla y la guía se captura a mano
npm test              # pruebas (IA simulada)
npm run lint
```

## API

| Método | Ruta | |
| --- | --- | --- |
| GET | `/api/batches` | Últimos 50 lotes |
| POST | `/api/batches` | Abre un lote (`{"source":"hot-folder"}` opcional) |
| GET | `/api/batches/:id` | Detalle |
| POST | `/api/batches/:id/photos` | Sube fotos (multipart, campo `photos`, JPG/PNG ≤ 20 MB) |
| POST | `/api/batches/:id/close` | Cierra el lote e inicia el procesamiento |
| POST | `/api/batches/:id/confirm` | `{"guideNumber","carrier","invoiceNumber","sourcePhotoId"}` |
| DELETE | `/api/batches/:id` | Descarta un lote abierto o con error |
| GET | `/api/batches/:id/pdf` | PDF |
| GET | `/api/batches/:id/photos/:photoId` | Foto |
| GET | `/ws` | WebSocket con actualizaciones en vivo |
