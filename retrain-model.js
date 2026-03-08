const { refreshModel, artifactPath } = require('./model-service');

try {
  const artifact = refreshModel();
  console.log('Model retrained successfully.');
  console.log(`Model version: ${artifact.modelVersion}`);
  console.log(`Artifact path: ${artifactPath}`);
  console.log(`Total records: ${artifact.metadata.totalRecords}`);
  console.log(`Holdout utility precision: ${formatMetric(artifact.metadata.metrics.utility_precision)}`);
  console.log(`False utility rate: ${formatMetric(artifact.metadata.metrics.false_utility_rate)}`);
  console.log(`Baseline false utility rate: ${formatMetric(artifact.metadata.metrics.baseline_false_utility_rate)}`);
} catch (error) {
  console.error(`Retrain failed: ${error.message}`);
  process.exit(1);
}

function formatMetric(value) {
  if (value === null || value === undefined) return 'n/a';
  return `${(value * 100).toFixed(2)}%`;
}
