# WhatsApp Utility Classifier

A lightweight browser-based tool to help your team validate whether a template is likely to be approved as **Utility** vs **Marketing** on WhatsApp.

## What it does

- Uses a pretrained model built from your approved/rejected historical CSV labels.
- Gives a utility approval likelihood percentage for a new message.
- Suggests 5 alternative message variants optimized for utility classification.

## Run

1. Open `index.html` in a browser.
2. Paste a candidate message.
3. Click **Analyze Message**.

## Data source

- Pretrained rows are stored in `training-data.js`.
- Current build includes `128` labeled rows from your CSV (`Uploaded in` = Utility/Marketing, non-empty message).

## Notes

- Entire tool runs locally in browser.
- No server or external API is used for inference.
