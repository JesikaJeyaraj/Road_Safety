/**
 * Model Classification Service
 * Uses a local PyTorch .pt model or deployed model API when configured,
 * otherwise falls back to the local mock classifier for demos.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');

const USE_REAL_MODEL_API = String(process.env.USE_REAL_MODEL_API || 'false').toLowerCase() === 'true';
const MODEL_API_ENDPOINT = process.env.MODEL_API_ENDPOINT || 'http://localhost:8000/predict';
const MODEL_API_TIMEOUT_MS = parseInt(process.env.MODEL_API_TIMEOUT_MS || '10000', 10);
const MODEL_WEIGHTS_PATH = process.env.MODEL_WEIGHTS_PATH || path.join(__dirname, '..', 'best.pt');
const USE_LOCAL_PT_MODEL = process.env.USE_LOCAL_PT_MODEL
  ? String(process.env.USE_LOCAL_PT_MODEL).toLowerCase() === 'true'
  : fs.existsSync(MODEL_WEIGHTS_PATH);
const MODEL_PYTHON_PATH = process.env.MODEL_PYTHON_PATH || 'python';
const MODEL_BRIDGE_SCRIPT = process.env.MODEL_BRIDGE_SCRIPT || path.join(__dirname, 'pavementClassifier.py');

const SEVERITY_BY_CLASS = {
  pothole: 'High',
  cracks: 'Medium',
  faded_markings: 'Low',
  debris: 'High',
  good_condition: 'Low',
  poor_condition: 'High',
  clean: 'Low',
  other: 'Medium'
};

function normalizeCategory(value) {
  const raw = String(value || '').trim().toLowerCase();
  const compact = raw.replace(/[\s-]+/g, '_');
  if (compact === 'good_condition' || compact === 'good') return 'good_condition';
  if (compact === 'poor_condition' || compact === 'poor' || compact.includes('bad')) return 'poor_condition';
  if (compact.includes('pothole')) return 'pothole';
  if (compact.includes('crack')) return 'cracks';
  if (compact.includes('marking') || compact.includes('lane')) return 'faded_markings';
  if (compact.includes('debris') || compact.includes('obstruction')) return 'debris';
  if (compact.includes('normal') || compact.includes('clean') || compact.includes('none')) return 'good_condition';
  return compact || 'other';
}

function normalizeConfidence(value) {
  const num = Number(value);
  if (!Number.isFinite(num)) return 0;
  return Math.round((num <= 1 ? num * 100 : num) * 10) / 10;
}

function normalizeModelResponse(payload, source = 'real_api') {
  payload = payload || {};
  const category = normalizeCategory(
    payload.primaryClass ||
    payload.defectCategory ||
    payload.defect_category ||
    payload.category ||
    payload.class ||
    payload.label
  );
  const displayName = payload.displayName || payload.display_name || payload.label || category.replace(/_/g, ' ');
  const confidence = normalizeConfidence(payload.confidence || payload.confidenceScore || payload.confidence_score);
  const severity = payload.severityLevel || payload.severity_level || payload.severity || SEVERITY_BY_CLASS[category] || 'Medium';

  return {
    detected: typeof payload.detected === 'boolean' ? payload.detected : category === 'poor_condition' || !['clean', 'good_condition'].includes(category),
    primaryClass: category,
    defectCategory: category,
    displayName,
    description: payload.description || '',
    confidence,
    confidenceScore: confidence,
    severity,
    severityLevel: severity,
    detections: payload.detections || payload.boundingBoxes || payload.bounding_boxes || [],
    inferenceTimeMs: payload.inferenceTimeMs || payload.inference_time_ms || null,
    source,
    raw: source === 'real_api' || source === 'local_pt' ? payload : undefined
  };
}

function runLocalPtModel(imageBuffer, fileName = '') {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(MODEL_WEIGHTS_PATH)) {
      reject(new Error(`Model weights not found at ${MODEL_WEIGHTS_PATH}`));
      return;
    }

    const ext = path.extname(fileName || '') || '.jpg';
    const tempImagePath = path.join(os.tmpdir(), `road-${Date.now()}-${Math.random().toString(16).slice(2)}${ext}`);
    fs.writeFileSync(tempImagePath, imageBuffer);

    const child = spawn(MODEL_PYTHON_PATH, [MODEL_BRIDGE_SCRIPT, MODEL_WEIGHTS_PATH, tempImagePath], {
      windowsHide: true
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', data => {
      stdout += data.toString();
    });

    child.stderr.on('data', data => {
      stderr += data.toString();
    });

    child.on('error', err => {
      fs.rm(tempImagePath, { force: true }, () => {});
      reject(err);
    });

    child.on('close', code => {
      fs.rm(tempImagePath, { force: true }, () => {});
      if (code !== 0) {
        reject(new Error(stderr || `Local model bridge exited with code ${code}`));
        return;
      }

      try {
        resolve(normalizeModelResponse(JSON.parse(stdout), 'local_pt'));
      } catch (err) {
        reject(new Error(`Invalid model bridge JSON: ${err.message}`));
      }
    });
  });
}

async function callRealModelApi(imageBuffer, fileName = '') {
  const form = new FormData();
  form.append('image', new Blob([imageBuffer]), fileName || 'road_damage.jpg');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MODEL_API_TIMEOUT_MS);
  try {
    const response = await fetch(MODEL_API_ENDPOINT, {
      method: 'POST',
      body: form,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Model API returned ${response.status}`);
    }

    return normalizeModelResponse(await response.json(), 'real_api');
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Classifies road damage from an image buffer.
 * @param {Buffer} imageBuffer - Uploaded image buffer
 * @param {string} fileName - File name for logging/reference
 * @returns {Promise<Object>} Detection results
 */
async function analyzeRoadCondition(imageBuffer, fileName = '') {
  if (USE_LOCAL_PT_MODEL) {
    try {
      return await runLocalPtModel(imageBuffer, fileName);
    } catch (err) {
      console.error('Local PyTorch model failed, falling back to next classifier:', err.message);
    }
  }

  if (USE_REAL_MODEL_API) {
    try {
      return await callRealModelApi(imageBuffer, fileName);
    } catch (err) {
      console.error('Real AI Model API connection failed, falling back to local simulation:', err.message);
    }
  }

  // Local Simulation Mode (Simulates reading the image characteristics)
  return new Promise((resolve) => {
    // Artificial processing latency of 50ms to simulate fast inference time
    setTimeout(() => {
      // Analyze file characteristics to make mock classification dynamic
      const fileLength = imageBuffer.length;
      
      // Determine simulated issue based on file size modulo
      let issueType = 'pothole';
      let confidence = 0.85 + (fileLength % 15) / 100; // 85% to 99%
      let bbox = [];
      let label = '';
      let description = '';
      
      const categorySelector = fileLength % 5;
      
      switch (categorySelector) {
        case 0:
          issueType = 'pothole';
          label = 'Pothole';
          description = 'Deep depression in highway surface with visible structural degradation.';
          bbox = [
            { x_min: 30, y_min: 45, x_max: 75, y_max: 80, label: 'Pothole', confidence }
          ];
          break;
        case 1:
          issueType = 'cracks';
          label = 'Alligator Cracking';
          description = 'Interconnected cracks indicating fatigue and base failure of pavement.';
          bbox = [
            { x_min: 20, y_min: 30, x_max: 85, y_max: 70, label: 'Cracking Area', confidence }
          ];
          break;
        case 2:
          issueType = 'faded_markings';
          label = 'Faded Lane Markings';
          description = 'Significant wear on lane separation lines reducing visibility.';
          bbox = [
            { x_min: 45, y_min: 10, x_max: 55, y_max: 90, label: 'Faded Marking', confidence }
          ];
          break;
        case 3:
          issueType = 'debris';
          label = 'Debris on Roadway';
          description = 'Large structural debris or waste blocking lane movement.';
          bbox = [
            { x_min: 40, y_min: 50, x_max: 65, y_max: 75, label: 'Obstruction', confidence }
          ];
          break;
        case 4:
          // Simulate clean road
          issueType = 'clean';
          label = 'Normal / No Damage';
          description = 'Road surface condition is within safety tolerances. No structural repairs needed.';
          confidence = 0.95 + (fileLength % 5) / 100;
          bbox = [];
          break;
      }

      resolve(normalizeModelResponse({
        detected: issueType !== 'clean',
        primaryClass: issueType,
        displayName: label,
        description: description,
        confidence: Math.round(confidence * 1000) / 10, // format: 94.2
        severity: SEVERITY_BY_CLASS[issueType] || 'Medium',
        detections: bbox,
        inferenceTimeMs: 50
      }, 'mock'));
    }, 50);
  });
}

module.exports = {
  analyzeRoadCondition,
  normalizeModelResponse
};
