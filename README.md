# WhatsApp Utility Classifier

Accuracy-focused WhatsApp template validator for internal ops.

## Modes

- API mode: uses backend endpoints (`/analyze`, `/feedback`, `/model-info`).
- Offline mode: if backend is unavailable, the UI auto-switches to local pretrained inference from `training-data.js`.

## Run Local (API mode)

1. `npm start`
2. Open `http://localhost:8080`

If you see `ERR_CONNECTION_REFUSED`, backend is not running.

## Run Without Backend (offline mode)

Open `index.html` directly in the browser. The app will still analyze messages and generate alternatives locally.

## API

### `POST /analyze`
```json
{
  "message": "Hi {{1}}, your order {{2}} is shipped.",
  "context": "SkinKraft renewals",
  "language": "en"
}
```

### `POST /feedback`
```json
{
  "template_id": "renewal_confirmation",
  "message_submitted": "...",
  "predicted_probability": 0.82,
  "whatsapp_final_label": "utility",
  "submitted_at": "2026-03-08T00:00:00.000Z"
}
```

## Retraining

- One-shot retrain: `npm run retrain`
- Periodic retrain worker: `npm run worker`
- Manual API retrain trigger: `POST /retrain`

## Test

- `npm test`

## Notes

- Seed training rows: `training-data.js`
- Backend storage: `data/feedback.db` (gitignored)
- Node requirement for backend: `>=22`
