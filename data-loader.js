const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadSeedRecords(trainingFilePath = path.join(process.cwd(), 'training-data.js')) {
  const raw = fs.readFileSync(trainingFilePath, 'utf8');
  const context = { window: {} };
  vm.createContext(context);
  vm.runInContext(raw, context);
  const records = Array.isArray(context.window.PRETRAINED_RECORDS)
    ? context.window.PRETRAINED_RECORDS
    : [];

  return records
    .map((row) => ({
      finalLabel: normalizeLabel(row.finalLabel),
      templateId: `${row.templateId || ''}`.trim(),
      message: `${row.message || ''}`.trim(),
    }))
    .filter((row) => row.finalLabel && row.message);
}

function normalizeLabel(value) {
  const text = `${value || ''}`.toLowerCase();
  if (text.includes('utility')) return 'utility';
  if (text.includes('market')) return 'marketing';
  return null;
}

module.exports = {
  loadSeedRecords,
  normalizeLabel,
};
