/**
 * Mock Model Classification Service
 * Simulates analyzing road conditions from an image buffer and returns category detections and bounding boxes.
 * Includes a pluggable HTTP hook structure to easily connect to a real Python/FastAPI model server later.
 */

// Toggle this to true to route to a real model API endpoints
const USE_REAL_MODEL_API = false;
const MODEL_API_ENDPOINT = 'http://localhost:8000/predict'; 

/**
 * Classifies road damage from an image buffer.
 * @param {Buffer} imageBuffer - Uploaded image buffer
 * @param {string} fileName - File name for logging/reference
 * @returns {Promise<Object>} Detection results
 */
async function analyzeRoadCondition(imageBuffer, fileName = '') {
  if (USE_REAL_MODEL_API) {
    try {
      // Future integration hook for Hemhalatha's trained model
      const FormData = require('form-data');
      const axios = require('axios');
      
      const form = new FormData();
      form.append('image', imageBuffer, { filename: fileName || 'road_damage.jpg' });
      
      const response = await axios.post(MODEL_API_ENDPOINT, form, {
        headers: form.getHeaders(),
        timeout: 5000 // 5 seconds timeout
      });
      return response.data;
    } catch (err) {
      console.warn('Real AI Model API connection failed, falling back to local simulation:', err.message);
      // Fallback to simulation if endpoint is down
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

      resolve({
        detected: issueType !== 'clean',
        primaryClass: issueType,
        displayName: label,
        description: description,
        confidence: Math.round(confidence * 1000) / 10, // format: 94.2
        detections: bbox,
        inferenceTimeMs: 50
      });
    }, 50);
  });
}

module.exports = {
  analyzeRoadCondition
};
