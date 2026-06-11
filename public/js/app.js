// Global States
let selectedFile = null;
let clientGpsCoords = null; // Coordinates extracted from photo EXIF
let browserGpsCoords = null; // Browser geolocation coordinates
let mainMap = null;
let mainMarker = null;
let currentLanguage = 'en';

// Initialize components when page loads
document.addEventListener('DOMContentLoaded', () => {
  // Capture user's browser coordinates for originality comparison
  requestBrowserLocation();
  
  // Set up Drag and Drop event listeners
  const dropZone = document.getElementById('drop-zone');
  
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('dragover');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('dragover');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      handleFile(files[0]);
    }
  }, false);

  // Poll complaints list if admin tab loaded
  loadAdminData();

  // Initialize Language Switcher
  changeLanguage('en');
});

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
        console.log('Browser coordinates captured:', browserGpsCoords);
      },
      (error) => {
        console.warn('Browser location access denied or unavailable:', error.message);
      },
      { enableHighAccuracy: true, timeout: 5000 }
    );
  }
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
  }
}

/**
 * Handles file input click redirect
 */
function triggerFileInput() {
  document.getElementById('media-file').click();
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

  selectedFile = file;
  document.getElementById('submit-btn').removeAttribute('disabled');
  
  // Show file details in upload zone
  const dropZone = document.getElementById('drop-zone');
  dropZone.innerHTML = `
    <div class="upload-icon" style="color: var(--success);">✓</div>
    <p class="upload-text-main">${file.name}</p>
    <p class="upload-text-sub">Size: ${(file.size / (1024 * 1024)).toFixed(2)} MB - Click to change photo</p>
  `;

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

  if (mainMarker) {
    mainMarker.remove();
    mainMarker = null;
  }

  if (!tags) {
    badge.className = 'badge badge-danger';
    badge.innerText = 'Suspicious: Missing EXIF';
    softwareEl.innerText = 'No metadata (Cleaned or screenshotted)';
    return;
  }

  // 1. Coordinates
  if (tags.GPSLatitude && tags.GPSLongitude) {
    const lat = parseFloat(tags.GPSLatitude.description);
    const lon = parseFloat(tags.GPSLongitude.description);
    
    if (!isNaN(lat) && !isNaN(lon)) {
      clientGpsCoords = { latitude: lat, longitude: lon };
      coordsEl.innerText = `${lat.toFixed(6)}, ${lon.toFixed(6)}`;
      badge.className = 'badge badge-success';
      badge.innerText = 'GPS Tagged';
      
      // Pin on Leaflet Map
      initLeafletMap(lat, lon);
    }
  } else {
    badge.className = 'badge badge-warning';
    badge.innerText = 'Warning: Missing GPS';
    coordsEl.innerHTML = '<span style="color: var(--danger);">Not found</span>';
  }

  // 2. Taken Time
  const timeTag = tags.DateTimeOriginal || tags.DateTime || tags.DateTimeDigitized;
  if (timeTag) {
    timeEl.innerText = timeTag.description || timeTag.value;
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
function initLeafletMap(lat, lon) {
  const mapContainer = document.getElementById('map-container');
  mapContainer.style.display = 'block';

  if (!mainMap) {
    mainMap = L.map('map-container').setView([lat, lon], 14);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributing developers'
    }).addTo(mainMap);
  } else {
    mainMap.setView([lat, lon], 14);
  }

  // Add marker pinpoint
  mainMarker = L.marker([lat, lon]).addTo(mainMap)
    .bindPopup('Captured Incident Location')
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
  
  // Attach user browser coordinates if gathered
  if (browserGpsCoords) {
    formData.append('browserLocation', JSON.stringify(browserGpsCoords));
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
  
  const dropZone = document.getElementById('drop-zone');
  dropZone.innerHTML = `
    <div class="upload-icon">↑</div>
    <p class="upload-text-main">Drag & drop your photo here</p>
    <p class="upload-text-sub">or click to browse from device (JPEG/PNG, max 10MB)</p>
  `;
  
  document.getElementById('image-preview-frame').style.display = 'none';
  document.getElementById('preview-img-element').src = '';
  document.getElementById('analysis-badge').className = 'badge badge-neutral';
  document.getElementById('analysis-badge').innerText = 'No media selected';
  document.getElementById('meta-coords').innerText = '--';
  document.getElementById('meta-time').innerText = '--';
  document.getElementById('meta-device').innerText = '--';
  document.getElementById('meta-software').innerText = '--';
  document.getElementById('submit-btn').setAttribute('disabled', 'true');
  document.getElementById('submit-btn').innerText = 'Submit Verified Complaint';
  
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

  // Render Contractor Ledger Details
  const contractorSection = document.getElementById('track-contractor-section');
  if (complaint.contractorDetails) {
    document.getElementById('track-val-contractor').innerText = complaint.contractorDetails.contractorName;
    document.getElementById('track-val-budget').innerText = `${complaint.contractorDetails.allocatedBudgetWords} (INR ${complaint.contractorDetails.allocatedBudgetRupees})`;
    document.getElementById('track-val-period').innerText = complaint.contractorDetails.maintenancePeriod;
    document.getElementById('track-val-contract-status').innerText = complaint.contractorDetails.status;
    contractorSection.style.display = 'block';
  } else {
    contractorSection.style.display = 'none';
  }

  // Render Hazard Severity Gauge
  const hazardSection = document.getElementById('track-hazard-section');
  if (complaint.hazardResults) {
    document.getElementById('track-val-severity-score').innerText = `${complaint.hazardResults.score} / 100`;
    
    const levelEl = document.getElementById('track-val-severity-level');
    levelEl.innerText = complaint.hazardResults.level.toUpperCase();
    
    // Clean old severity classes
    levelEl.className = 'info-value';
    levelEl.classList.add(`severity-${complaint.hazardResults.level.toLowerCase()}`);
    
    hazardSection.style.display = 'block';
  } else {
    hazardSection.style.display = 'none';
  }
  
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

    // 3. Email Routing Activity Logs
    const emailRes = await fetch('/api/email-activity');
    if (emailRes.ok) {
      const emails = await emailRes.json();
      populateEmailsTable(emails);
    }

  } catch (err) {
    console.error('Failed to load admin panel data:', err.message);
  }
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

/**
 * Handles client-side multilingual translation toggling
 */
function changeLanguage(lang) {
  currentLanguage = lang;
  if (!window.translations || !window.translations[lang]) return;

  const dictionary = window.translations[lang];

  // Update all elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    if (dictionary[key]) {
      if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
        el.placeholder = dictionary[key];
      } else {
        el.innerText = dictionary[key];
      }
    }
  });

  // Specifically handle placeholder fields that might not be static or need specific translation
  const descInput = document.getElementById('description-input');
  if (descInput && dictionary.placeholder_details) {
    descInput.placeholder = dictionary.placeholder_details;
  }
  
  const searchInput = document.getElementById('search-id-input');
  if (searchInput && dictionary.placeholder_search) {
    searchInput.placeholder = dictionary.placeholder_search;
  }
}
