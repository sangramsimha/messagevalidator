const state = {
  records: [],
  model: null,
};

const utilityHints = [
  "order", "shipment", "delivery", "dispatched", "invoice", "payment",
  "receipt", "otp", "verification", "account", "service", "ticket",
  "request", "appointment", "due", "reminder", "support", "transaction"
];

const marketingHints = [
  "offer", "sale", "discount", "deal", "buy", "shop", "limited",
  "hurry", "free", "coupon", "cashback", "promo", "festival sale",
  "exclusive", "new launch", "best price", "save", "upgrade now"
];

const utilityAnchors = [
  "this is a service update related to your existing request.",
  "this message is sent for an existing transaction or service interaction.",
  "no promotion is included in this update."
];

const trainingStatus = document.getElementById("trainingStatus");
const analyzeBtn = document.getElementById("analyzeBtn");
const candidateMessage = document.getElementById("candidateMessage");
const analyzeStatus = document.getElementById("analyzeStatus");
const utilityScore = document.getElementById("utilityScore");
const meterFill = document.getElementById("meterFill");
const scoreNote = document.getElementById("scoreNote");
const alternativesList = document.getElementById("alternativesList");

initializeModel();

analyzeBtn.addEventListener("click", () => {
  if (!state.model) {
    setStatus(analyzeStatus, "Model is not ready.", true);
    return;
  }

  const message = (candidateMessage.value || "").trim();
  if (!message) {
    setStatus(analyzeStatus, "Please enter a message template to analyze.", true);
    return;
  }

  const prediction = predictUtilityProbability(message, state.model);
  renderProbability(prediction.probability);

  const alternatives = generateAlternatives(message, state.model);
  renderAlternatives(alternatives);

  const risks = detectMarketingRisks(message);
  if (risks.length) {
    setStatus(
      scoreNote,
      `Marketing-risk terms detected: ${risks.slice(0, 6).join(", ")}. Remove them for higher utility approval odds.`,
      true
    );
  } else {
    setStatus(scoreNote, "Message language appears transactional and utility-oriented.", false);
  }

  setStatus(analyzeStatus, "Analysis complete.", false);
});

function initializeModel() {
  const records = Array.isArray(window.PRETRAINED_RECORDS) ? window.PRETRAINED_RECORDS : [];
  if (records.length < 10) {
    setStatus(trainingStatus, "Pretrained data missing or insufficient.", true);
    setStatus(analyzeStatus, "Model failed to load.", true);
    return;
  }

  state.records = records
    .map((r) => ({
      finalLabel: normalizeLabel(r.finalLabel),
      message: `${r.message || ""}`.trim(),
      templateId: `${r.templateId || ""}`.trim(),
    }))
    .filter((r) => r.finalLabel && r.message);

  state.model = buildModel(state.records);
  const utilityCount = state.records.filter((r) => r.finalLabel === "utility").length;
  const marketingCount = state.records.filter((r) => r.finalLabel === "marketing").length;

  setStatus(
    trainingStatus,
    `Model loaded with ${state.records.length} historical templates (${utilityCount} utility, ${marketingCount} marketing).`,
    false
  );
  setStatus(analyzeStatus, "Model ready. Paste a message and click Analyze.", false);
}

function setStatus(node, message, isWarning) {
  node.textContent = message;
  node.classList.toggle("muted", !isWarning);
}

function normalizeLabel(value) {
  const s = `${value || ""}`.toLowerCase();
  if (s.includes("utility")) {
    return "utility";
  }
  if (s.includes("market")) {
    return "marketing";
  }
  return null;
}

function tokenize(text) {
  return `${text || ""}`
    .toLowerCase()
    .replace(/\{\{[^}]+\}\}/g, " placeholder ")
    .replace(/[^a-z0-9%\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 1);
}

function buildModel(records) {
  const classes = {
    utility: {
      docs: 0,
      tokens: 0,
      tokenCounts: new Map(),
    },
    marketing: {
      docs: 0,
      tokens: 0,
      tokenCounts: new Map(),
    },
  };

  const vocab = new Set();

  for (const row of records) {
    const cls = row.finalLabel;
    classes[cls].docs += 1;
    const tokens = tokenize(row.message);
    for (const token of tokens) {
      vocab.add(token);
      classes[cls].tokens += 1;
      classes[cls].tokenCounts.set(token, (classes[cls].tokenCounts.get(token) || 0) + 1);
    }
  }

  const totalDocs = classes.utility.docs + classes.marketing.docs;

  return {
    classes,
    vocabSize: Math.max(vocab.size, 1),
    totalDocs,
  };
}

function predictUtilityProbability(message, model) {
  const tokens = tokenize(message);
  const utility = model.classes.utility;
  const marketing = model.classes.marketing;

  const utilPrior = Math.log((utility.docs + 1) / (model.totalDocs + 2));
  const mktPrior = Math.log((marketing.docs + 1) / (model.totalDocs + 2));

  let utilLog = utilPrior;
  let mktLog = mktPrior;

  for (const token of tokens) {
    const utilCount = utility.tokenCounts.get(token) || 0;
    const mktCount = marketing.tokenCounts.get(token) || 0;
    utilLog += Math.log((utilCount + 1) / (utility.tokens + model.vocabSize));
    mktLog += Math.log((mktCount + 1) / (marketing.tokens + model.vocabSize));
  }

  const bayesProb = 1 / (1 + Math.exp(mktLog - utilLog));
  const ruleProb = computeRuleProbability(message);

  let blended = 0.65 * bayesProb + 0.35 * ruleProb;

  if (tokens.length <= 4) {
    blended *= 0.9;
  }

  return {
    probability: clamp(blended, 0.01, 0.99),
    bayesProb,
    ruleProb,
  };
}

function computeRuleProbability(message) {
  const lc = message.toLowerCase();
  let score = 0;

  for (const hint of utilityHints) {
    if (lc.includes(hint)) {
      score += 0.8;
    }
  }

  for (const hint of marketingHints) {
    if (lc.includes(hint)) {
      score -= 1.3;
    }
  }

  if (/\b(hello|hi|dear)\b/.test(lc)) {
    score += 0.1;
  }

  if (/\b(\d{4,}|\{\{\d+\}\})\b/.test(lc)) {
    score += 0.35;
  }

  if (/\b(click|visit|shop now|buy now|redeem|hurry)\b/.test(lc)) {
    score -= 1.4;
  }

  return sigmoid(score);
}

function detectMarketingRisks(message) {
  const lc = message.toLowerCase();
  const hits = [];
  for (const token of marketingHints) {
    if (lc.includes(token)) {
      hits.push(token);
    }
  }
  return hits;
}

function renderProbability(probability) {
  const pct = Math.round(probability * 10000) / 100;
  utilityScore.textContent = `${pct}%`;
  meterFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;
}

function renderAlternatives(alternatives) {
  alternativesList.innerHTML = "";
  for (const item of alternatives) {
    const li = document.createElement("li");
    li.textContent = `${item.message}  (Utility odds: ${Math.round(item.probability * 100)}%)`;
    alternativesList.appendChild(li);
  }
}

function generateAlternatives(message, model) {
  const placeholders = extractPlaceholders(message);
  const cleaned = cleanMarketingLanguage(message);
  const intent = detectIntent(message);
  const candidatePool = new Set();

  const variants = getIntentTemplates(intent, placeholders);
  for (const v of variants) {
    candidatePool.add(v);
    candidatePool.add(`${v} ${utilityAnchors[0]}`);
  }

  candidatePool.add(`${cleaned} ${utilityAnchors[1]}`);
  candidatePool.add(`${cleaned} ${utilityAnchors[2]}`);

  const scored = Array.from(candidatePool)
    .map((msg) => {
      const compact = msg.replace(/\s+/g, " ").trim();
      return {
        message: compact,
        probability: predictUtilityProbability(compact, model).probability,
      };
    })
    .sort((a, b) => b.probability - a.probability);

  const above95 = scored.filter((x) => x.probability >= 0.95);
  if (above95.length >= 5) {
    return above95.slice(0, 5);
  }

  return scored.slice(0, 5);
}

function extractPlaceholders(message) {
  const matches = message.match(/\{\{\s*[^}]+\s*\}\}/g);
  return matches ? Array.from(new Set(matches)) : [];
}

function slot(placeholders, idx, fallback) {
  if (placeholders[idx]) {
    return placeholders[idx];
  }
  return fallback;
}

function cleanMarketingLanguage(message) {
  let cleaned = ` ${message} `;
  const phrases = [
    "limited time", "buy now", "shop now", "best price", "exclusive offer",
    "festival sale", "discount", "cashback", "coupon", "deal"
  ];

  for (const phrase of phrases) {
    const re = new RegExp(`\\b${escapeRegex(phrase)}\\b`, "gi");
    cleaned = cleaned.replace(re, " ");
  }

  cleaned = cleaned
    .replace(/!+/g, ".")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return "Your service request update is available.";
  }

  return cleaned;
}

function detectIntent(message) {
  const lc = message.toLowerCase();
  if (/otp|verification|code/.test(lc)) return "otp";
  if (/order|shipment|delivery|dispatch|tracking/.test(lc)) return "order";
  if (/payment|invoice|bill|due|amount/.test(lc)) return "payment";
  if (/appointment|visit|scheduled|reschedule/.test(lc)) return "appointment";
  if (/ticket|support|request|complaint/.test(lc)) return "support";
  if (/account|login|password|profile/.test(lc)) return "account";
  return "service";
}

function getIntentTemplates(intent, placeholders) {
  const p1 = slot(placeholders, 0, "{{1}}");
  const p2 = slot(placeholders, 1, "{{2}}");
  const p3 = slot(placeholders, 2, "{{3}}");

  const library = {
    otp: [
      `Hello ${p1}, your verification code is ${p2}. This code is valid for 10 minutes for your existing login request.`,
      `Hi ${p1}, use OTP ${p2} to complete your requested verification. Do not share this code with anyone.`,
      `Dear ${p1}, ${p2} is your one-time code for your account verification request.`
    ],
    order: [
      `Hello ${p1}, your order ${p2} is currently ${p3}. This update is regarding your existing purchase request.`,
      `Hi ${p1}, order ${p2} status: ${p3}. Reply to this message if you need support for this order.`,
      `Dear ${p1}, your shipment for order ${p2} has an update: ${p3}.`
    ],
    payment: [
      `Hello ${p1}, invoice ${p2} for amount ${p3} is due. This is a payment reminder for your existing service.`,
      `Hi ${p1}, we received your payment for invoice ${p2}. Transaction reference: ${p3}.`,
      `Dear ${p1}, your billing update for invoice ${p2}: ${p3}.`
    ],
    appointment: [
      `Hello ${p1}, your appointment ${p2} is scheduled for ${p3}. This is a service confirmation message.`,
      `Hi ${p1}, appointment ${p2} has been updated to ${p3}.`,
      `Dear ${p1}, reminder: your appointment ${p2} is on ${p3}.`
    ],
    support: [
      `Hello ${p1}, your support ticket ${p2} status is ${p3}. This update is for your existing request.`,
      `Hi ${p1}, ticket ${p2} has been updated: ${p3}.`,
      `Dear ${p1}, we have an update for service request ${p2}: ${p3}.`
    ],
    account: [
      `Hello ${p1}, your account request ${p2} is now ${p3}. This is a service-related update.`,
      `Hi ${p1}, account activity alert: ${p2}. Reference: ${p3}.`,
      `Dear ${p1}, your account update for request ${p2}: ${p3}.`
    ],
    service: [
      `Hello ${p1}, your service request ${p2} has an update: ${p3}.`,
      `Hi ${p1}, this is an update regarding your existing request ${p2}: ${p3}.`,
      `Dear ${p1}, transaction update for reference ${p2}: ${p3}.`
    ],
  };

  return library[intent] || library.service;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
