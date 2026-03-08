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
const decisionBand = document.getElementById('decisionBand');
const utilitySignals = document.getElementById('utilitySignals');
const riskSignals = document.getElementById('riskSignals');
const changeList = document.getElementById('changeList');
const alternativesList = document.getElementById('alternativesList');
const metricsRow = document.getElementById('metricsRow');

let lastPrediction = null;

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
    setStatus(
      trainingStatus,
      `Model ${modelInfo.model_version} loaded. ${modelInfo.total_records} records (${modelInfo.utility_records} utility, ${modelInfo.marketing_records} marketing).`,
      false
    );
    renderMetrics(modelInfo);
    setStatus(analyzeStatus, 'Model ready. Paste a message and click Analyze.', false);
  } catch (error) {
    setStatus(trainingStatus, `Failed to load model metadata: ${error.message}`, true);
    setStatus(analyzeStatus, 'API unavailable. Start backend with `npm start`.', true);
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
    const result = await fetchJson('/analyze', {
      method: 'POST',
      body: {
        message,
        context: contextInput.value.trim() || null,
        language: languageInput.value.trim() || null,
      },
    });

    lastPrediction = {
      message,
      utility_probability: result.utility_probability,
      model_version: result.model_version,
      context: contextInput.value.trim() || null,
      language: languageInput.value.trim() || null,
    };

    renderPrediction(result);
    setStatus(analyzeStatus, 'Analysis complete.', false);
    setStatus(feedbackStatus, 'If you later get WhatsApp outcome, submit feedback below.', false);
  } catch (error) {
    setStatus(analyzeStatus, `Analyze failed: ${error.message}`, true);
  }
}

async function onSubmitFeedback() {
  if (!lastPrediction) {
    setStatus(feedbackStatus, 'Analyze a message before submitting feedback.', true);
    return;
  }

  const finalLabel = finalLabelInput.value;
  if (!finalLabel) {
    setStatus(feedbackStatus, 'Please select final WhatsApp label before submitting.', true);
    return;
  }

  try {
    const result = await fetchJson('/feedback', {
      method: 'POST',
      body: {
        template_id: templateIdInput.value.trim() || null,
        message_submitted: lastPrediction.message,
        predicted_probability: lastPrediction.utility_probability,
        whatsapp_final_label: finalLabel,
        submitted_at: new Date().toISOString(),
        model_version: lastPrediction.model_version,
        context: lastPrediction.context,
        language: lastPrediction.language,
      },
    });

    setStatus(feedbackStatus, `Feedback saved. Total feedback rows: ${result.total_feedback_rows}.`, false);
  } catch (error) {
    setStatus(feedbackStatus, `Feedback failed: ${error.message}`, true);
  }
}

function renderPrediction(result) {
  const pct = Math.round((result.utility_probability || 0) * 10000) / 100;
  utilityScore.textContent = `${pct}%`;
  meterFill.style.width = `${Math.max(0, Math.min(100, pct))}%`;

  const band = result.decision_band || 'Borderline';
  decisionBand.textContent = band;
  decisionBand.className = `badge ${badgeClassForBand(band)}`;

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

  renderExplanationList(
    changeList,
    result.explanations?.what_to_change || [],
    'No changes suggested.'
  );

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
    meta.innerHTML = `<strong>${Math.round((alt.utility_probability || 0) * 100)}%</strong> · ${escapeHtml(alt.decision_band || 'Borderline')}`;

    const copyBtn = document.createElement('button');
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(alt.message || '');
        copyBtn.textContent = 'Copied';
        setTimeout(() => {
          copyBtn.textContent = 'Copy';
        }, 900);
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

function renderMetrics(modelInfo) {
  metricsRow.innerHTML = '';
  const metrics = [
    { label: 'Holdout Precision', value: asPercent(modelInfo.metrics?.utility_precision) },
    { label: 'False Utility Rate', value: asPercent(modelInfo.metrics?.false_utility_rate) },
    { label: 'Baseline FUR', value: asPercent(modelInfo.metrics?.baseline_false_utility_rate) },
    { label: 'Holdout Rows', value: `${modelInfo.holdout_records || 0}` },
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
    headers: {
      'Content-Type': 'application/json',
    },
  };

  if (options.body) {
    config.body = JSON.stringify(options.body);
  }

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

function escapeHtml(value) {
  return `${value || ''}`
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
