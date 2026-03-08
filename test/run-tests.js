const assert = require('node:assert/strict');

const { loadSeedRecords } = require('../data-loader');
const { trainModel, predictMessage } = require('../model-core');

function run() {
  const records = loadSeedRecords();
  const model = trainModel(records, { modelVersion: 'test-model' });

  assert.ok(model.metadata.totalRecords >= 100);
  assert.equal(typeof model.modelVersion, 'string');

  const promo = predictMessage(
    'Hi {{1}}, limited time offer! Buy now and get 30% discount with cashback. Shop now {{2}}',
    model
  );
  assert.equal(promo.decision_band, 'Likely Marketing');
  assert.ok(promo.risk_terms.length >= 1);

  const transactional = predictMessage(
    'Hi {{1}}, your order {{2}} has been dispatched and will be delivered by {{3}}.',
    model
  );
  assert.ok(['Safe Utility', 'Borderline', 'Likely Marketing'].includes(transactional.decision_band));
  assert.ok(Array.isArray(transactional.explanations.top_utility_signals));
  assert.ok(Array.isArray(transactional.explanations.top_marketing_risks));
  assert.ok(Array.isArray(transactional.explanations.what_to_change));
  assert.ok(transactional.alternatives.length > 0);

  const placeholderSource = 'Hi {{1}}, your invoice {{2}} is due on {{3}}.';
  const placeholderResult = predictMessage(placeholderSource, model);
  const seen = new Set();

  for (const alt of placeholderResult.alternatives) {
    const key = alt.message.toLowerCase();
    assert.ok(!seen.has(key));
    seen.add(key);

    for (const ph of ['{{1}}', '{{2}}', '{{3}}']) {
      assert.ok(alt.message.includes(ph));
    }
  }

  console.log('All tests passed.');
}

run();
