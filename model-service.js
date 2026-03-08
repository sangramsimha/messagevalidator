const fs = require('node:fs');
const path = require('node:path');

const { loadSeedRecords } = require('./data-loader');
const { trainModel, predictMessage } = require('./model-core');
const { getFeedbackRecords } = require('./store');

const dataDir = path.join(process.cwd(), 'data');
const artifactPath = path.join(dataDir, 'model-artifact.json');

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

let inMemoryArtifact = null;

function combineTrainingRecords() {
  const seed = loadSeedRecords();
  const feedback = getFeedbackRecords();

  const merged = seed.concat(
    feedback.map((row) => ({
      finalLabel: row.finalLabel,
      templateId: row.templateId,
      message: row.message,
    }))
  );

  return merged;
}

function trainAndPersistModel(version) {
  const records = combineTrainingRecords();
  const artifact = trainModel(records, {
    holdoutRate: 0.2,
    modelVersion: version,
  });

  fs.writeFileSync(artifactPath, JSON.stringify(artifact, null, 2), 'utf8');
  inMemoryArtifact = artifact;
  return artifact;
}

function loadModelArtifact() {
  if (inMemoryArtifact) {
    return inMemoryArtifact;
  }

  if (fs.existsSync(artifactPath)) {
    const raw = fs.readFileSync(artifactPath, 'utf8');
    inMemoryArtifact = JSON.parse(raw);
    return inMemoryArtifact;
  }

  return trainAndPersistModel();
}

function refreshModel(version) {
  return trainAndPersistModel(version);
}

function analyzeMessage(payload) {
  const artifact = loadModelArtifact();
  const message = `${payload.message || ''}`.trim();
  if (!message) {
    throw new Error('message is required');
  }

  const prediction = predictMessage(message, artifact);
  return {
    ...prediction,
    context: payload.context || null,
    language: payload.language || null,
  };
}

function getModelInfo() {
  const artifact = loadModelArtifact();
  return {
    model_version: artifact.modelVersion,
    generated_at: artifact.generatedAt,
    total_records: artifact.metadata.totalRecords,
    train_records: artifact.metadata.trainRecords,
    holdout_records: artifact.metadata.holdoutRecords,
    utility_records: artifact.metadata.utilityRecords,
    marketing_records: artifact.metadata.marketingRecords,
    metrics: artifact.metadata.metrics,
  };
}

module.exports = {
  loadModelArtifact,
  analyzeMessage,
  getModelInfo,
  refreshModel,
  artifactPath,
};
