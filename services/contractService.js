const fs = require('fs');
const path = require('path');
const { calculateDistance } = require('./metadataService');

const CONTRACTS_FILE = path.join(__dirname, '..', 'data', 'contracts.json');

/**
 * Load all road contracts from the local JSON database
 */
function readContracts() {
  try {
    if (!fs.existsSync(CONTRACTS_FILE)) {
      return [];
    }
    return JSON.parse(fs.readFileSync(CONTRACTS_FILE, 'utf8'));
  } catch (err) {
    console.error('Error reading contracts database:', err.message);
    return [];
  }
}

/**
 * Resolves the closest contractor detail based on latitude and longitude coordinates.
 */
function findNearestContract(latitude, longitude) {
  const contracts = readContracts();
  if (contracts.length === 0) {
    return null;
  }

  // If no GPS coords, return the general fallback contract (typically last in database)
  if (!latitude || !longitude) {
    return contracts.find(c => c.id === 'CON-GEN-999') || contracts[contracts.length - 1];
  }

  let closestContract = null;
  let minDistance = Infinity;

  // Search through all contracts to find the closest one geographically
  for (const contract of contracts) {
    if (contract.id === 'CON-GEN-999') continue; // Skip generic fallback in search
    const distance = calculateDistance(latitude, longitude, contract.latitude, contract.longitude);
    if (distance < minDistance) {
      minDistance = distance;
      closestContract = contract;
    }
  }

  // If the closest contract is within the allowed range or if we just want the closest
  if (closestContract && minDistance <= (closestContract.rangeKm || 300)) {
    return {
      ...closestContract,
      matchedDistanceKm: Math.round(minDistance * 100) / 100
    };
  }

  // Default fallback if too far
  return contracts.find(c => c.id === 'CON-GEN-999') || contracts[contracts.length - 1];
}

/**
 * Dynamically estimates the Safety Hazard Index (1-100) and Severity Level
 * @param {string} category - Damage category
 * @param {string} description - Citizen description text
 * @param {number} originalityScore - Metadata check originality score (0-100)
 */
function calculateHazardIndex(category, description, originalityScore = 100) {
  let baseScore = 30; // Start with a baseline score

  // 1. Adjust by category severity
  switch (category) {
    case 'pothole':
      baseScore = 65; // Potholes are medium-high hazards
      break;
    case 'cracks':
      baseScore = 45; // Cracks are moderate hazards
      break;
    case 'faded_markings':
      baseScore = 35; // Faded markings are low-medium hazards
      break;
    case 'debris':
      baseScore = 80; // Debris represents immediate blockages / high danger
      break;
    case 'other':
    default:
      baseScore = 40;
      break;
  }

  // 2. Adjust by description keyword analysis
  const descLower = (description || '').toLowerCase();
  const highRiskKeywords = ['accident', 'crash', 'danger', 'blind spot', 'sharp turn', 'critical', 'injury', 'highway', 'expressway', 'speeding', 'collision', 'die', 'death', 'severe'];
  const mediumRiskKeywords = ['deep', 'huge', 'broken', 'damage', 'water', 'flooded', 'night', 'dark', 'unsafe'];

  highRiskKeywords.forEach(word => {
    if (descLower.includes(word)) {
      baseScore += 8;
    }
  });

  mediumRiskKeywords.forEach(word => {
    if (descLower.includes(word)) {
      baseScore += 4;
    }
  });

  // 3. Penalty/Adjustment based on originality (unverified reports have lower severity weights until field audited)
  if (originalityScore < 50) {
    baseScore -= 15;
  }

  // Cap between 1 and 100
  const finalScore = Math.max(1, Math.min(100, baseScore));

  // Determine Severity Level
  let level = 'Low';
  if (finalScore >= 80) {
    level = 'Critical';
  } else if (finalScore >= 60) {
    level = 'High';
  } else if (finalScore >= 40) {
    level = 'Medium';
  }

  return {
    score: finalScore,
    level: level
  };
}

module.exports = {
  findNearestContract,
  calculateHazardIndex
};
