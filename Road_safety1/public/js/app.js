// Global States
let selectedFile = null;
let clientGpsCoords = null; // Coordinates extracted from photo EXIF
let browserGpsCoords = null; // Browser geolocation coordinates
let mainMap = null;
let mainMarker = null;
let heatmapMap = null;
let heatmapLayer = null;
let heatmapMarkersLayer = null;
let heatmapComplaintData = [];
let latestAiSuggestion = null;
let latestRoadContext = null;
let manualGpsCoords = null;
let manualLocationMode = false;
let roadOptionData = null;

// Initialize components when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Capture user's browser coordinates for originality comparison
  requestBrowserLocation();

  // Poll complaints list if admin tab loaded
  loadAdminData();
  loadRoadOptions();
});

async function loadRoadOptions() {
  try {
    const response = await fetch('/api/location/options');
    if (!response.ok) throw new Error('Unable to load road options');
    roadOptionData = await response.json();
    initializeRoadSelectors();
  } catch (err) {
    console.warn('Falling back to built-in road option set:', err.message);
    roadOptionData = {
      states: ['Tamil Nadu'],
      districts: { 'Tamil Nadu': ['Chennai'] },
      areas: { Chennai: ['Guindy'] },
      roads: {
        Guindy: [
          { name: 'Grand Southern Trunk Road', roadType: 'National Highway', highwayNo: 'NH-32' }
        ]
      },
      roadTypes: ['National Highway', 'State Highway', 'District Road', 'Urban Road', 'Rural Road', 'Service Road'],
      highwayNumbers: ['NH-32']
    };
    initializeRoadSelectors();
  }
}

function populateSelect(selectEl, values, selectedValue = '') {
  if (!selectEl) return;
  selectEl.innerHTML = '';
  values.forEach(value => {
    const option = document.createElement('option');
    option.value = typeof value === 'string' ? value : value.value;
    option.innerText = typeof value === 'string' ? value : value.label;
    if (option.value === selectedValue) option.selected = true;
    selectEl.appendChild(option);
  });
}

function initializeRoadSelectors() {
  if (!roadOptionData) return;

  const stateSelect = document.getElementById('state-select');
  const districtSelect = document.getElementById('district-select');
  const areaSelect = document.getElementById('area-select');
  const roadNameSelect = document.getElementById('road-name-select');
  const roadTypeSelect = document.getElementById('road-type-select');
  const highwaySelect = document.getElementById('highway-no-select');

  populateSelect(stateSelect, roadOptionData.states, 'Tamil Nadu');
  populateSelect(districtSelect, roadOptionData.districts['Tamil Nadu'] || [], 'Chennai');
  populateSelect(areaSelect, roadOptionData.areas['Chennai'] || [], 'Guindy');

  const roadEntries = roadOptionData.roads['Guindy'] || [];
  populateSelect(roadNameSelect, roadEntries.map(r => r.name), 'Grand Southern Trunk Road');
  populateSelect(roadTypeSelect, roadOptionData.roadTypes || []);

  const selectedRoad = roadEntries.find(r => r.name === 'Grand Southern Trunk Road') || roadEntries[0];
  if (selectedRoad) {
    roadTypeSelect.value = selectedRoad.roadType || roadTypeSelect.value;
    populateSelect(highwaySelect, [
      selectedRoad.highwayNo || 'Not applicable',
      ...(roadOptionData.highwayNumbers || []).filter(no => no !== selectedRoad.highwayNo)
    ].filter(Boolean), selectedRoad.highwayNo || 'Not applicable');
  } else {
    populateSelect(highwaySelect, roadOptionData.highwayNumbers || [], '');
  }

  updateRoadContextPreview();
}

function handleRoadOptionChange(level) {
  if (!roadOptionData) return;

  const state = document.getElementById('state-select').value;
  const district = document.getElementById('district-select').value;
  const area = document.getElementById('area-select').value;
  const roadNameSelect = document.getElementById('road-name-select');
  const roadTypeSelect = document.getElementById('road-type-select');
  const highwaySelect = document.getElementById('highway-no-select');

  if (level === 'state') {
    populateSelect(document.getElementById('district-select'), roadOptionData.districts[state] || [], '');
    populateSelect(document.getElementById('area-select'), [], '');
    populateSelect(roadNameSelect, [], '');
    populateSelect(roadTypeSelect, roadOptionData.roadTypes || [], '');
    populateSelect(highwaySelect, [], '');
  }

  if (level === 'district') {
    populateSelect(document.getElementById('area-select'), roadOptionData.areas[district] || [], '');
    populateSelect(roadNameSelect, [], '');
    populateSelect(roadTypeSelect, roadOptionData.roadTypes || [], '');
    populateSelect(highwaySelect, [], '');
  }

  if (level === 'area') {
    const roadEntries = roadOptionData.roads[area] || [];
    populateSelect(roadNameSelect, roadEntries.map(r => r.name), '');
    populateSelect(roadTypeSelect, roadOptionData.roadTypes || [], '');
    populateSelect(highwaySelect, [], '');
  }

  if (level === 'road') {
    const roadEntries = roadOptionData.roads[area] || [];
    const selectedRoad = roadEntries.find(r => r.name === roadNameSelect.value);
    if (selectedRoad) {
      roadTypeSelect.value = selectedRoad.roadType || roadTypeSelect.value;
      populateSelect(highwaySelect, [
        selectedRoad.highwayNo || 'Not applicable',
        ...(roadOptionData.highwayNumbers || []).filter(no => no !== selectedRoad.highwayNo)
      ].filter(Boolean), selectedRoad.highwayNo || 'Not applicable');
    }
  }

  updateRoadContextPreview();
}

function updateRoadContextPreview() {
  const state = document.getElementById('state-select').value;
  const district = document.getElementById('district-select').value;
  const area = document.getElementById('area-select').value;
  const roadName = document.getElementById('road-name-select').value;
  const roadType = document.getElementById('road-type-select').value;
  const highwayNo = document.getElementById('highway-no-select').value;

  document.getElementById('auto-road-name').innerText = roadName || '--';
  document.getElementById('auto-road-type').innerText = roadType || '--';
  document.getElementById('auto-authority').innerText = roadType === 'National Highway' ? 'NHAI PIU' : (roadType ? 'Local authority' : '--');
  latestRoadContext = { state, district, area, roadName, roadType, highwayNo };
}

function ensureSelectValue(selectEl, value) {
  if (!selectEl || !value) return;
  let option = Array.from(selectEl.options).find(opt => opt.value === value);
  if (!option) {
    option = document.createElement('option');
    option.value = value;
    option.innerText = value;
    selectEl.appendChild(option);
  }
  selectEl.value = value;
}

function getGpsFromTags(tags) {
  if (!tags || !tags.GPSLatitude || !tags.GPSLongitude) return null;
  const lat = parseExifCoordinate(tags.GPSLatitude, tags.GPSLatitudeRef);
  const lon = parseExifCoordinate(tags.GPSLongitude, tags.GPSLongitudeRef);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { latitude: lat, longitude: lon };
}

function parseExifCoordinate(tag, refTag) {
  if (!tag) return NaN;
  const refRaw = typeof refTag === 'string'
    ? refTag
    : (refTag && (refTag.description || refTag.value));
  const ref = String(refRaw || '').trim().toUpperCase();
  const parts = Array.isArray(tag.value)
    ? tag.value
    : Array.isArray(tag)
      ? tag
      : typeof tag === 'string'
        ? tag.split(/[ ,]+/)
        : (tag && typeof tag === 'object' && 'value' in tag)
          ? tag.value
          : [];

  const degrees = convertExifValue(parts[0]);
  const minutes = convertExifValue(parts[1]);
  const seconds = convertExifValue(parts[2]);
  if (![degrees, minutes, seconds].every(Number.isFinite)) return NaN;
  let decimal = degrees + (minutes / 60) + (seconds / 3600);
  if (ref === 'S' || ref === 'W') decimal = -decimal;
  return decimal;
}

function convertExifValue(value) {
  if (value === undefined || value === null) return NaN;
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const cleaned = value.trim();
    if (cleaned.includes('/')) {
      const [num, den] = cleaned.split('/').map(x => parseFloat(x.trim()));
      return Number.isFinite(num) && Number.isFinite(den) && den !== 0 ? num / den : NaN;
    }
    return parseFloat(cleaned);
  }
  if (typeof value === 'object') {
    if ('numerator' in value && 'denominator' in value) {
      return Number(value.numerator) / Number(value.denominator);
    }
    if ('value' in value) {
      return convertExifValue(value.value);
    }
    if (Array.isArray(value)) {
      return convertExifValue(value[0]);
    }
  }
  return NaN;
}

/**
 * Retrieve User's current browser location
 */
function requestBrowserLocation() {
  if (navigator.geolocation) {
    navigator.geolocation.getCurrentPosition(
      (position) => {
        browserGpsCoords = {
          latitude: position.coords.latitude,
          longitude: position.coords.longitude
        };
        if (!clientGpsCoords && !manualGpsCoords) {
          setComplaintLocation(browserGpsCoords.latitude, browserGpsCoords.longitude, 'Current GPS Location');
        }
        console.log('Browser coordinates captured:', browserGpsCoords);
      },
      (error) => {
        console.warn('Browser location access denied or unavailable:', error.message);
        updateLocationFallbackMessage();
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }
}

function showUploadSheet() {
  const sheet = document.getElementById('upload-sheet');
  if (sheet) {
    sheet.classList.add('open');
    document.body.style.overflow = 'hidden';
  }
}

function closeUploadSheet() {
  const sheet = document.getElementById('upload-sheet');
  if (sheet) {
    sheet.classList.remove('open');
    document.body.style.overflow = '';
  }
}

let cameraStream = null;

REPLACE
function openCameraModal() {
  const modal = document.getElementById('camera-modal');
  const videoEl = document.getElementById('camera-preview');
  if (!modal || !videoEl) {
    console.warn('Camera modal elements missing');
    return;
  }

  modal.classList.add('open');
  document.body.style.overflow = 'hidden';

  navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } } })
    .catch(() => navigator.mediaDevices.getUserMedia({ video: true }))
    .then(stream => {
      cameraStream = stream;
      videoEl.srcObject = stream;
      return videoEl.play();
    })
    .catch(err => {
      console.warn('Unable to open camera stream:', err.message);
      closeCameraModal();
      const input = document.getElementById('camera-file');
      if (input) input.click();
    });
}


function closeCameraModal() {
  const modal = document.getElementById('camera-modal');
  const videoEl = document.getElementById('camera-preview');
  if (modal) {
    modal.classList.remove('open');
  }
  if (videoEl) {
    videoEl.pause();
    videoEl.srcObject = null;
  }
  if (cameraStream) {
    cameraStream.getTracks().forEach(track => track.stop());
    cameraStream = null;
  }
  document.body.style.overflow = '';
}

function captureCameraPhoto() {
  const videoEl = document.getElementById('camera-preview');
  if (!videoEl || !videoEl.videoWidth || !videoEl.videoHeight) {
    alert('Camera is not ready yet. Please wait a moment and try again.');
    return;
  }

  const canvas = document.createElement('canvas');
  canvas.width = videoEl.videoWidth;
  canvas.height = videoEl.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);

  canvas.toBlob((blob) => {
    if (!blob) {
      alert('Unable to capture photo from camera. Try again or use gallery.');
      return;
    }
    const file = new File([blob], `webcam-${Date.now()}.jpg`, { type: 'image/jpeg' });
    handleFile(file);
    closeCameraModal();
  }, 'image/jpeg', 0.95);
}

/**
 * Navigation switch tab controller
 */
function switchTab(tabId) {
  // Hide all tab panels
  document.querySelectorAll('.tab-content').forEach(tab => {
    tab.classList.remove('active');
  });
  
  // Deactivate all nav buttons
  document.querySelectorAll('.nav-tab').forEach(btn => {
    btn.classList.remove('active');
  });

  // Activate targeted elements
  document.getElementById(`tab-${tabId}`).classList.add('active');
  document.getElementById(`tab-${tabId}-btn`).classList.add('active');

  // Trigger specific tab loads
  if (tabId === 'admin') {
    loadAdminData();
    setTimeout(() => {
      if (heatmapMap) heatmapMap.invalidateSize();
    }, 150);
  }
}

function setComplaintLocation(lat, lon, label = 'Selected Complaint Location') {
  manualGpsCoords = { latitude: lat, longitude: lon };
  document.getElementById('auto-gps').innerText = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
  initLeafletMap(lat, lon, label);
  loadRoadContext(lat, lon);
}

function updateLocationFallbackMessage() {
  const helper = document.getElementById('map-helper');
  if (!helper) return;

  if (!window.isSecureContext && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
    helper.innerText = 'Mobile browsers may block GPS on HTTP LAN URLs. Use Pick Location on Map, or deploy with HTTPS for automatic GPS.';
  } else {
    helper.innerText = 'Photo GPS was not found. Tap Share Current GPS or Pick Location on Map.';
  }
}

function useCurrentLocation() {
  if (!navigator.geolocation) {
    alert('GPS location is not supported in this browser.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (position) => {
      browserGpsCoords = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude
      };
      setComplaintLocation(browserGpsCoords.latitude, browserGpsCoords.longitude, 'Current GPS Location');
    },
    (error) => {
      alert(`Unable to get current GPS location: ${error.message}`);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

function enableManualLocationSelect() {
  manualLocationMode = true;
  const center = browserGpsCoords || clientGpsCoords || manualGpsCoords || { latitude: 22.9734, longitude: 78.6569 };
  initLeafletMap(center.latitude, center.longitude, 'Tap map to select location');
  document.getElementById('map-helper').innerText = 'Tap anywhere on the map to set the complaint location.';
  setTimeout(() => {
    if (mainMap) mainMap.invalidateSize();
  }, 100);
}

function formatCategoryLabel(category) {
  return String(category || 'other')
    .replace(/_/g, ' ')
    .replace(/\b\w/g, letter => letter.toUpperCase());
}

function getSeverityWeight(severity) {
  if (severity === 'High') return 1;
  if (severity === 'Medium') return 0.65;
  return 0.35;
}

/**
 * Handles standard file browser selection
 */
function handleFileSelect(event) {
  const files = event.target.files;
  if (files.length > 0) {
    handleFile(files[0]);
  }
}

/**
 * Core processor for loaded file (Previews, Client-side EXIF parse, map update)
 */
function handleFile(file) {
  if (!file.type.startsWith('image/')) {
    alert('Please select an image file (JPEG or PNG)');
    return;
  }

  closeUploadSheet();
  selectedFile = file;
  document.getElementById('submit-btn').removeAttribute('disabled');
  
  const uploadSummary = document.getElementById('upload-summary');
  if (uploadSummary) {
    uploadSummary.innerHTML = `
      <p class="upload-text-main">${file.name}</p>
      <p class="upload-text-sub">Size: ${(file.size / (1024 * 1024)).toFixed(2)} MB — tap Upload Image to change.</p>
    `;
  }

  // Render Image Preview
  const reader = new FileReader();
  reader.onload = function (e) {
    const previewContainer = document.getElementById('image-preview-frame');
    const previewImg = document.getElementById('preview-img-element');
    previewImg.src = e.target.result;
    previewContainer.style.display = 'block';
  };
  reader.readAsDataURL(file);

  // Client-side EXIF Parsing
  const exifReader = new FileReader();
  exifReader.onload = function (e) {
    try {
      const tags = ExifReader.load(e.target.result);
      displayExifInfo(tags);
    } catch (err) {
      console.warn('No EXIF tags parsed client-side:', err.message);
      displayExifInfo(null);
    }
  };
  exifReader.readAsArrayBuffer(file);

  runAiEnrichment(file);
}

async function runAiEnrichment(file) {
  latestAiSuggestion = null;
  const badge = document.getElementById('ai-enrichment-badge');
  badge.className = 'badge badge-warning';
  badge.innerText = 'Analyzing';
  document.getElementById('apply-ai-btn').setAttribute('disabled', 'true');

  const formData = new FormData();
  formData.append('image', file);

  try {
    const response = await fetch('/api/model/analyze', {
      method: 'POST',
      body: formData
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.message || data.error || 'AI enrichment failed');

    latestAiSuggestion = data.enrichment;
    document.getElementById('ai-category').innerText = data.modelResults.displayName || '--';
    document.getElementById('ai-severity').innerText = data.enrichment.suggestedSeverity || '--';
    document.getElementById('ai-urgency').innerText = data.enrichment.urgencyLevel || '--';
    document.getElementById('ai-confidence').innerText = `${data.modelResults.confidence}%`;
    badge.className = data.modelResults.detected ? 'badge badge-danger' : 'badge badge-success';
    badge.innerText = data.modelResults.detected ? 'Review Needed' : 'Good';
    document.getElementById('apply-ai-btn').removeAttribute('disabled');
  } catch (err) {
    console.warn('AI enrichment unavailable:', err.message);
    badge.className = 'badge badge-warning';
    badge.innerText = 'Unavailable';
  }
}

function applyAiSuggestion() {
  if (!latestAiSuggestion) return;

  const categorySelect = document.getElementById('category-select');
  const descriptionInput = document.getElementById('description-input');
  const dimensionsInput = document.getElementById('dimensions-input');
  const safetyRiskSelect = document.getElementById('safety-risk-select');
  const trafficImpactSelect = document.getElementById('traffic-impact-select');

  if (latestAiSuggestion.suggestedCategory) categorySelect.value = latestAiSuggestion.suggestedCategory;
  if (latestAiSuggestion.suggestedDescription && !descriptionInput.value.trim()) {
    descriptionInput.value = latestAiSuggestion.suggestedDescription;
  }
  if (latestAiSuggestion.estimatedDimensions && !dimensionsInput.value.trim()) {
    dimensionsInput.value = latestAiSuggestion.estimatedDimensions;
  }
  if (latestAiSuggestion.suggestedSeverity && !safetyRiskSelect.value) {
    safetyRiskSelect.value = latestAiSuggestion.suggestedSeverity === 'High' ? 'High' : 'Low';
  }
  if (latestAiSuggestion.urgencyLevel && !trafficImpactSelect.value) {
    trafficImpactSelect.value = latestAiSuggestion.urgencyLevel === 'High' ? 'High' : 'Low';
  }
}

/**
 * Formats & Displays client-side EXIF details in the preview panels
 */
function displayExifInfo(tags) {
  const coordsEl = document.getElementById('meta-coords');
  const timeEl = document.getElementById('meta-time');
  const deviceEl = document.getElementById('meta-device');
  const softwareEl = document.getElementById('meta-software');
  const badge = document.getElementById('analysis-badge');

  // Reset values
  coordsEl.innerHTML = '--';
  timeEl.innerHTML = '--';
  deviceEl.innerHTML = '--';
  softwareEl.innerHTML = '--';
  clientGpsCoords = null;
  latestRoadContext = null;
  document.getElementById('auto-gps').innerText = 'Waiting for image GPS';
  document.getElementById('auto-road-name').innerText = '--';
  document.getElementById('auto-road-type').innerText = '--';
  document.getElementById('auto-authority').innerText = '--';

  if (mainMarker) {
    mainMarker.remove();
    mainMarker = null;
  }

  if (!tags) {
    badge.className = 'badge badge-danger';
    badge.innerText = 'Suspicious: Missing EXIF';
    softwareEl.innerText = 'No metadata (Cleaned or screenshotted)';
    document.getElementById('auto-gps').innerText = browserGpsCoords ? 'Using device GPS fallback' : 'Missing image GPS';
    if (browserGpsCoords) {
      setComplaintLocation(browserGpsCoords.latitude, browserGpsCoords.longitude, 'Device GPS Fallback');
    } else {
      updateLocationFallbackMessage();
    }
    return;
  }

  // 1. Coordinates
  const gps = getGpsFromTags(tags);
  if (gps) {
    const { latitude: lat, longitude: lon } = gps;
    clientGpsCoords = { latitude: lat, longitude: lon };
    coordsEl.innerText = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    document.getElementById('auto-gps').innerText = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
    badge.className = 'badge badge-success';
    badge.innerText = 'GPS Tagged';
    
    // Pin on Leaflet Map
    initLeafletMap(lat, lon);
    loadRoadContext(lat, lon);
  } else {
    badge.className = 'badge badge-warning';
    badge.innerText = 'Warning: Missing GPS';
    coordsEl.innerHTML = '<span style="color: var(--danger);">Not found</span>';
    document.getElementById('auto-gps').innerText = browserGpsCoords ? 'Using device GPS fallback' : 'Missing GPS metadata';
    if (browserGpsCoords) {
      setComplaintLocation(browserGpsCoords.latitude, browserGpsCoords.longitude, 'Device GPS Fallback');
    } else {
      updateLocationFallbackMessage();
    }
  }

  // 2. Taken Time
  const timeTag = tags.DateTimeOriginal || tags.DateTime || tags.DateTimeDigitized;
  const timeValue = timeTag ? (timeTag.description || timeTag.value || '') : '';
  if (timeValue) {
    timeEl.innerText = timeValue;
  } else {
    timeEl.innerHTML = '<span style="color: var(--text-secondary);">Unknown</span>';
  }

  // 3. Camera Device Make/Model
  const make = tags.Make ? tags.Make.description : '';
  const model = tags.Model ? tags.Model.description : '';
  if (make || model) {
    deviceEl.innerText = `${make} ${model}`.trim();
  } else {
    deviceEl.innerHTML = '<span style="color: var(--text-secondary);">Unknown Device</span>';
  }

  // 4. Editing Software
  const software = tags.Software ? tags.Software.description : null;
  if (software) {
    const lowerSoft = software.toLowerCase();
    if (lowerSoft.includes('photoshop') || lowerSoft.includes('gimp') || lowerSoft.includes('lightroom') || lowerSoft.includes('picsart') || lowerSoft.includes('editor')) {
      softwareEl.innerHTML = `<span style="color: var(--danger); font-weight: 700;">${software} (Edited)</span>`;
      badge.className = 'badge badge-danger';
      badge.innerText = 'Image Edited / Spoofed';
    } else {
      softwareEl.innerText = software;
    }
  } else {
    softwareEl.innerText = 'Camera Original (None)';
  }
}

/**
 * Initializes/Updates the Leaflet map preview
 */
function initLeafletMap(lat, lon, popupLabel = 'Captured Incident Location') {
  const mapContainer = document.getElementById('map-container');
  mapContainer.style.display = 'block';

  if (!mainMap) {
    mainMap = L.map('map-container').setView([lat, lon], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributing developers'
    }).addTo(mainMap);
    mainMap.on('click', (event) => {
      if (!manualLocationMode) return;
      setComplaintLocation(event.latlng.lat, event.latlng.lng, 'Manually Selected Location');
    });
  } else {
    mainMap.setView([lat, lon], 14);
  }

  // Add marker pinpoint
  if (mainMarker) {
    mainMarker.remove();
  }
  mainMarker = L.marker([lat, lon]).addTo(mainMap)
    .bindPopup(popupLabel)
    .openPopup();
    
  // Force size invalidation just in case container rendered hidden initially
  setTimeout(() => {
    mainMap.invalidateSize();
  }, 200);
}

/**
 * Submits the complaint details to the Express backend API
 */
async function submitComplaint(event) {
  event.preventDefault();
  
  if (!selectedFile) {
    alert('Please select or drop an image file first.');
    return;
  }

  const category = document.getElementById('category-select').value;
  const description = document.getElementById('description-input').value;
  const submitBtn = document.getElementById('submit-btn');

  // Disable button
  submitBtn.setAttribute('disabled', 'true');
  submitBtn.innerText = 'Uploading Report...';

  // Trigger AI laser scanning animation
  const scanner = document.getElementById('scanner-laser');
  const label = document.getElementById('scanner-label');
  scanner.style.display = 'flex';
  
  // Update scanner text intervals to show progress stages
  let stage = 0;
  const scanInterval = setInterval(() => {
    stage++;
    if (stage === 1) label.innerText = 'Extracting GPS details...';
    if (stage === 2) label.innerText = 'Hashing image bytes...';
    if (stage === 3) label.innerText = 'Running AI Road damage classification...';
    if (stage === 4) label.innerText = 'Routing PIU regional boundaries...';
    if (stage === 5) label.innerText = 'Generating PDF Letter attachment...';
  }, 700);

  // Compile FormData
  const formData = new FormData();
  formData.append('image', selectedFile);
  formData.append('category', category);
  formData.append('description', description);
  formData.append('landmark', document.getElementById('landmark-input').value);
  formData.append('directionOfTravel', document.getElementById('direction-select').value);
  formData.append('estimatedDimensions', document.getElementById('dimensions-input').value);
  formData.append('trafficImpact', document.getElementById('traffic-impact-select').value);
  formData.append('safetyRisk', document.getElementById('safety-risk-select').value);
  formData.append('state', document.getElementById('state-select').value);
  formData.append('district', document.getElementById('district-select').value);
  formData.append('area', document.getElementById('area-select').value);
  formData.append('roadName', document.getElementById('road-name-select').value);
  formData.append('roadType', document.getElementById('road-type-select').value);
  formData.append('highwayNo', document.getElementById('highway-no-select').value);
  const selectedLocation = clientGpsCoords || manualGpsCoords || browserGpsCoords;
  
  // Attach user browser coordinates if gathered
  if (selectedLocation) {
    formData.append('browserLocation', JSON.stringify(selectedLocation));
    formData.append('userLatitude', selectedLocation.latitude);
    formData.append('userLongitude', selectedLocation.longitude);
  }

  try {
    const response = await fetch('/api/complaints', {
      method: 'POST',
      body: formData
    });

    const data = await response.json();
    clearInterval(scanInterval);
    scanner.style.display = 'none';

    if (!response.ok) {
      throw new Error(data.message || data.error || 'Server filing failed.');
    }

    // Success! Redirect user to tracking tab and load the submitted ID
    alert(`Complaint filed successfully! Reference ID: ${data.complaint.id}`);
    
    // Reset Form
    document.getElementById('complaint-form').reset();
    resetReportTab();

    // Go to track tab
    document.getElementById('search-id-input').value = data.complaint.id;
    switchTab('track');
    trackComplaint(data.complaint.id);

  } catch (error) {
    clearInterval(scanInterval);
    scanner.style.display = 'none';
    submitBtn.removeAttribute('disabled');
    submitBtn.innerText = 'Submit Verified Complaint';
    alert(`Filing Error: ${error.message}`);
  }
}

/**
 * Resets Report Issue tab visuals back to defaults
 */
function resetReportTab() {
  selectedFile = null;
  clientGpsCoords = null;
  latestAiSuggestion = null;
  latestRoadContext = null;
  manualGpsCoords = null;
  manualLocationMode = false;
  
  const dropZone = document.getElementById('drop-zone');
  if (dropZone) {
    dropZone.classList.remove('dragover');
  }
  document.getElementById('image-preview-frame').style.display = 'none';
  document.getElementById('preview-img-element').src = '';
  document.getElementById('analysis-badge').className = 'badge badge-neutral';
  document.getElementById('analysis-badge').innerText = 'No media selected';
  document.getElementById('meta-coords').innerText = '--';
  document.getElementById('meta-time').innerText = '--';
  document.getElementById('meta-device').innerText = '--';
  document.getElementById('meta-software').innerText = '--';
  document.getElementById('auto-gps').innerText = 'Waiting for image GPS';
  document.getElementById('auto-road-name').innerText = '--';
  document.getElementById('auto-road-type').innerText = '--';
  document.getElementById('auto-authority').innerText = '--';
  document.getElementById('ai-enrichment-badge').className = 'badge badge-neutral';
  document.getElementById('ai-enrichment-badge').innerText = 'Waiting';
  document.getElementById('ai-category').innerText = '--';
  document.getElementById('ai-severity').innerText = '--';
  const uploadSummary = document.getElementById('upload-summary');
  if (uploadSummary) {
    uploadSummary.innerHTML = `
      <p class="upload-text-main">Tap to choose camera or gallery</p>
      <p class="upload-text-sub">Photo GPS will auto-populate location fields.</p>
    `;
  }

  document.getElementById('ai-urgency').innerText = '--';
  document.getElementById('ai-confidence').innerText = '--';
  closeUploadSheet();
  document.getElementById('apply-ai-btn').setAttribute('disabled', 'true');
  document.getElementById('submit-btn').setAttribute('disabled', 'true');
  document.getElementById('submit-btn').innerText = 'Submit Verified Complaint';
  document.getElementById('map-helper').innerText = 'Use current GPS or pick a point on the map if the photo has no geotag.';
  
  if (mainMap) {
    document.getElementById('map-container').style.display = 'none';
    mainMap.remove();
    mainMap = null;
    mainMarker = null;
  }
}

/**
 * Tracks a specific complaint ID by querying the backend API
 */
async function trackComplaint(targetId = null) {
  const searchId = targetId || document.getElementById('search-id-input').value.trim();
  if (!searchId) {
    alert('Please enter a Complaint Reference ID.');
    return;
  }

  try {
    const response = await fetch(`/api/complaints/${searchId}`);
    if (!response.ok) {
      throw new Error('Complaint ID not found.');
    }
    const complaint = await response.json();
    displayTrackingInfo(complaint);
  } catch (err) {
    alert(err.message);
    document.getElementById('tracking-panel').style.display = 'none';
  }
}

/**
 * Updates elements in the workflow timeline steps
 */
function displayTrackingInfo(complaint) {
  const panel = document.getElementById('tracking-panel');
  panel.style.display = 'block';

  // Details update
  document.getElementById('track-title-id').innerText = `Complaint ID: ${complaint.id}`;
  
  const statusBadge = document.getElementById('track-status-badge');
  statusBadge.innerText = complaint.status;
  if (complaint.status === 'Emailed to PIU') {
    statusBadge.className = 'badge badge-success';
  } else if (complaint.status === 'Flagged for Review') {
    statusBadge.className = 'badge badge-danger';
  } else {
    statusBadge.className = 'badge badge-warning';
  }

  document.getElementById('track-image').src = complaint.imageUrl;
  document.getElementById('track-val-class').innerText = complaint.modelResults.displayName || complaint.category;
  document.getElementById('track-val-confidence').innerText = `${complaint.modelResults.confidence}%`;
  
  const gpsCoords = complaint.metadataResults.details.gpsCoords;
  if (gpsCoords) {
    document.getElementById('track-val-gps').innerText = `${gpsCoords.latitude.toFixed(6)}, ${gpsCoords.longitude.toFixed(6)}`;
    document.getElementById('track-val-gps').className = 'info-value gps-link';
  } else {
    document.getElementById('track-val-gps').innerText = 'Missing Geotags';
    document.getElementById('track-val-gps').className = 'info-value';
  }

  document.getElementById('track-val-piu').innerText = complaint.piuEmailMapping.name;
  document.getElementById('dispatch-piu-desc').innerText = `Emailed complaint details to Project Director at: ${complaint.piuEmailMapping.email}`;
  
  // PDF and Email link bindings
  document.getElementById('btn-download-pdf').href = complaint.pdfUrl;
  
  if (complaint.emailDispatch && complaint.emailDispatch.previewFile) {
    document.getElementById('btn-view-email').style.display = 'inline-flex';
    document.getElementById('btn-view-email').href = complaint.emailDispatch.previewFile;
  } else {
    document.getElementById('btn-view-email').style.display = 'none';
  }

  // Display flags/warnings
  const flagsContainer = document.getElementById('track-flags-container');
  flagsContainer.innerHTML = '';
  if (complaint.metadataResults.flags.length > 0) {
    const flagsDiv = document.createElement('div');
    flagsDiv.className = 'flags-list';
    flagsDiv.innerHTML = `
      <div class="flags-list-title">⚠️ Integrity Warnings Flagged:</div>
      <ul>
        ${complaint.metadataResults.flags.map(f => `<li>${f}</li>`).join('')}
      </ul>
    `;
    flagsContainer.appendChild(flagsDiv);
  }

  // Update Stepper Timeline CSS
  resetTimelineSteps();
  
  // Step 1: Registered (Always completed)
  setStepStatus('step-submitted', 'completed', complaint.createdAt);
  
  // Step 2: Integrity checks
  if (complaint.metadataResults.isValid) {
    setStepStatus('step-verified', 'completed', complaint.createdAt);
  } else {
    setStepStatus('step-verified', 'flagged', complaint.createdAt);
  }

  // Step 3: Model scan
  if (complaint.modelResults && complaint.modelResults.detected) {
    setStepStatus('step-ai', 'completed', complaint.createdAt);
  } else {
    setStepStatus('step-ai', 'completed', complaint.createdAt); // completed but might show custom descriptions
  }

  // Step 4: PDF Created
  if (complaint.pdfUrl) {
    setStepStatus('step-pdf', 'completed', complaint.createdAt);
  }

  // Step 5: Emailed
  if (complaint.status === 'Emailed to PIU') {
    setStepStatus('step-emailed', 'completed', complaint.createdAt);
  } else if (complaint.status === 'Flagged for Review') {
    setStepStatus('step-emailed', 'flagged', complaint.createdAt);
    document.getElementById('dispatch-piu-desc').innerText = 'Routing suspended: Complaint quarantined due to failed originality audits.';
  } else {
    setStepStatus('step-emailed', 'active');
  }
}

function resetTimelineSteps() {
  const steps = ['step-submitted', 'step-verified', 'step-ai', 'step-pdf', 'step-emailed'];
  steps.forEach(stepId => {
    const el = document.getElementById(stepId);
    el.className = 'timeline-step';
    document.getElementById(`${stepId}-time`).innerText = '--';
  });
}

function setStepStatus(stepId, statusClass, dateStr = null) {
  const el = document.getElementById(stepId);
  el.classList.add(statusClass);
  if (dateStr) {
    document.getElementById(`${stepId}-time`).innerText = new Date(dateStr).toLocaleString();
  }
}

/**
 * Click handler for location link in Tracking Panel: opens coordinates on Report Map tab
 */
function showTrackedOnMap() {
  const coordsText = document.getElementById('track-val-gps').innerText;
  if (coordsText === 'Missing Geotags') return;
  
  const parts = coordsText.split(',');
  const lat = parseFloat(parts[0]);
  const lon = parseFloat(parts[1]);

  switchTab('report');
  initLeafletMap(lat, lon);
}

/**
 * Queries statistics and populates the Admin oversight dashboards
 */
async function loadAdminData() {
  try {
    // 1. Stats Counter
    const statsRes = await fetch('/api/complaints/stats');
    if (statsRes.ok) {
      const stats = await statsRes.ok ? await statsRes.json() : null;
      if (stats) {
        document.getElementById('stat-total').innerText = stats.total;
        document.getElementById('stat-verified').innerText = stats.verified;
        document.getElementById('stat-flagged').innerText = stats.flagged;
        document.getElementById('stat-routed').innerText = stats.verified; // Equals emailed dispatches
      }
    }

    // 2. Complaints Table List
    const listRes = await fetch('/api/complaints');
    if (listRes.ok) {
      const list = await listRes.json();
      populateComplaintsTable(list);
    }

    // 3. Geospatial Heatmap
    const geoRes = await fetch('/api/complaints/geo');
    if (geoRes.ok) {
      heatmapComplaintData = await geoRes.json();
      setupHeatmapFilters(heatmapComplaintData);
      renderHeatmap(heatmapComplaintData);
    }

    // 4. Email Routing Activity Logs
    const emailRes = await fetch('/api/email-activity');
    if (emailRes.ok) {
      const emails = await emailRes.json();
      populateEmailsTable(emails);
    }

  } catch (err) {
    console.error('Failed to load admin panel data:', err.message);
  }
}

async function loadRoadContext(lat, lon) {
  latestRoadContext = null;
  document.getElementById('auto-road-name').innerText = 'Resolving...';
  document.getElementById('auto-road-type').innerText = 'Resolving...';
  document.getElementById('auto-authority').innerText = 'Resolving...';

  try {
    const response = await fetch(`/api/location/context?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
    const context = await response.json();
    if (!response.ok) throw new Error(context.error || 'Location lookup failed');
    latestRoadContext = context;

    const stateSelect = document.getElementById('state-select');
    const districtSelect = document.getElementById('district-select');
    const areaSelect = document.getElementById('area-select');
    const roadNameSelect = document.getElementById('road-name-select');
    const roadTypeSelect = document.getElementById('road-type-select');

    if (context.state) ensureSelectValue(stateSelect, context.state);
    const cityDistrict = context.city || context.district;
    if (cityDistrict) ensureSelectValue(districtSelect, cityDistrict);
    if (context.area) ensureSelectValue(areaSelect, context.area);
    if (context.roadName) ensureSelectValue(roadNameSelect, context.roadName);
    if (context.roadType) ensureSelectValue(roadTypeSelect, context.roadType);

    updateRoadContextPreview();
    document.getElementById('auto-road-name').innerText = context.roadName || context.area || 'Unnamed road';
    document.getElementById('auto-road-type').innerText = context.roadType || '--';
    document.getElementById('auto-authority').innerText = context.authority ? context.authority.name : '--';
  } catch (err) {
    console.warn('Road context lookup failed:', err.message);
    document.getElementById('auto-road-name').innerText = 'Unavailable';
    document.getElementById('auto-road-type').innerText = '--';
    document.getElementById('auto-authority').innerText = '--';
  }
}

function setupHeatmapFilters(complaints) {
  const categorySelect = document.getElementById('heatmap-category-filter');
  if (!categorySelect) return;

  const selectedValue = categorySelect.value || 'all';
  const categories = [...new Set(complaints.map(c => c.category).filter(Boolean))].sort();
  categorySelect.innerHTML = '<option value="all">All categories</option>';

  categories.forEach(category => {
    const option = document.createElement('option');
    option.value = category;
    option.innerText = formatCategoryLabel(category);
    categorySelect.appendChild(option);
  });

  categorySelect.value = categories.includes(selectedValue) ? selectedValue : 'all';
}

function getFilteredHeatmapComplaints() {
  const category = document.getElementById('heatmap-category-filter').value;
  const severity = document.getElementById('heatmap-severity-filter').value;
  const days = document.getElementById('heatmap-time-filter').value;
  const since = days === 'all' ? null : Date.now() - Number(days) * 24 * 60 * 60 * 1000;

  return heatmapComplaintData.filter(c => {
    const timestamp = c.timestamp ? new Date(c.timestamp).getTime() : null;
    const matchesCategory = category === 'all' || c.category === category;
    const matchesSeverity = severity === 'all' || c.severity === severity;
    const matchesTime = !since || (timestamp && timestamp >= since);
    return matchesCategory && matchesSeverity && matchesTime;
  });
}

function applyHeatmapFilters() {
  renderHeatmap(getFilteredHeatmapComplaints());
}

function initHeatmapMap(complaints) {
  if (heatmapMap) return;

  const first = complaints[0];
  const initialCenter = first ? [first.latitude, first.longitude] : [22.9734, 78.6569];
  const initialZoom = first ? 8 : 5;

  heatmapMap = L.map('admin-heatmap').setView(initialCenter, initialZoom);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '© OpenStreetMap contributing developers'
  }).addTo(heatmapMap);

  heatmapMarkersLayer = L.layerGroup().addTo(heatmapMap);
}

function renderHeatmap(complaints) {
  const countEl = document.getElementById('heatmap-visible-count');
  if (countEl) countEl.innerText = complaints.length;

  initHeatmapMap(complaints);
  if (!heatmapMap || !heatmapMarkersLayer) return;

  if (heatmapLayer) {
    heatmapMap.removeLayer(heatmapLayer);
    heatmapLayer = null;
  }
  heatmapMarkersLayer.clearLayers();

  if (complaints.length === 0) {
    heatmapMap.setView([22.9734, 78.6569], 5);
    return;
  }

  const heatPoints = complaints.map(c => [c.latitude, c.longitude, getSeverityWeight(c.severity)]);

  if (L.heatLayer) {
    heatmapLayer = L.heatLayer(heatPoints, {
      radius: 28,
      blur: 18,
      maxZoom: 12,
      gradient: {
        0.2: '#10b981',
        0.55: '#f59e0b',
        1.0: '#ef4444'
      }
    }).addTo(heatmapMap);
  } else {
    heatPoints.forEach(point => {
      L.circle([point[0], point[1]], {
        radius: 900 + point[2] * 1800,
        color: '#ef4444',
        weight: 1,
        fillColor: '#f59e0b',
        fillOpacity: 0.22
      }).addTo(heatmapMarkersLayer);
    });
  }

  complaints.forEach(c => {
    const popup = `
      <strong>${c.id}</strong><br>
      ${formatCategoryLabel(c.category)} (${c.severity})<br>
      Confidence: ${c.confidence ? `${c.confidence}%` : 'N/A'}<br>
      Status: ${c.status || 'Submitted'}<br>
      PIU: ${c.piuName || 'Unassigned'}<br>
      Filed: ${c.timestamp ? new Date(c.timestamp).toLocaleString() : 'Unknown'}<br>
      <button class="popup-link-btn" onclick="openAdminTrack('${c.id}')">Open complaint</button>
    `;
    L.marker([c.latitude, c.longitude]).addTo(heatmapMarkersLayer).bindPopup(popup);
  });

  const bounds = L.latLngBounds(complaints.map(c => [c.latitude, c.longitude]));
  heatmapMap.fitBounds(bounds, { padding: [30, 30], maxZoom: 13 });
  setTimeout(() => heatmapMap.invalidateSize(), 100);
}

/**
 * Renders the recent complaint rows in Admin panel
 */
function populateComplaintsTable(complaints) {
  const tbody = document.getElementById('admin-complaints-table-body');
  tbody.innerHTML = '';

  if (complaints.length === 0) {
    tbody.innerHTML = '<tr><td colspan="7" style="text-align: center; color: var(--text-secondary);">No complaint submissions found.</td></tr>';
    return;
  }

  complaints.forEach(c => {
    const gps = c.metadataResults.details.gpsCoords;
    const gpsStr = gps ? `${gps.latitude.toFixed(4)}, ${gps.longitude.toFixed(4)}` : 'Manual Entry';
    
    let badgeClass = 'badge badge-success';
    if (c.status === 'Flagged for Review') badgeClass = 'badge badge-danger';
    else if (c.status === 'Submitted') badgeClass = 'badge badge-warning';

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${c.id}</strong></td>
      <td>${c.modelResults.displayName || c.category}</td>
      <td>${gpsStr}</td>
      <td>
        <span class="badge ${c.metadataResults.score >= 70 ? 'badge-success' : (c.metadataResults.score >= 50 ? 'badge-warning' : 'badge-danger')}">
          ${c.metadataResults.score}%
        </span>
      </td>
      <td><span class="${badgeClass}">${c.status}</span></td>
      <td>${new Date(c.createdAt).toLocaleDateString()}</td>
      <td>
        <button class="btn table-btn" onclick="openAdminTrack('${c.id}')">Audit</button>
        <a href="${c.pdfUrl}" target="_blank" class="btn btn-secondary table-btn" style="display:inline-flex; width:auto; padding:0.35rem 0.5rem; margin-left:0.25rem;">PDF</a>
      </td>
    `;
    tbody.appendChild(tr);
  });
}

function openAdminTrack(complaintId) {
  switchTab('track');
  document.getElementById('search-id-input').value = complaintId;
  trackComplaint(complaintId);
}

/**
 * Renders active email dispatches in Admin panel
 */
function populateEmailsTable(emails) {
  const tbody = document.getElementById('admin-email-logs-table-body');
  tbody.innerHTML = '';

  if (emails.length === 0) {
    tbody.innerHTML = '<tr><td colspan="6" style="text-align: center; color: var(--text-secondary);">No routing activity logs recorded.</td></tr>';
    return;
  }

  emails.forEach(e => {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td><strong>${e.id}</strong></td>
      <td>${e.piuName}</td>
      <td><code>${e.piuEmail}</code></td>
      <td><span style="font-size: 0.85rem;">${e.subject}</span></td>
      <td>${new Date(e.sentAt).toLocaleTimeString()}</td>
      <td>
        <a href="/sent_emails/${e.previewFile}" target="_blank" class="btn btn-secondary table-btn" style="display:inline-flex; width:auto; padding:0.35rem 0.75rem;">View</a>
      </td>
    `;
    tbody.appendChild(tr);
  });
}
