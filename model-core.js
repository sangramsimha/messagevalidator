const crypto = require('node:crypto');

const UTILITY_HINTS = [
  'order', 'shipment', 'delivery', 'dispatched', 'invoice', 'payment',
  'receipt', 'otp', 'verification', 'account', 'service', 'ticket',
  'request', 'appointment', 'due', 'reminder', 'support', 'transaction',
  'reference', 'status', 'confirmed', 'scheduled', 'renewal'
];

const MARKETING_HINTS = [
  'offer', 'sale', 'discount', 'deal', 'buy', 'shop', 'limited',
  'hurry', 'free', 'coupon', 'cashback', 'promo', 'festival sale',
  'exclusive', 'new launch', 'best price', 'save', 'upgrade now',
  'flat rs', 'explore now', 'shop now', 'buy now', 'redeem'
];

const CTA_PATTERNS = [
  /\b(buy now|shop now|redeem now|grab now|explore now)\b/i,
  /\b(limited time|hurry|ends soon|don't miss)\b/i,
  /\b(flat\s*rs\.?\s*\d+|\d+%\s*off|cashback)\b/i,
];

const UTILITY_ANCHORS = [
  'this is a service update related to your existing request.',
  'this message is sent for an existing transaction or service interaction.',
  'no promotion is included in this update.',
];

function tokenize(text) {
  return `${text || ''}`
    .toLowerCase()
    .replace(/\{\{[^}]+\}\}/g, ' placeholder ')
    .replace(/[^a-z0-9%\s]/g, ' ')
    .split(/\s+/)
    .filter((token) => token.length > 1);
}

function deterministicSplit(records, holdoutRate = 0.2) {
  const train = [];
  const holdout = [];

  for (const row of records) {
    const key = `${row.templateId || ''}|${row.message}`;
    const bucket = fnv1a(key) % 100;
    if (bucket < Math.round(holdoutRate * 100)) {
      holdout.push(row);
    } else {
      train.push(row);
    }
  }

  if (train.length < 10 || holdout.length < 10) {
    return {
      train: records.slice(),
      holdout: [],
    };
  }

  return { train, holdout };
}

function buildRawModel(records) {
  const classes = {
    utility: {
      docs: 0,
      tokens: 0,
      tokenCounts: Object.create(null),
    },
    marketing: {
      docs: 0,
      tokens: 0,
      tokenCounts: Object.create(null),
    },
  };

  const vocab = new Set();

  for (const row of records) {
    const cls = row.finalLabel;
    if (!classes[cls]) continue;

    classes[cls].docs += 1;
    const tokens = tokenize(row.message);
    for (const token of tokens) {
      vocab.add(token);
      classes[cls].tokens += 1;
      classes[cls].tokenCounts[token] = (classes[cls].tokenCounts[token] || 0) + 1;
    }
  }

  return {
    classes,
    vocabSize: Math.max(vocab.size, 1),
    totalDocs: classes.utility.docs + classes.marketing.docs,
  };
}

function computeBayesAndRule(message, artifact, options = {}) {
  const tokens = tokenize(message);
  const utility = artifact.rawModel.classes.utility;
  const marketing = artifact.rawModel.classes.marketing;

  const utilPrior = Math.log((utility.docs + 1) / (artifact.rawModel.totalDocs + 2));
  const mktPrior = Math.log((marketing.docs + 1) / (artifact.rawModel.totalDocs + 2));

  let utilLog = utilPrior;
  let mktLog = mktPrior;

  const tokenImpacts = Object.create(null);
  const tokenFrequency = Object.create(null);
  for (const token of tokens) {
    tokenFrequency[token] = (tokenFrequency[token] || 0) + 1;
  }

  for (const token of tokens) {
    const utilCount = utility.tokenCounts[token] || 0;
    const mktCount = marketing.tokenCounts[token] || 0;
    const utilTerm = Math.log((utilCount + 1) / (utility.tokens + artifact.rawModel.vocabSize));
    const mktTerm = Math.log((mktCount + 1) / (marketing.tokens + artifact.rawModel.vocabSize));
    utilLog += utilTerm;
    mktLog += mktTerm;
    tokenImpacts[token] = (utilTerm - mktTerm) * (tokenFrequency[token] || 1);
  }

  const bayesProb = 1 / (1 + Math.exp(mktLog - utilLog));
  const ruleProb = computeRuleProbability(message);

  let blended = 0.65 * bayesProb + 0.35 * ruleProb;
  if (tokens.length <= 4) {
    blended *= 0.9;
  }

  if (options.applyGuardrail === false) {
    return {
      probability: clamp(blended, 0.01, 0.99),
      bayesProb,
      ruleProb,
      tokenImpacts,
    };
  }

  const guardrail = applyPromoGuardrail(message, blended);

  return {
    probability: clamp(guardrail.cappedProbability, 0.01, 0.99),
    rawProbability: clamp(blended, 0.01, 0.99),
    bayesProb,
    ruleProb,
    tokenImpacts,
    guardrail,
  };
}

function applyPromoGuardrail(message, rawProbability) {
  const lower = `${message || ''}`.toLowerCase();
  const riskTerms = detectRiskTerms(lower);
  const matchedPatterns = CTA_PATTERNS.filter((pattern) => pattern.test(lower)).length;

  let cap = 0.99;
  if (matchedPatterns >= 1 && riskTerms.length >= 2) {
    cap = 0.45;
  } else if (riskTerms.length >= 2) {
    cap = 0.6;
  } else if (matchedPatterns >= 1 || riskTerms.length === 1) {
    cap = 0.75;
  }

  const cappedProbability = Math.min(rawProbability, cap);
  return {
    riskTerms,
    matchedPatterns,
    cap,
    capApplied: cap < 0.99 && cappedProbability < rawProbability,
    cappedProbability,
  };
}

function detectRiskTerms(messageLower) {
  const risks = [];
  for (const hint of MARKETING_HINTS) {
    if (messageLower.includes(hint)) {
      risks.push(hint);
    }
  }
  return Array.from(new Set(risks));
}

function computeRuleProbability(message) {
  const lower = `${message || ''}`.toLowerCase();
  let score = 0;

  for (const hint of UTILITY_HINTS) {
    if (lower.includes(hint)) score += 0.7;
  }

  for (const hint of MARKETING_HINTS) {
    if (lower.includes(hint)) score -= 1.4;
  }

  if (/\b(hello|hi|dear)\b/.test(lower)) score += 0.1;
  if (/\b(\d{4,}|\{\{\d+\}\})\b/.test(lower)) score += 0.25;

  for (const pattern of CTA_PATTERNS) {
    if (pattern.test(lower)) score -= 1.25;
  }

  return sigmoid(score);
}

function fitCalibrationPlatt(samples) {
  if (!samples.length) {
    return {
      enabled: false,
      a: 1,
      b: 0,
      holdoutSize: 0,
      utilityRate: 0,
    };
  }

  const positives = samples.filter((sample) => sample.label === 1).length;
  const negatives = samples.length - positives;
  if (positives === 0 || negatives === 0 || samples.length < 20) {
    return {
      enabled: false,
      a: 1,
      b: 0,
      holdoutSize: samples.length,
      utilityRate: positives / samples.length,
    };
  }

  let a = 1;
  let b = 0;
  let learningRate = 0.08;

  for (let epoch = 0; epoch < 500; epoch += 1) {
    let gradA = 0;
    let gradB = 0;

    for (const sample of samples) {
      const x = safeLogit(sample.rawProbability);
      const prediction = sigmoid(a * x + b);
      const error = prediction - sample.label;
      gradA += error * x;
      gradB += error;
    }

    gradA /= samples.length;
    gradB /= samples.length;

    a -= learningRate * gradA;
    b -= learningRate * gradB;
    learningRate *= 0.995;
  }

  return {
    enabled: true,
    a,
    b,
    holdoutSize: samples.length,
    utilityRate: positives / samples.length,
  };
}

function calibrateProbability(probability, calibration) {
  if (!calibration || !calibration.enabled) {
    return clamp(probability, 0.01, 0.99);
  }
  const x = safeLogit(probability);
  return clamp(sigmoid(calibration.a * x + calibration.b), 0.01, 0.99);
}

function decisionBand(probability, riskTerms, guardrail, message) {
  const transactionalContext = /\b(order|invoice|ticket|request|reference|otp|service|account|payment|shipment|delivery)\b/i.test(message || '');
  if ((guardrail && guardrail.cap <= 0.6) || probability < 0.45) {
    return 'Likely Marketing';
  }
  if (probability >= 0.85 && (!riskTerms || riskTerms.length === 0) && transactionalContext && (!guardrail || guardrail.cap > 0.75)) {
    return 'Safe Utility';
  }
  return 'Borderline';
}

function buildExplanations(message, scoring, artifact) {
  const utilitySignals = [];
  const marketingSignals = [];
  for (const [token, impact] of Object.entries(scoring.tokenImpacts || {})) {
    if (impact > 0.05) {
      utilitySignals.push({ term: token, impact: round(impact, 3) });
    }
    if (impact < -0.05) {
      marketingSignals.push({ term: token, impact: round(Math.abs(impact), 3) });
    }
  }

  utilitySignals.sort((a, b) => b.impact - a.impact);
  marketingSignals.sort((a, b) => b.impact - a.impact);

  const suggestedChanges = [];
  if (scoring.guardrail.riskTerms.length) {
    suggestedChanges.push(
      `Remove promotional terms: ${scoring.guardrail.riskTerms.slice(0, 5).join(', ')}.`
    );
  }

  if (!/\b(order|invoice|ticket|request|reference|otp|service|account)\b/i.test(message)) {
    suggestedChanges.push('Add a clear transaction reference (order ID, ticket ID, invoice, or OTP context).');
  }

  if (!/\b(existing|already|requested|scheduled|confirmation|status)\b/i.test(message)) {
    suggestedChanges.push('Use explicit existing-relationship language (for your existing request/service).');
  }

  if (!/\{\{\d+\}\}/.test(message)) {
    suggestedChanges.push('If template variables exist, keep placeholders to maintain transactional specificity.');
  }

  if (!suggestedChanges.length) {
    suggestedChanges.push('Message already follows utility-style patterns; keep language strictly transactional.');
  }

  return {
    top_utility_signals: utilitySignals.slice(0, 5),
    top_marketing_risks: mergeRiskSignals(marketingSignals, scoring.guardrail.riskTerms),
    what_to_change: suggestedChanges.slice(0, 4),
    calibration_note: artifact.calibration.enabled
      ? `Calibrated using ${artifact.calibration.holdoutSize} holdout examples.`
      : 'Calibration disabled due to limited holdout diversity.',
  };
}

function mergeRiskSignals(marketingSignals, riskTerms) {
  const fromTokens = marketingSignals.slice(0, 3).map((signal) => ({
    term: signal.term,
    impact: signal.impact,
    source: 'token',
  }));

  const fromRules = riskTerms
    .filter((term) => !fromTokens.some((signal) => signal.term === term))
    .slice(0, 3)
    .map((term) => ({ term, impact: 1, source: 'rule' }));

  const merged = fromTokens.concat(fromRules);
  return merged.length ? merged : [{ term: 'none-detected', impact: 0, source: 'rule' }];
}

function trainModel(records, options = {}) {
  const cleanRecords = records
    .map((row) => ({
      finalLabel: row.finalLabel,
      templateId: `${row.templateId || ''}`,
      message: `${row.message || ''}`.trim(),
    }))
    .filter((row) => (row.finalLabel === 'utility' || row.finalLabel === 'marketing') && row.message);

  if (cleanRecords.length < 10) {
    throw new Error('Need at least 10 labeled rows to train model.');
  }

  const { train, holdout } = deterministicSplit(cleanRecords, options.holdoutRate || 0.2);
  const rawModel = buildRawModel(train);

  const draftArtifact = {
    modelVersion: options.modelVersion || buildVersion(),
    rawModel,
    calibration: {
      enabled: false,
      a: 1,
      b: 0,
      holdoutSize: 0,
      utilityRate: 0,
    },
    metadata: {},
  };

  const calibrationSamples = holdout.map((row) => {
    const score = computeBayesAndRule(row.message, draftArtifact);
    return {
      rawProbability: score.probability,
      label: row.finalLabel === 'utility' ? 1 : 0,
    };
  });

  const calibration = fitCalibrationPlatt(calibrationSamples);

  const artifact = {
    modelVersion: options.modelVersion || buildVersion(),
    generatedAt: new Date().toISOString(),
    rawModel,
    calibration,
    metadata: {
      totalRecords: cleanRecords.length,
      trainRecords: train.length,
      holdoutRecords: holdout.length,
      utilityRecords: cleanRecords.filter((row) => row.finalLabel === 'utility').length,
      marketingRecords: cleanRecords.filter((row) => row.finalLabel === 'marketing').length,
      metrics: evaluateMetrics(holdout, {
        modelVersion: options.modelVersion || buildVersion(),
        rawModel,
        calibration,
      }),
    },
  };

  return artifact;
}

function evaluateMetrics(holdout, artifact) {
  if (!holdout.length) {
    return {
      utility_precision: null,
      false_utility_rate: null,
      baseline_false_utility_rate: null,
      baseline_utility_precision: null,
      false_utility_reduction: null,
    };
  }

  let tp = 0;
  let fp = 0;
  let baselineTp = 0;
  let baselineFp = 0;
  let marketingActual = 0;

  for (const row of holdout) {
    const finalLabel = row.finalLabel;
    const baseline = computeBayesAndRule(row.message, artifact, { applyGuardrail: false });
    const improved = scoreMessage(row.message, artifact);

    const baselinePredictUtility = baseline.probability >= 0.8;
    const improvedPredictUtility = improved.decisionBand === 'Safe Utility';

    if (finalLabel === 'marketing') {
      marketingActual += 1;
    }

    if (baselinePredictUtility) {
      if (finalLabel === 'utility') baselineTp += 1;
      else baselineFp += 1;
    }

    if (improvedPredictUtility) {
      if (finalLabel === 'utility') tp += 1;
      else fp += 1;
    }
  }

  const precision = tp + fp > 0 ? tp / (tp + fp) : null;
  const baselinePrecision = baselineTp + baselineFp > 0 ? baselineTp / (baselineTp + baselineFp) : null;
  const falseUtilityRate = marketingActual > 0 ? fp / marketingActual : null;
  const baselineFalseUtilityRate = marketingActual > 0 ? baselineFp / marketingActual : null;

  return {
    utility_precision: precision,
    false_utility_rate: falseUtilityRate,
    baseline_false_utility_rate: baselineFalseUtilityRate,
    baseline_utility_precision: baselinePrecision,
    false_utility_reduction:
      baselineFalseUtilityRate !== null && falseUtilityRate !== null
        ? baselineFalseUtilityRate - falseUtilityRate
        : null,
  };
}

function scoreMessage(message, artifact) {
  const scoring = computeBayesAndRule(message, artifact);
  const calibrated = calibrateProbability(scoring.probability, artifact.calibration);
  const band = decisionBand(calibrated, scoring.guardrail.riskTerms, scoring.guardrail, message);

  return {
    probability: calibrated,
    rawProbability: scoring.rawProbability,
    bayesProbability: scoring.bayesProb,
    ruleProbability: scoring.ruleProb,
    riskTerms: scoring.guardrail.riskTerms,
    decisionBand: band,
    guardrail: scoring.guardrail,
    tokenImpacts: scoring.tokenImpacts,
  };
}

function predictMessage(message, artifact) {
  const score = scoreMessage(message, artifact);
  const explanations = buildExplanations(message, score, artifact);
  const alternatives = generateAlternatives(message, artifact).slice(0, 5);

  return {
    utility_probability: round(score.probability, 4),
    decision_band: score.decisionBand,
    risk_terms: score.riskTerms,
    explanations,
    alternatives,
    model_version: artifact.modelVersion,
  };
}

function generateAlternatives(message, artifact) {
  const placeholders = extractPlaceholders(message);
  const cleaned = cleanMarketingLanguage(message);
  const intent = detectIntent(message);

  const candidatePool = new Set();
  const templates = getIntentTemplates(intent, placeholders);

  for (const template of templates) {
    candidatePool.add(enforcePlaceholders(template, placeholders));
    candidatePool.add(enforcePlaceholders(`${template} ${UTILITY_ANCHORS[0]}`, placeholders));
  }

  candidatePool.add(enforcePlaceholders(`${cleaned} ${UTILITY_ANCHORS[1]}`, placeholders));
  candidatePool.add(enforcePlaceholders(`${cleaned} ${UTILITY_ANCHORS[2]}`, placeholders));

  const originalLower = message.toLowerCase();
  const unique = new Map();

  for (const candidate of candidatePool) {
    const compact = candidate.replace(/\s+/g, ' ').trim();
    const key = compact.toLowerCase();
    if (!compact || unique.has(key)) continue;

    const score = scoreMessage(compact, artifact);
    unique.set(key, {
      message: compact,
      utility_probability: round(score.probability, 4),
      decision_band: score.decisionBand,
      rationale: buildAlternativeRationale(originalLower, compact, score),
    });
  }

  const scored = Array.from(unique.values()).sort((a, b) => b.utility_probability - a.utility_probability);
  const safe = scored.filter((item) => item.utility_probability >= 0.95);
  return safe.length >= 5 ? safe.slice(0, 5) : scored.slice(0, 5);
}

function buildAlternativeRationale(originalLower, candidate, score) {
  const candidateLower = candidate.toLowerCase();
  const removedPromo = MARKETING_HINTS.filter(
    (term) => originalLower.includes(term) && !candidateLower.includes(term)
  ).slice(0, 3);

  const addedTransactional = UTILITY_HINTS.filter(
    (term) => candidateLower.includes(term) && !originalLower.includes(term)
  ).slice(0, 3);

  const reasons = [];
  if (removedPromo.length) {
    reasons.push(`Removed promo terms: ${removedPromo.join(', ')}`);
  }
  if (addedTransactional.length) {
    reasons.push(`Added transactional cues: ${addedTransactional.join(', ')}`);
  }
  if (!removedPromo.length && !addedTransactional.length) {
    reasons.push('Uses more neutral transactional language and avoids direct promotion.');
  }
  if (score.riskTerms.length) {
    reasons.push(`Still review risk terms: ${score.riskTerms.slice(0, 2).join(', ')}`);
  }

  return reasons.join('. ') + '.';
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
  const p1 = slot(placeholders, 0, '{{1}}');
  const p2 = slot(placeholders, 1, '{{2}}');
  const p3 = slot(placeholders, 2, '{{3}}');

  const library = {
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

  return library[intent] || library.service;
}

function cleanMarketingLanguage(message) {
  let cleaned = ` ${message || ''} `;
  const phrases = [
    'limited time', 'buy now', 'shop now', 'best price', 'exclusive offer',
    'festival sale', 'discount', 'cashback', 'coupon', 'deal',
  ];

  for (const phrase of phrases) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, 'gi');
    cleaned = cleaned.replace(re, ' ');
  }

  cleaned = cleaned.replace(/!+/g, '.').replace(/\s+/g, ' ').trim();
  return cleaned || 'Your service request update is available.';
}

function extractPlaceholders(message) {
  const matches = `${message || ''}`.match(/\{\{\s*[^}]+\s*\}\}/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function enforcePlaceholders(candidate, placeholders) {
  let result = `${candidate || ''}`;
  for (const placeholder of placeholders) {
    if (!result.includes(placeholder)) {
      result += ` ${placeholder}`;
    }
  }
  return result.trim();
}

function slot(placeholders, index, fallback) {
  return placeholders[index] || fallback;
}

function buildVersion() {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const suffix = crypto.randomBytes(3).toString('hex');
  return `model-${stamp}-${suffix}`;
}

function safeLogit(probability) {
  const p = clamp(probability, 1e-6, 1 - 1e-6);
  return Math.log(p / (1 - p));
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function round(value, decimals) {
  const factor = 10 ** decimals;
  return Math.round(value * factor) / factor;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function escapeRegex(value) {
  return `${value || ''}`.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function fnv1a(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash += (hash << 1) + (hash << 4) + (hash << 7) + (hash << 8) + (hash << 24);
  }
  return hash >>> 0;
}

module.exports = {
  UTILITY_HINTS,
  MARKETING_HINTS,
  trainModel,
  predictMessage,
  scoreMessage,
  tokenize,
  decisionBand,
  calibrateProbability,
};



