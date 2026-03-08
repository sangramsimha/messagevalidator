const analyzeBtn = document.getElementById('analyzeBtn');
const submitFeedbackBtn = document.getElementById('submitFeedbackBtn');
const candidateMessage = document.getElementById('candidateMessage');
const contextInput = document.getElementById('contextInput');
const languageInput = document.getElementById('languageInput');
const templateIdInput = document.getElementById('templateIdInput');
const finalLabelInput = document.getElementById('finalLabelInput');

const trainingStatus = document.getElementById('trainingStatus');
const analyzeStatus = document.getElementById('analyzeStatus');
const feedbackStatus = document.getElementById('feedbackStatus');
const utilityScore = document.getElementById('utilityScore');
const meterFill = document.getElementById('meterFill');
const scoreNote = document.getElementById('scoreNote');
const decisionBandNode = document.getElementById('decisionBand');
const utilitySignals = document.getElementById('utilitySignals');
const riskSignals = document.getElementById('riskSignals');
const changeList = document.getElementById('changeList');
const alternativesList = document.getElementById('alternativesList');
const metricsRow = document.getElementById('metricsRow');

const runtime = {
  mode: 'api',
  localArtifact: null,
  lastPrediction: null,
};

const utilityHints = [
  'order', 'shipment', 'delivery', 'dispatched', 'invoice', 'payment',
  'receipt', 'otp', 'verification', 'account', 'service', 'ticket',
  'request', 'appointment', 'due', 'reminder', 'support', 'transaction',
  'reference', 'status', 'confirmed', 'scheduled', 'renewal'
];

const marketingHints = [
  'offer', 'sale', 'discount', 'deal', 'buy', 'shop', 'limited',
  'hurry', 'free', 'coupon', 'cashback', 'promo', 'festival sale',
  'exclusive', 'new launch', 'best price', 'save', 'upgrade now',
  'flat rs', 'explore now', 'shop now', 'buy now', 'redeem'
];

const ctaPatterns = [
  /\b(buy now|shop now|redeem now|grab now|explore now)\b/i,
  /\b(limited time|hurry|ends soon|don't miss)\b/i,
  /\b(flat\s*rs\.?\s*\d+|\d+%\s*off|cashback)\b/i,
];

const utilityAnchors = [
  'this is a service update related to your existing request.',
  'this message is sent for an existing transaction or service interaction.',
  'no promotion is included in this update.'
];

initialize();
analyzeBtn.addEventListener('click', onAnalyze);
submitFeedbackBtn.addEventListener('click', onSubmitFeedback);
candidateMessage.addEventListener('keydown', (event) => {
  if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
    onAnalyze();
  }
});

async function initialize() {
  try {
    const modelInfo = await fetchJson('/model-info', { method: 'GET' });
    runtime.mode = 'api';
    setStatus(trainingStatus, `API model ${modelInfo.model_version} loaded (${modelInfo.total_records} records).`, false);
    renderMetrics(modelInfo);
    setStatus(analyzeStatus, 'Model ready. Paste a message and click Analyze.', false);
  } catch {
    runtime.mode = 'local';
    const records = normalizeRecords(window.PRETRAINED_RECORDS || []);
    runtime.localArtifact = trainLocalModel(records);
    const info = localModelInfo(runtime.localArtifact);
    setStatus(trainingStatus, `Local model loaded (${info.total_records} records). Backend not required.`, false);
    renderMetrics(info);
    setStatus(analyzeStatus, 'Offline mode active. Paste a message and click Analyze.', false);
  }
}

async function onAnalyze() {
  const message = (candidateMessage.value || '').trim();
  if (!message) {
    setStatus(analyzeStatus, 'Please enter a message template to analyze.', true);
    return;
  }

  setStatus(analyzeStatus, 'Analyzing message...', false);

  try {
    let result;
    if (runtime.mode === 'api') {
      result = await fetchJson('/analyze', {
        method: 'POST',
        body: {
          message,
          context: contextInput.value.trim() || null,
          language: languageInput.value.trim() || null,
        },
      });
    } else {
      result = localAnalyze(message, runtime.localArtifact);
    }

    runtime.lastPrediction = {
      message,
      utility_probability: result.utility_probability,
      model_version: result.model_version,
      context: contextInput.value.trim() || null,
      language: languageInput.value.trim() || null,
    };

    renderPrediction(result);
    setStatus(analyzeStatus, runtime.mode === 'api' ? 'Analysis complete.' : 'Analysis complete (offline mode).', false);
    setStatus(feedbackStatus, 'Submit final WhatsApp outcome below when available.', false);
  } catch (error) {
    setStatus(analyzeStatus, `Analyze failed: ${error.message}`, true);
  }
}

async function onSubmitFeedback() {
  if (!runtime.lastPrediction) {
    setStatus(feedbackStatus, 'Analyze a message before submitting feedback.', true);
    return;
  }

  const finalLabel = finalLabelInput.value;
  if (!finalLabel) {
    setStatus(feedbackStatus, 'Please select final WhatsApp label before submitting.', true);
    return;
  }

  const payload = {
    template_id: templateIdInput.value.trim() || null,
    message_submitted: runtime.lastPrediction.message,
    predicted_probability: runtime.lastPrediction.utility_probability,
    whatsapp_final_label: finalLabel,
    submitted_at: new Date().toISOString(),
    model_version: runtime.lastPrediction.model_version,
    context: runtime.lastPrediction.context,
    language: runtime.lastPrediction.language,
  };

  if (runtime.mode === 'api') {
    try {
      const result = await fetchJson('/feedback', { method: 'POST', body: payload });
      setStatus(feedbackStatus, `Feedback saved. Total feedback rows: ${result.total_feedback_rows}.`, false);
      return;
    } catch (error) {
      setStatus(feedbackStatus, `Feedback failed: ${error.message}`, true);
      return;
    }
  }

  const key = 'wmv_feedback_queue';
  const queue = JSON.parse(localStorage.getItem(key) || '[]');
  queue.push(payload);
  localStorage.setItem(key, JSON.stringify(queue));
  setStatus(feedbackStatus, `Offline mode: feedback saved locally (${queue.length} queued).`, false);
}

function renderPrediction(result) {
  const pct = Math.round((result.utility_probability || 0) * 10000) / 100;
  utilityScore.textContent = `${pct}%`;
  meterFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;

  const band = result.decision_band || 'Borderline';
  decisionBandNode.textContent = band;
  decisionBandNode.className = `badge ${badgeClassForBand(band)}`;

  const riskText = (result.risk_terms || []).length
    ? `Risk terms: ${(result.risk_terms || []).slice(0, 6).join(', ')}.`
    : 'No major marketing-risk terms detected.';
  const calibrationText = result.explanations?.calibration_note || '';
  setStatus(scoreNote, `${riskText} ${calibrationText}`.trim(), (result.risk_terms || []).length > 0);

  renderExplanationList(
    utilitySignals,
    (result.explanations?.top_utility_signals || []).map((item) => `${item.term} (impact ${item.impact})`),
    'No strong utility signals detected.'
  );
  renderExplanationList(
    riskSignals,
    (result.explanations?.top_marketing_risks || []).map((item) => `${item.term} (${item.source})`),
    'No high-risk signals detected.'
  );
  renderExplanationList(changeList, result.explanations?.what_to_change || [], 'No changes suggested.');
  renderAlternatives(result.alternatives || []);
}

function renderAlternatives(alternatives) {
  alternativesList.innerHTML = '';
  if (!alternatives.length) {
    const empty = document.createElement('p');
    empty.textContent = 'No alternatives generated.';
    alternativesList.appendChild(empty);
    return;
  }

  for (const alt of alternatives) {
    const card = document.createElement('article');
    card.className = 'alt-card';

    const head = document.createElement('div');
    head.className = 'alt-head';

    const meta = document.createElement('div');
    meta.textContent = `${Math.round((alt.utility_probability || 0) * 100)}% · ${alt.decision_band || 'Borderline'}`;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(alt.message || '');
        copyBtn.textContent = 'Copied';
        setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1000);
      } catch {
        copyBtn.textContent = 'Copy failed';
      }
    });

    head.appendChild(meta);
    head.appendChild(copyBtn);

    const msg = document.createElement('p');
    msg.className = 'alt-message';
    msg.textContent = alt.message || '';

    const rationale = document.createElement('p');
    rationale.className = 'alt-rationale';
    rationale.textContent = alt.rationale || '';

    card.appendChild(head);
    card.appendChild(msg);
    card.appendChild(rationale);
    alternativesList.appendChild(card);
  }
}

function renderExplanationList(node, items, fallback) {
  node.innerHTML = '';
  const list = items.length ? items : [fallback];
  for (const item of list) {
    const li = document.createElement('li');
    li.textContent = item;
    node.appendChild(li);
  }
}

function renderMetrics(info) {
  metricsRow.innerHTML = '';
  const metrics = [
    { label: 'Holdout Precision', value: asPercent(info.metrics?.utility_precision) },
    { label: 'False Utility Rate', value: asPercent(info.metrics?.false_utility_rate) },
    { label: 'Baseline FUR', value: asPercent(info.metrics?.baseline_false_utility_rate) },
    { label: 'Holdout Rows', value: `${info.holdout_records || 0}` },
  ];

  for (const metric of metrics) {
    const card = document.createElement('div');
    card.className = 'metric';
    card.innerHTML = `<span>${metric.label}</span><strong>${metric.value}</strong>`;
    metricsRow.appendChild(card);
  }
}

function badgeClassForBand(band) {
  if (band === 'Safe Utility') return 'badge-safe';
  if (band === 'Likely Marketing') return 'badge-marketing';
  if (band === 'Borderline') return 'badge-borderline';
  return 'badge-neutral';
}

function setStatus(node, message, isWarning) {
  node.textContent = message;
  node.classList.toggle('muted', !isWarning);
}

async function fetchJson(url, options) {
  const config = {
    method: options.method,
    headers: { 'Content-Type': 'application/json' },
  };
  if (options.body) config.body = JSON.stringify(options.body);

  const response = await fetch(url, config);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.error || `HTTP ${response.status}`);
  }
  return payload;
}

function asPercent(value) {
  if (value === null || value === undefined) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function normalizeRecords(records) {
  return (Array.isArray(records) ? records : [])
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

function trainLocalModel(records) {
  const { train, holdout } = splitRecords(records, 0.2);
  const rawModel = buildRawModel(train.length ? train : records);
  const draft = { rawModel, calibration: { enabled: false, a: 1, b: 0 } };

  const samples = holdout.map((row) => {
    const score = computeScore(row.message, draft, false);
    return { x: logit(score.probability), y: row.finalLabel === 'utility' ? 1 : 0 };
  });

  const calibration = fitPlatt(samples);
  const artifact = {
    modelVersion: `local-${new Date().toISOString().replace(/[:.]/g, '-')}`,
    rawModel,
    calibration,
    metadata: evaluateMetrics(holdout, rawModel, calibration),
  };

  return artifact;
}

function localModelInfo(artifact) {
  return {
    model_version: artifact.modelVersion,
    total_records: artifact.metadata.totalRecords,
    holdout_records: artifact.metadata.holdoutRecords,
    utility_records: artifact.metadata.utilityRecords,
    marketing_records: artifact.metadata.marketingRecords,
    metrics: artifact.metadata.metrics,
  };
}

function localAnalyze(message, artifact) {
  const score = computeScore(message, artifact, true);
  const calibrated = calibrate(score.probability, artifact.calibration);
  const band = decisionBand(calibrated, score.riskTerms, score.guardrail, message);

  return {
    utility_probability: round(calibrated, 4),
    decision_band: band,
    risk_terms: score.riskTerms,
    explanations: buildExplanations(message, score, artifact),
    alternatives: generateAlternatives(message, artifact).slice(0, 5),
    model_version: artifact.modelVersion,
  };
}

function splitRecords(records, holdoutRate) {
  const train = [];
  const holdout = [];
  for (const row of records) {
    const key = `${row.templateId}|${row.message}`;
    const bucket = fnv1a(key) % 100;
    if (bucket < Math.round(holdoutRate * 100)) holdout.push(row);
    else train.push(row);
  }
  if (!train.length || holdout.length < 8) {
    return { train: records.slice(), holdout: [] };
  }
  return { train, holdout };
}

function buildRawModel(records) {
  const classes = {
    utility: { docs: 0, tokens: 0, tokenCounts: Object.create(null) },
    marketing: { docs: 0, tokens: 0, tokenCounts: Object.create(null) },
  };
  const vocab = new Set();

  for (const row of records) {
    const cls = classes[row.finalLabel];
    if (!cls) continue;
    cls.docs += 1;
    const tokens = tokenize(row.message);
    for (const token of tokens) {
      vocab.add(token);
      cls.tokens += 1;
      cls.tokenCounts[token] = (cls.tokenCounts[token] || 0) + 1;
    }
  }

  return { classes, vocabSize: Math.max(vocab.size, 1), totalDocs: classes.utility.docs + classes.marketing.docs };
}

function tokenize(text) {
  return `${text || ''}`
    .toLowerCase()
    .replace(/\{\{[^}]+\}\}/g, ' placeholder ')
    .replace(/[^a-z0-9%\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function computeScore(message, artifact, applyGuardrail) {
  const tokens = tokenize(message);
  const utility = artifact.rawModel.classes.utility;
  const marketing = artifact.rawModel.classes.marketing;

  let utilLog = Math.log((utility.docs + 1) / (artifact.rawModel.totalDocs + 2));
  let mktLog = Math.log((marketing.docs + 1) / (artifact.rawModel.totalDocs + 2));

  const tokenImpacts = Object.create(null);
  for (const token of tokens) {
    const utilTerm = Math.log(((utility.tokenCounts[token] || 0) + 1) / (utility.tokens + artifact.rawModel.vocabSize));
    const mktTerm = Math.log(((marketing.tokenCounts[token] || 0) + 1) / (marketing.tokens + artifact.rawModel.vocabSize));
    utilLog += utilTerm;
    mktLog += mktTerm;
    tokenImpacts[token] = (tokenImpacts[token] || 0) + (utilTerm - mktTerm);
  }

  const bayes = 1 / (1 + Math.exp(mktLog - utilLog));
  const rule = computeRuleProbability(message);
  let blended = 0.65 * bayes + 0.35 * rule;
  if (tokens.length <= 4) blended *= 0.9;

  const guardrail = applyPromoGuardrail(message, blended);
  if (applyGuardrail) blended = guardrail.cappedProbability;

  return {
    probability: clamp(blended, 0.01, 0.99),
    riskTerms: guardrail.riskTerms,
    guardrail,
    tokenImpacts,
  };
}

function computeRuleProbability(message) {
  const lower = `${message || ''}`.toLowerCase();
  let score = 0;
  for (const term of utilityHints) if (lower.includes(term)) score += 0.7;
  for (const term of marketingHints) if (lower.includes(term)) score -= 1.4;
  if (/\b(hello|hi|dear)\b/.test(lower)) score += 0.1;
  if (/\b(\d{4,}|\{\{\d+\}\})\b/.test(lower)) score += 0.25;
  for (const p of ctaPatterns) if (p.test(lower)) score -= 1.25;
  return sigmoid(score);
}

function applyPromoGuardrail(message, probability) {
  const lower = `${message || ''}`.toLowerCase();
  const risks = Array.from(new Set(marketingHints.filter((term) => lower.includes(term))));
  const patternHits = ctaPatterns.filter((p) => p.test(lower)).length;

  let cap = 0.99;
  if (patternHits >= 1 && risks.length >= 2) cap = 0.45;
  else if (risks.length >= 2) cap = 0.6;
  else if (patternHits >= 1 || risks.length === 1) cap = 0.75;

  return {
    riskTerms: risks,
    cap,
    cappedProbability: Math.min(probability, cap),
  };
}

function fitPlatt(samples) {
  if (samples.length < 20) return { enabled: false, a: 1, b: 0 };
  const positives = samples.filter((s) => s.y === 1).length;
  const negatives = samples.length - positives;
  if (!positives || !negatives) return { enabled: false, a: 1, b: 0 };

  let a = 1;
  let b = 0;
  let lr = 0.08;

  for (let epoch = 0; epoch < 400; epoch += 1) {
    let ga = 0;
    let gb = 0;
    for (const s of samples) {
      const pred = sigmoid(a * s.x + b);
      const err = pred - s.y;
      ga += err * s.x;
      gb += err;
    }
    ga /= samples.length;
    gb /= samples.length;
    a -= lr * ga;
    b -= lr * gb;
    lr *= 0.996;
  }

  return { enabled: true, a, b };
}

function calibrate(probability, calibration) {
  if (!calibration || !calibration.enabled) return clamp(probability, 0.01, 0.99);
  return clamp(sigmoid(calibration.a * logit(probability) + calibration.b), 0.01, 0.99);
}

function decisionBand(probability, riskTerms, guardrail, message) {
  const transactionalContext = /\b(order|invoice|ticket|request|reference|otp|service|account|payment|shipment|delivery)\b/i.test(message || '');
  if ((guardrail && guardrail.cap <= 0.6) || probability < 0.45) return 'Likely Marketing';
  if (probability >= 0.85 && (!riskTerms || !riskTerms.length) && transactionalContext && (!guardrail || guardrail.cap > 0.75)) {
    return 'Safe Utility';
  }
  return 'Borderline';
}

function evaluateMetrics(holdout, rawModel, calibration) {
  const counts = {
    totalRecords: rawModel.totalDocs,
    holdoutRecords: holdout.length,
    utilityRecords: rawModel.classes.utility.docs,
    marketingRecords: rawModel.classes.marketing.docs,
  };

  if (!holdout.length) {
    return {
      ...counts,
      metrics: {
        utility_precision: null,
        false_utility_rate: null,
        baseline_false_utility_rate: null,
      },
    };
  }

  let tp = 0; let fp = 0; let baseFp = 0; let marketingTotal = 0;
  for (const row of holdout) {
    const base = computeScore(row.message, { rawModel, calibration }, false);
    const improved = computeScore(row.message, { rawModel, calibration }, true);
    const baseBand = base.probability >= 0.8;
    const impBand = decisionBand(calibrate(improved.probability, calibration), improved.riskTerms, improved.guardrail, row.message) === 'Safe Utility';

    if (row.finalLabel === 'marketing') marketingTotal += 1;
    if (baseBand && row.finalLabel === 'marketing') baseFp += 1;
    if (impBand && row.finalLabel === 'utility') tp += 1;
    if (impBand && row.finalLabel === 'marketing') fp += 1;
  }

  return {
    ...counts,
    metrics: {
      utility_precision: tp + fp ? tp / (tp + fp) : null,
      false_utility_rate: marketingTotal ? fp / marketingTotal : null,
      baseline_false_utility_rate: marketingTotal ? baseFp / marketingTotal : null,
    },
  };
}

function buildExplanations(message, score, artifact) {
  const utility = [];
  const risks = [];

  for (const [term, impact] of Object.entries(score.tokenImpacts || {})) {
    if (impact > 0.05) utility.push({ term, impact: round(impact, 3) });
    if (impact < -0.05) risks.push({ term, impact: round(Math.abs(impact), 3), source: 'token' });
  }

  utility.sort((a, b) => b.impact - a.impact);
  risks.sort((a, b) => b.impact - a.impact);

  for (const term of score.riskTerms) {
    if (!risks.find((r) => r.term === term)) risks.push({ term, impact: 1, source: 'rule' });
  }

  const changes = [];
  if (score.riskTerms.length) changes.push(`Remove promotional terms: ${score.riskTerms.slice(0, 5).join(', ')}.`);
  if (!/\b(order|invoice|ticket|request|reference|otp|service|account)\b/i.test(message)) {
    changes.push('Add a clear transaction reference (order, ticket, invoice, OTP, etc.).');
  }
  if (!/\b(existing|already|requested|scheduled|status|confirmation)\b/i.test(message)) {
    changes.push('Make the message explicitly about an existing service interaction.');
  }
  if (!changes.length) changes.push('Keep language strictly transactional and avoid promotional CTA words.');

  return {
    top_utility_signals: utility.slice(0, 5),
    top_marketing_risks: risks.slice(0, 5),
    what_to_change: changes.slice(0, 4),
    calibration_note: artifact.calibration.enabled ? 'Calibrated using holdout split.' : 'Calibration disabled due to low holdout diversity.',
  };
}

function generateAlternatives(message, artifact) {
  const placeholders = extractPlaceholders(message);
  const intent = detectIntent(message);
  const cleaned = cleanMarketingLanguage(message);

  const pool = new Set();
  for (const t of getIntentTemplates(intent, placeholders)) {
    pool.add(ensurePlaceholders(t, placeholders));
    pool.add(ensurePlaceholders(`${t} ${utilityAnchors[0]}`, placeholders));
  }
  pool.add(ensurePlaceholders(`${cleaned} ${utilityAnchors[1]}`, placeholders));
  pool.add(ensurePlaceholders(`${cleaned} ${utilityAnchors[2]}`, placeholders));

  const original = message.toLowerCase();
  const scored = Array.from(pool)
    .map((candidate) => {
      const compact = candidate.replace(/\s+/g, ' ').trim();
      const s = computeScore(compact, artifact, true);
      const p = calibrate(s.probability, artifact.calibration);
      return {
        message: compact,
        utility_probability: round(p, 4),
        decision_band: decisionBand(p, s.riskTerms, s.guardrail, compact),
        rationale: alternativeRationale(original, compact.toLowerCase(), s.riskTerms),
      };
    })
    .sort((a, b) => b.utility_probability - a.utility_probability);

  const dedup = [];
  const seen = new Set();
  for (const item of scored) {
    const key = item.message.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    dedup.push(item);
  }

  const safe = dedup.filter((d) => d.utility_probability >= 0.95);
  return safe.length >= 5 ? safe.slice(0, 5) : dedup.slice(0, 5);
}

function alternativeRationale(originalLower, candidateLower, risks) {
  const removedPromo = marketingHints.filter((term) => originalLower.includes(term) && !candidateLower.includes(term)).slice(0, 3);
  const addedUtility = utilityHints.filter((term) => candidateLower.includes(term) && !originalLower.includes(term)).slice(0, 3);

  const parts = [];
  if (removedPromo.length) parts.push(`Removed promo terms: ${removedPromo.join(', ')}`);
  if (addedUtility.length) parts.push(`Added transactional cues: ${addedUtility.join(', ')}`);
  if (!parts.length) parts.push('Uses neutral transactional language.');
  if (risks.length) parts.push(`Review residual risks: ${risks.slice(0, 2).join(', ')}`);
  return `${parts.join('. ')}.`;
}

function detectIntent(message) {
  const lower = `${message || ''}`.toLowerCase();
  if (/otp|verification|code/.test(lower)) return 'otp';
  if (/order|shipment|delivery|dispatch|tracking/.test(lower)) return 'order';
  if (/payment|invoice|bill|due|amount/.test(lower)) return 'payment';
  if (/appointment|visit|scheduled|reschedule/.test(lower)) return 'appointment';
  if (/ticket|support|request|complaint/.test(lower)) return 'support';
  if (/account|login|password|profile/.test(lower)) return 'account';
  return 'service';
}

function getIntentTemplates(intent, placeholders) {
  const p1 = placeholders[0] || '{{1}}';
  const p2 = placeholders[1] || '{{2}}';
  const p3 = placeholders[2] || '{{3}}';

  const map = {
    otp: [
      `Hello ${p1}, your verification code is ${p2}. This code is valid for 10 minutes for your existing login request.`,
      `Hi ${p1}, use OTP ${p2} to complete your requested verification. Do not share this code with anyone.`,
      `Dear ${p1}, ${p2} is your one-time code for your account verification request.`,
    ],
    order: [
      `Hello ${p1}, your order ${p2} is currently ${p3}. This update is regarding your existing purchase request.`,
      `Hi ${p1}, order ${p2} status: ${p3}. Reply if you need support for this order.`,
      `Dear ${p1}, your shipment for order ${p2} has an update: ${p3}.`,
    ],
    payment: [
      `Hello ${p1}, invoice ${p2} for amount ${p3} is due. This is a payment reminder for your existing service.`,
      `Hi ${p1}, we received your payment for invoice ${p2}. Transaction reference: ${p3}.`,
      `Dear ${p1}, your billing update for invoice ${p2}: ${p3}.`,
    ],
    appointment: [
      `Hello ${p1}, your appointment ${p2} is scheduled for ${p3}. This is a service confirmation message.`,
      `Hi ${p1}, appointment ${p2} has been updated to ${p3}.`,
      `Dear ${p1}, reminder: your appointment ${p2} is on ${p3}.`,
    ],
    support: [
      `Hello ${p1}, your support ticket ${p2} status is ${p3}. This update is for your existing request.`,
      `Hi ${p1}, ticket ${p2} has been updated: ${p3}.`,
      `Dear ${p1}, we have an update for service request ${p2}: ${p3}.`,
    ],
    account: [
      `Hello ${p1}, your account request ${p2} is now ${p3}. This is a service-related update.`,
      `Hi ${p1}, account activity alert: ${p2}. Reference: ${p3}.`,
      `Dear ${p1}, your account update for request ${p2}: ${p3}.`,
    ],
    service: [
      `Hello ${p1}, your service request ${p2} has an update: ${p3}.`,
      `Hi ${p1}, this is an update regarding your existing request ${p2}: ${p3}.`,
      `Dear ${p1}, transaction update for reference ${p2}: ${p3}.`,
    ],
  };

  return map[intent] || map.service;
}

function cleanMarketingLanguage(message) {
  let out = ` ${message || ''} `;
  const phrases = ['limited time', 'buy now', 'shop now', 'best price', 'exclusive offer', 'festival sale', 'discount', 'cashback', 'coupon', 'deal'];
  for (const p of phrases) {
    out = out.replace(new RegExp(`\\b${escapeRegex(p)}\\b`, 'gi'), ' ');
  }
  out = out.replace(/!+/g, '.').replace(/\s+/g, ' ').trim();
  return out || 'Your service request update is available.';
}

function extractPlaceholders(message) {
  const m = `${message || ''}`.match(/\{\{\s*[^}]+\s*\}\}/g);
  return m ? Array.from(new Set(m)) : [];
}

function ensurePlaceholders(message, placeholders) {
  let out = `${message || ''}`;
  for (const ph of placeholders) {
    if (!out.includes(ph)) out += ` ${ph}`;
  }
  return out.trim();
}

function escapeRegex(value) {
  return `${value || ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function sigmoid(x) { return 1 / (1 + Math.exp(-x)); }
function logit(p) { const x = clamp(p, 1e-6, 1 - 1e-6); return Math.log(x / (1 - x)); }
function clamp(v, min, max) { return Math.min(max, Math.max(min, v)); }
function round(v, d) { const f = 10 ** d; return Math.round(v * f) / f; }

function fnv1a(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}
