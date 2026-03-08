const { refreshModel } = require('./model-service');

const intervalHours = Number(process.env.RETRAIN_INTERVAL_HOURS || 24);
const intervalMs = Math.max(1, intervalHours) * 60 * 60 * 1000;

runOnce();
setInterval(runOnce, intervalMs);

function runOnce() {
  try {
    const artifact = refreshModel();
    console.log(
      `[${new Date().toISOString()}] Retrained model ${artifact.modelVersion} ` +
      `(records=${artifact.metadata.totalRecords}, precision=${formatMetric(artifact.metadata.metrics.utility_precision)})`
    );
  } catch (error) {
    console.error(`[${new Date().toISOString()}] Retrain failed: ${error.message}`);
  }
}

function formatMetric(value) {
  if (value === null || value === undefined) return 'n/a';
  return `${(value * 100).toFixed(2)}%`;
}
