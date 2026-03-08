const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const dataDir = path.join(process.cwd(), 'data');
const dbPath = path.join(dataDir, 'feedback.db');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

const db = new DatabaseSync(dbPath);
db.exec(`
  CREATE TABLE IF NOT EXISTS template_reviews (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id TEXT,
    message_submitted TEXT NOT NULL,
    predicted_probability REAL,
    whatsapp_final_label TEXT NOT NULL CHECK (whatsapp_final_label IN ('utility', 'marketing')),
    submitted_at TEXT NOT NULL,
    model_version TEXT,
    context TEXT,
    language TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
`);

db.exec('CREATE INDEX IF NOT EXISTS idx_template_reviews_label ON template_reviews(whatsapp_final_label);');
db.exec('CREATE INDEX IF NOT EXISTS idx_template_reviews_submitted_at ON template_reviews(submitted_at);');

const insertStmt = db.prepare(`
  INSERT INTO template_reviews (
    template_id,
    message_submitted,
    predicted_probability,
    whatsapp_final_label,
    submitted_at,
    model_version,
    context,
    language
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?);
`);

const selectLabeledStmt = db.prepare(`
  SELECT
    id,
    COALESCE(template_id, '') AS template_id,
    message_submitted,
    whatsapp_final_label,
    submitted_at
  FROM template_reviews
  WHERE whatsapp_final_label IN ('utility', 'marketing')
  ORDER BY id ASC;
`);

function insertFeedback(payload) {
  insertStmt.run(
    payload.template_id || null,
    payload.message_submitted,
    payload.predicted_probability,
    payload.whatsapp_final_label,
    payload.submitted_at,
    payload.model_version || null,
    payload.context || null,
    payload.language || null
  );
}

function getFeedbackRecords() {
  const rows = selectLabeledStmt.all();
  return rows.map((row) => ({
    templateId: row.template_id,
    message: row.message_submitted,
    finalLabel: row.whatsapp_final_label,
    submittedAt: row.submitted_at,
  }));
}

function countFeedbackRows() {
  const row = db.prepare('SELECT COUNT(*) AS count FROM template_reviews;').get();
  return row ? row.count : 0;
}

module.exports = {
  insertFeedback,
  getFeedbackRecords,
  countFeedbackRows,
  dbPath,
};
