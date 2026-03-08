# WhatsApp Utility Classifier

Accuracy-focused WhatsApp template validator for internal ops. The app now includes:

- Calibrated utility probability (holdout-based).
- Decision bands: `Safe Utility`, `Borderline`, `Likely Marketing`.
- Explainability panel (utility signals, marketing risks, what to change).
- Structured alternatives with rationale.
- Backend APIs + SQLite feedback loop + retraining scripts.

## Run Local

Option 1:
- `npm start`

Option 2 (double-click):
- `start-local.bat`

Then open:
- `http://localhost:8080`

If you see `ERR_CONNECTION_REFUSED`, it means the server is not running. Start it again and keep that terminal window open.

## API

### `POST /analyze`
Request:

```json
{
  "message": "Hi {{1}}, your order {{2}} is shipped.",
  "context": "SkinKraft renewals",
  "language": "en"
}
```

Response:

```json
{
  "utility_probability": 0.91,
  "decision_band": "Safe Utility",
  "risk_terms": [],
  "explanations": {
    "top_utility_signals": [],
    "top_marketing_risks": [],
    "what_to_change": []
  },
  "alternatives": [],
  "model_version": "model-..."
}
```

### `POST /feedback`
Request:

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
- Periodic retrain worker (default every 24h): `npm run worker`
- Manual API retrain trigger: `POST /retrain`

Model artifact is stored at `data/model-artifact.json`.
Feedback is stored in SQLite at `data/feedback.db`.

## Test

- Run: `npm test`
- Includes checks for guardrails, explanations, and placeholder-safe unique alternatives.

## Notes

- Seed training rows are loaded from `training-data.js`.
- Runtime requires Node `>=22` because this uses built-in `node:sqlite`.
- `data/feedback.db` is gitignored.
- This is backend-enabled. Plain static hosting alone (without the Node API) is not sufficient.
