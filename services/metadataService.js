const ExifReader = require('exifreader');
const crypto = require('crypto');

/**
 * Parses EXIF date string in format "YYYY:MM:DD HH:MM:SS" into JavaScript Date
 */
function parseExifDate(dateStr) {
  if (!dateStr) return null;
  
  // Clean string in case of trailing characters or formats
  const cleanStr = String(dateStr).trim();
  const parts = cleanStr.split(' ');
  if (parts.length !== 2) return null;
  
  const dateParts = parts[0].split(':');
  const timeParts = parts[1].split(':');
  if (dateParts.length !== 3 || timeParts.length !== 3) return null;
  
  // Date constructor takes 0-indexed month (0 = Jan, 11 = Dec)
  return new Date(
    parseInt(dateParts[0], 10),
    parseInt(dateParts[1], 10) - 1,
    parseInt(dateParts[2], 10),
    parseInt(timeParts[0], 10),
    parseInt(timeParts[1], 10),
    parseInt(timeParts[2], 10)
  );
}

/**
 * Computes the geodesic distance in kilometers between two GPS coordinates
 * using the Haversine formula.
 */
function calculateDistance(lat1, lon1, lat2, lon2) {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

/**
 * Generates a structural fingerprint (simplified perceptual similarity hash)
 * by sampling bytes across the buffer.
 */
function computeStructuralFingerprint(buffer) {
  if (buffer.length < 100) return '0000000000000000';
  let fingerprint = '';
  const step = Math.floor(buffer.length / 16);
  for (let i = 0; i < 16; i++) {
    const byte = buffer[i * step];
    fingerprint += (byte % 16).toString(16);
  }
  return fingerprint;
}

/**
 * Validates the uploaded file's metadata and checks originality
 * @param {Buffer} fileBuffer - Uploaded image buffer
 * @param {Object} browserLocation - { latitude, longitude } from browser GPS
 * @param {Array} existingComplaints - List of current complaints for duplicate checking
 * @returns {Promise<Object>} Verification results
 */
async function verifyOriginality(fileBuffer, browserLocation, existingComplaints = []) {
  const result = {
    isValid: true,
    status: 'VERIFIED',
    score: 100,
    details: {
      gpsPresent: false,
      gpsCoords: null,
      photoTime: null,
      device: 'Unknown',
      softwareEdited: false,
      isDuplicate: false,
      timeVarianceHours: null,
      browserDistanceKm: null
    },
    flags: []
  };

  // 1. Calculate File Hashes
  const sha256 = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const fingerprint = computeStructuralFingerprint(fileBuffer);
  result.details.sha256 = sha256;
  result.details.fingerprint = fingerprint;

  // Check duplicate hash
  const duplicate = existingComplaints.find(c => c.sha256 === sha256 || (c.fingerprint && c.fingerprint === fingerprint));
  if (duplicate) {
    result.isValid = false;
    result.status = 'DUPLICATE_DETECTED';
    result.score = 0;
    result.details.isDuplicate = true;
    result.flags.push('Exact duplicate of an existing complaint image');
    return result; // Quick return on duplicate
  }

  try {
    // 2. Load EXIF Metadata
    const tags = ExifReader.load(fileBuffer);
    
    // 3. Extract GPS
    let lat = null;
    let lon = null;
    
    if (tags.GPSLatitude && tags.GPSLongitude) {
      // ExifReader's 'description' holds decimal degrees
      const parsedLat = parseFloat(tags.GPSLatitude.description);
      const parsedLon = parseFloat(tags.GPSLongitude.description);
      
      if (!isNaN(parsedLat) && !isNaN(parsedLon)) {
        lat = parsedLat;
        lon = parsedLon;
      } else if (Array.isArray(tags.GPSLatitude.value)) {
        // Safe DMS conversion fallback
        const latVals = tags.GPSLatitude.value;
        const lonVals = tags.GPSLongitude.value;
        const latRef = tags.GPSLatitudeRef ? tags.GPSLatitudeRef.description : 'N';
        const lonRef = tags.GPSLongitudeRef ? tags.GPSLongitudeRef.description : 'E';
        
        lat = latVals[0] + latVals[1] / 60 + latVals[2] / 3600;
        lon = lonVals[0] + lonVals[1] / 60 + lonVals[2] / 3600;
        
        if (latRef === 'S' || latRef === 'South') lat = -lat;
        if (lonRef === 'W' || lonRef === 'West') lon = -lon;
      }
    }

    if (lat !== null && lon !== null) {
      result.details.gpsPresent = true;
      result.details.gpsCoords = { latitude: lat, longitude: lon };
    } else {
      result.isValid = false;
      result.status = 'SUSPICIOUS_METADATA';
      result.score -= 40;
      result.flags.push('Missing GPS coordinates in image metadata');
    }

    // 4. Extract Timestamp
    let photoDate = null;
    const dateTag = tags.DateTimeOriginal || tags.DateTime || tags.DateTimeDigitized;
    if (dateTag) {
      photoDate = parseExifDate(dateTag.description || dateTag.value);
      if (photoDate) {
        result.details.photoTime = photoDate.toISOString();
        
        // Time variance check (relative to current upload time)
        const now = new Date();
        const diffMs = Math.abs(now.getTime() - photoDate.getTime());
        const diffHours = diffMs / (1000 * 60 * 60);
        result.details.timeVarianceHours = Math.round(diffHours * 10) / 10;
        
        // Flag if photo was taken more than 48 hours ago
        if (diffHours > 48) {
          result.score -= 20;
          result.flags.push(`Photo is stale (taken ${result.details.timeVarianceHours} hours ago)`);
        }
      }
    }
    
    if (!photoDate) {
      result.score -= 15;
      result.flags.push('Missing photo capture timestamp in image metadata');
    }

    // 5. Extract Device & Editing Software info (Anti-spoofing)
    const make = tags.Make ? tags.Make.description : '';
    const model = tags.Model ? tags.Model.description : '';
    if (make || model) {
      result.details.device = `${make} ${model}`.trim();
    }

    const software = tags.Software ? tags.Software.description : null;
    if (software) {
      const lowerSoft = software.toLowerCase();
      if (lowerSoft.includes('photoshop') || lowerSoft.includes('gimp') || lowerSoft.includes('lightroom') || lowerSoft.includes('picsart') || lowerSoft.includes('editor')) {
        result.details.softwareEdited = true;
        result.score -= 25;
        result.flags.push(`Edited using software: ${software}`);
      }
    }

    // 6. Location Consistency Check (Compare Browser GPS vs Image GPS)
    if (lat !== null && lon !== null && browserLocation && browserLocation.latitude && browserLocation.longitude) {
      const dist = calculateDistance(
        lat, lon,
        parseFloat(browserLocation.latitude),
        parseFloat(browserLocation.longitude)
      );
      result.details.browserDistanceKm = Math.round(dist * 100) / 100;
      
      // Flag if user location is more than 2 km away from photo location
      if (dist > 2.0) {
        result.score -= 20;
        result.flags.push(`Location mismatch: Uploaded photo taken ${result.details.browserDistanceKm} km away from submission location`);
      }
    }

  } catch (err) {
    // If exif parsing throws, check if it's just missing EXIF headers (which happens with web downloads or screenshot uploads)
    result.isValid = false;
    result.status = 'SUSPICIOUS_METADATA';
    result.score = 10; // Highly suspicious if it's an image without standard structure
    result.flags.push('Unable to parse EXIF metadata (possible screenshot, scrubbed web image, or format conversion)');
  }

  // Adjust overall valid status based on score threshold
  if (result.score < 50) {
    result.isValid = false;
    result.status = 'SUSPICIOUS_METADATA';
  }

  return result;
}

module.exports = {
  verifyOriginality,
  calculateDistance,
  parseExifDate
};
