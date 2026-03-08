const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const { analyzeMessage, getModelInfo, loadModelArtifact, refreshModel } = require('./model-service');
const { insertFeedback, countFeedbackRows } = require('./store');

const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 8080);
const STATIC_ROOT = process.cwd();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain; charset=utf-8',
};

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { ok: true, service: 'message-validator-api' });
    }

    if (req.method === 'GET' && url.pathname === '/model-info') {
      return sendJson(res, 200, getModelInfo());
    }

    if (req.method === 'POST' && url.pathname === '/analyze') {
      const payload = await readJson(req);
      const result = analyzeMessage(payload);
      return sendJson(res, 200, result);
    }

    if (req.method === 'POST' && url.pathname === '/feedback') {
      const payload = await readJson(req);
      validateFeedback(payload);

      insertFeedback({
        template_id: payload.template_id || null,
        message_submitted: `${payload.message_submitted || ''}`.trim(),
        predicted_probability: toNumberOrNull(payload.predicted_probability),
        whatsapp_final_label: `${payload.whatsapp_final_label || ''}`.toLowerCase(),
        submitted_at: payload.submitted_at || new Date().toISOString(),
        model_version: payload.model_version || null,
        context: payload.context || null,
        language: payload.language || null,
      });

      return sendJson(res, 201, {
        ok: true,
        message: 'Feedback stored.',
        total_feedback_rows: countFeedbackRows(),
      });
    }

    if (req.method === 'POST' && url.pathname === '/retrain') {
      const artifact = refreshModel();
      return sendJson(res, 200, {
        ok: true,
        model_version: artifact.modelVersion,
        metrics: artifact.metadata.metrics,
      });
    }

    if (req.method === 'GET') {
      return serveStatic(req, res, url.pathname);
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    sendJson(res, 400, { error: error.message || 'Bad request' });
  }
});

server.listen(PORT, HOST, () => {
  loadModelArtifact();
  console.log(`Server listening on http://${HOST}:${PORT}`);
});

function serveStatic(req, res, pathname) {
  const safePath = normalizePath(pathname);
  const requested = (!safePath || safePath === '/' || safePath === '\\') ? 'index.html' : safePath.replace(/^[/\\]+/, '');
  const filePath = path.join(STATIC_ROOT, requested);

  if (!filePath.startsWith(STATIC_ROOT)) {
    return sendJson(res, 403, { error: 'Forbidden' });
  }

  if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    return sendJson(res, 404, { error: 'File not found' });
  }

  const ext = path.extname(filePath).toLowerCase();
  const mime = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime });
  fs.createReadStream(filePath).pipe(res);
}

function normalizePath(pathname) {
  return path.normalize(pathname).replace(/^([.][.][/\\])+/, '');
}

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 1_000_000) {
        reject(new Error('Request body too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error('Invalid JSON payload'));
      }
    });
    req.on('error', reject);
  });
}

function validateFeedback(payload) {
  const message = `${payload.message_submitted || ''}`.trim();
  const label = `${payload.whatsapp_final_label || ''}`.toLowerCase();

  if (!message) {
    throw new Error('message_submitted is required');
  }
  if (!['utility', 'marketing'].includes(label)) {
    throw new Error('whatsapp_final_label must be utility or marketing');
  }
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}





