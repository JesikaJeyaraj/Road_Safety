const { findNearestPIU } = require('./emailService');

const ENABLE_REVERSE_GEOCODING = String(process.env.ENABLE_REVERSE_GEOCODING || 'true').toLowerCase() === 'true';
const REVERSE_GEOCODE_ENDPOINT = process.env.REVERSE_GEOCODE_ENDPOINT || 'https://nominatim.openstreetmap.org/reverse';
const REVERSE_GEOCODE_TIMEOUT_MS = parseInt(process.env.REVERSE_GEOCODE_TIMEOUT_MS || '4000', 10);

function textIncludes(value, terms) {
  const lower = String(value || '').toLowerCase();
  return terms.some(term => lower.includes(term));
}

function determineRoadType(address = {}, displayName = '') {
  const roadText = `${address.road || ''} ${address.highway || ''} ${displayName}`;

  if (/\bnh\s*-?\s*\d+/i.test(roadText) || textIncludes(roadText, ['national highway'])) {
    return 'National Highway';
  }
  if (/\bsh\s*-?\s*\d+/i.test(roadText) || textIncludes(roadText, ['state highway'])) {
    return 'State Highway';
  }
  if (textIncludes(roadText, ['service road'])) {
    return 'Service Road';
  }
  if (address.city || address.town || address.municipality || address.suburb) {
    return 'Urban Road';
  }
  if (address.village || address.hamlet || address.county) {
    return 'Rural Road';
  }
  return 'District Road';
}

function determineAuthority(roadType, latitude, longitude) {
  if (roadType === 'National Highway') {
    const piu = findNearestPIU(latitude, longitude);
    return {
      type: 'NHAI PIU',
      name: piu.name,
      email: piu.email,
      distanceKm: piu.distanceKm || null
    };
  }

  if (roadType === 'State Highway') {
    return { type: 'State Highways Department', name: 'State Highways Department', email: 'state-highways@mock.gov.in' };
  }

  if (roadType === 'Urban Road' || roadType === 'Service Road') {
    return { type: 'Municipal Corporation', name: 'Municipal Road Maintenance Cell', email: 'municipal-roads@mock.gov.in' };
  }

  if (roadType === 'Rural Road') {
    return { type: 'Panchayat', name: 'Local Panchayat Road Works', email: 'panchayat-roads@mock.gov.in' };
  }

  return { type: 'Other road-maintenance agency', name: 'District Road Maintenance Office', email: 'district-roads@mock.gov.in' };
}

async function reverseGeocode(latitude, longitude) {
  if (!ENABLE_REVERSE_GEOCODING || !latitude || !longitude || typeof fetch !== 'function') {
    return null;
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REVERSE_GEOCODE_TIMEOUT_MS);

  try {
    const url = `${REVERSE_GEOCODE_ENDPOINT}?format=jsonv2&lat=${encodeURIComponent(latitude)}&lon=${encodeURIComponent(longitude)}&zoom=18&addressdetails=1`;
    const response = await fetch(url, {
      headers: { 'User-Agent': 'road-safety-complaints/1.0' },
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Reverse geocoder returned ${response.status}`);
    }

    return await response.json();
  } catch (err) {
    console.warn('Reverse geocoding unavailable:', err.message);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function resolveRoadContext(latitude, longitude) {
  const geocode = await reverseGeocode(latitude, longitude);
  const address = geocode && geocode.address ? geocode.address : {};
  const roadName = address.road || address.highway || address.neighbourhood || '';
  const roadType = determineRoadType(address, geocode ? geocode.display_name : '');
  const authority = determineAuthority(roadType, latitude, longitude);

  return {
    roadName,
    streetName: address.road || '',
    area: address.suburb || address.neighbourhood || address.village || address.hamlet || '',
    city: address.city || address.town || address.municipality || address.village || '',
    district: address.state_district || address.county || '',
    state: address.state || '',
    pinCode: address.postcode || '',
    roadType,
    authority,
    geocodeProvider: geocode ? 'OpenStreetMap Nominatim' : 'local-fallback',
    rawAddress: address
  };
}

module.exports = {
  resolveRoadContext,
  determineRoadType,
  determineAuthority
};
