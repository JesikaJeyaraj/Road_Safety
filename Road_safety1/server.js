const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

// Import our custom services
const { verifyOriginality } = require('./services/metadataService');
const { analyzeRoadCondition } = require('./services/modelService');
const { createComplaintPDF } = require('./services/pdfService');
const { routeComplaintEmail, findNearestPIU } = require('./services/emailService');
const { resolveRoadContext, determineAuthority } = require('./services/locationService');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// Setup directories
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const PDF_DIR = path.join(PUBLIC_DIR, 'pdfs');
const DATA_FILE = path.join(__dirname, 'data', 'complaints.json');
const DATA_DIR = path.dirname(DATA_FILE);
const SENT_EMAILS_DIR = path.join(__dirname, 'sent_emails');

[PUBLIC_DIR, UPLOAD_DIR, PDF_DIR, DATA_DIR, SENT_EMAILS_DIR].forEach(dir => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

// Configure Multer for in-memory uploads (so we can parse EXIF before saving)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB max limit
});

// Middleware
app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowedOrigins = CORS_ORIGIN.split(',').map(item => item.trim());
  const allowOrigin = CORS_ORIGIN === '*'
    ? '*'
    : (origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0]);

  res.header('Access-Control-Allow-Origin', allowOrigin);
  res.header('Vary', 'Origin');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// Allow serving email logs in browser for testing/inspections
app.use('/sent_emails', express.static(SENT_EMAILS_DIR));

function getComplaintCoordinates(metadataResults, browserGeo) {
  if (metadataResults.details.gpsCoords) {
    return metadataResults.details.gpsCoords;
  }
  if (browserGeo && browserGeo.latitude && browserGeo.longitude) {
    return {
      latitude: Number(browserGeo.latitude),
      longitude: Number(browserGeo.longitude)
    };
  }
  return null;
}

function buildModelEnrichment(modelResults) {
  const isPoor = modelResults.defectCategory === 'poor_condition' || modelResults.detected;
  return {
    suggestedCategory: isPoor ? 'pothole' : 'other',
    suggestedSeverity: modelResults.severityLevel || modelResults.severity || (isPoor ? 'High' : 'Low'),
    estimatedDimensions: isPoor ? 'Visible road surface deterioration; field measurement required' : 'No measurable defect detected',
    urgencyLevel: isPoor ? 'High' : 'Low',
    suggestedDescription: isPoor
      ? `AI analysis classified the road surface as ${modelResults.displayName} with ${modelResults.confidence}% confidence. Please inspect and repair this segment.`
      : `AI analysis classified the road surface as ${modelResults.displayName} with ${modelResults.confidence}% confidence. No urgent pavement defect is visible.`
  };
}

const ROAD_DETAIL_OPTIONS = {
  states: ['Tamil Nadu'],
  districts: {
    'Tamil Nadu': ['Chennai', 'Chengalpattu', 'Kancheepuram', 'Tiruvallur']
  },
  areas: {
    Chennai: ['Guindy', 'Saidapet', 'Tambaram', 'Pallavaram', 'T. Nagar']
  },
  roads: {
    Guindy: [
      {
        name: 'Grand Southern Trunk Road',
        roadType: 'National Highway',
        highwayNo: 'NH-32'
      },
      {
        name: 'Anna Salai',
        roadType: 'Urban Road',
        highwayNo: ''
      }
    ]
  },
  roadTypes: ['National Highway', 'State Highway', 'District Road', 'Urban Road', 'Rural Road', 'Service Road'],
  highwayNumbers: ['NH-32', 'NH-45', 'NH-48', 'SH-49', 'SH-113']
};

function getLocalNetworkUrls(port) {
  const urls = [];
  const interfaces = os.networkInterfaces();

  Object.values(interfaces).forEach(entries => {
    (entries || []).forEach(details => {
      if (details.family === 'IPv4' && !details.internal) {
        urls.push(`http://${details.address}:${port}`);
      }
    });
  });

  return urls;
}

/**
 * Helper to read complaints database
 */
function readComplaints() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      fs.writeFileSync(DATA_FILE, '[]');
      return [];
    }
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return JSON.parse(data || '[]');
  } catch (err) {
    console.error('Error reading complaints database:', err.message);
    return [];
  }
}

/**
 * Helper to write complaints database
 */
function writeComplaints(data) {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
  } catch (err) {
    console.error('Error writing complaints database:', err.message);
  }
}

/**
 * Endpoint: POST /api/model/analyze
 * Runs AI classification before final complaint submission for user confirmation.
 */
app.post('/api/model/analyze', upload.single('image'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    const modelResults = await analyzeRoadCondition(req.file.buffer, req.file.originalname);
    res.json({
      modelResults,
      enrichment: buildModelEnrichment(modelResults)
    });
  } catch (err) {
    console.error('Error running AI enrichment:', err.message);
    res.status(500).json({ error: 'AI enrichment failed', message: err.message });
  }
});

/**
 * Endpoint: GET /api/location/context?lat=&lon=
 * Resolves road context and responsible authority for a coordinate pair.
 */
app.get('/api/location/context', async (req, res) => {
  try {
    const latitude = Number(req.query.lat);
    const longitude = Number(req.query.lon);

    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      return res.status(400).json({ error: 'Valid lat and lon query parameters are required' });
    }

    res.json(await resolveRoadContext(latitude, longitude));
  } catch (err) {
    console.error('Error resolving location context:', err.message);
    res.status(500).json({ error: 'Unable to resolve location context' });
  }
});

/**
 * Endpoint: GET /api/location/options
 * Returns selectable road detail values for the complaint form.
 */
app.get('/api/location/options', (req, res) => {
  res.json(ROAD_DETAIL_OPTIONS);
});

/**
 * Endpoint: POST /api/complaints
 * Submits a new road complaint, executes originality check, model parsing, PDF generation, and routes emails.
 */
app.post('/api/complaints', upload.single('image'), async (req, res) => {
  try {
    const {
      category,
      description,
      browserLocation,
      landmark,
      directionOfTravel,
      estimatedDimensions,
      trafficImpact,
      safetyRisk,
      state,
      district,
      area,
      roadName,
      roadType,
      highwayNo,
      userLatitude,
      userLongitude
    } = req.body;
    
    if (!req.file) {
      return res.status(400).json({ error: 'No image file uploaded' });
    }

    if (!category || !description) {
      return res.status(400).json({ error: 'Category and description are required' });
    }

    // Parse browser GPS if provided
    let browserGeo = null;
    if (browserLocation) {
      try {
        browserGeo = JSON.parse(browserLocation);
      } catch (e) {
        console.warn('Unable to parse browser location:', browserLocation);
      }
    }

    if (!browserGeo && userLatitude && userLongitude) {
      browserGeo = {
        latitude: Number(userLatitude),
        longitude: Number(userLongitude)
      };
    }

    const complaintsDb = readComplaints();
    const imageBuffer = req.file.buffer;

    // 1. Run Originality & EXIF metadata Check
    console.log('Running Originality Check for uploaded file...');
    const metadataResults = await verifyOriginality(imageBuffer, browserGeo, complaintsDb);
    
    if (metadataResults.status === 'DUPLICATE_DETECTED') {
      return res.status(400).json({
        error: 'Duplicate Complaint',
        message: 'This photo has already been uploaded for a road safety report. To prevent spam, duplicate submissions are rejected.'
      });
    }

    // 2. Run Image Classification Model
    console.log('Running AI Model Classification...');
    const modelResults = await analyzeRoadCondition(imageBuffer, req.file.originalname);
    const aiEnrichment = buildModelEnrichment(modelResults);

    // Generate unique complaint ID (NHAI-YYYY-UUID)
    const year = new Date().getFullYear();
    const complaintId = `NHAI-${year}-${uuidv4().substring(0, 8).toUpperCase()}`;

    // 3. Save the image to the public upload directory
    const imageExt = path.extname(req.file.originalname) || '.jpg';
    const imageFileName = `${complaintId}${imageExt}`;
    const savedImagePath = path.join(UPLOAD_DIR, imageFileName);
    fs.writeFileSync(savedImagePath, imageBuffer);
    const imageUrl = `/uploads/${imageFileName}`;

    // 4. Resolve closest NHAI PIU unit coordinates
    const gpsCoords = metadataResults.details.gpsCoords;
    const complaintCoords = getComplaintCoordinates(metadataResults, browserGeo);
    const roadContext = complaintCoords
      ? await resolveRoadContext(complaintCoords.latitude, complaintCoords.longitude)
      : await resolveRoadContext(null, null);
    const resolvedRoadContext = {
      ...roadContext,
      state: state || roadContext.state,
      district: district || roadContext.district,
      area: area || roadContext.area,
      roadName: roadName || roadContext.roadName,
      roadType: roadType || roadContext.roadType,
      highwayNo: highwayNo || roadContext.highwayNo || ''
    };
    const piuEmailMapping = findNearestPIU(
      complaintCoords ? complaintCoords.latitude : null,
      complaintCoords ? complaintCoords.longitude : null
    );
    const overrideAuthority = determineAuthority(
      resolvedRoadContext.roadType,
      complaintCoords ? complaintCoords.latitude : null,
      complaintCoords ? complaintCoords.longitude : null
    );
    const responsibleAuthority = overrideAuthority || roadContext.authority || {
      type: 'NHAI PIU',
      name: piuEmailMapping.name,
      email: piuEmailMapping.email,
      distanceKm: piuEmailMapping.distanceKm || null
    };

    // Create the full complaint structure
    const newComplaint = {
      id: complaintId,
      category: category,
      description: description,
      imageUrl: imageUrl,
      imagePath: savedImagePath,
      sha256: metadataResults.details.sha256,
      fingerprint: metadataResults.details.fingerprint,
      imageMetadata: {
        gpsCoords: metadataResults.details.gpsCoords,
        captureTimestamp: metadataResults.details.photoTime,
        device: metadataResults.details.device,
        orientation: metadataResults.details.orientation,
        resolution: metadataResults.details.resolution,
        fileSizeBytes: metadataResults.details.fileSizeBytes,
        fileSizeMb: metadataResults.details.fileSizeMb
      },
      authenticityScore: metadataResults.score,
      verificationFlags: metadataResults.flags,
      metadataResults: {
        isValid: metadataResults.isValid,
        status: metadataResults.status,
        score: metadataResults.score,
        details: {
          gpsCoords: metadataResults.details.gpsCoords,
          photoTime: metadataResults.details.photoTime,
          device: metadataResults.details.device,
          softwareEdited: metadataResults.details.softwareEdited,
          timeVarianceHours: metadataResults.details.timeVarianceHours,
          browserDistanceKm: metadataResults.details.browserDistanceKm,
          orientation: metadataResults.details.orientation,
          resolution: metadataResults.details.resolution,
          fileSizeBytes: metadataResults.details.fileSizeBytes,
          fileSizeMb: metadataResults.details.fileSizeMb,
          visualSimilarityMatch: metadataResults.details.visualSimilarityMatch
        },
        flags: metadataResults.flags
      },
      modelResults: modelResults,
      aiEnrichment,
      roadContext: resolvedRoadContext,
      roadName: resolvedRoadContext.roadName,
      roadType: resolvedRoadContext.roadType,
      highwayNo: resolvedRoadContext.highwayNo,
      authority: responsibleAuthority,
      area: resolvedRoadContext.area,
      district: resolvedRoadContext.district,
      state: resolvedRoadContext.state,
      landmark: landmark || '',
      directionOfTravel: directionOfTravel || '',
      severity: modelResults.severityLevel || modelResults.severity || aiEnrichment.suggestedSeverity,
      estimatedDimensions: estimatedDimensions || aiEnrichment.estimatedDimensions,
      trafficImpact: trafficImpact || '',
      safetyRisk: safetyRisk || '',
      piuEmailMapping: {
        name: piuEmailMapping.name,
        email: piuEmailMapping.email,
        distanceKm: piuEmailMapping.distanceKm || null
      },
      status: metadataResults.isValid ? 'Emailed to PIU' : 'Flagged for Review',
      routingStatus: metadataResults.isValid ? `Routed to ${responsibleAuthority.name}` : 'Flagged for manual review',
      createdAt: new Date().toISOString()
    };

    // 5. Generate official Complaint PDF
    console.log(`Generating PDF complaint letter for ID: ${complaintId}...`);
    const pdfFileName = `${complaintId}.pdf`;
    const pdfPath = path.join(PDF_DIR, pdfFileName);
    await createComplaintPDF(newComplaint, savedImagePath, pdfPath);
    newComplaint.pdfUrl = `/pdfs/${pdfFileName}`;
    newComplaint.pdfPath = pdfPath;

    // 6. Route email to the closest PIU with the PDF attached
    console.log(`Routing email notification to ${piuEmailMapping.name}...`);
    const emailDispatch = await routeComplaintEmail(newComplaint, pdfPath);
    newComplaint.emailDispatch = emailDispatch;

    // Save to local DB
    complaintsDb.unshift(newComplaint);
    writeComplaints(complaintsDb);

    console.log(`Successfully completed filing process for ${complaintId}`);

    res.status(201).json({
      success: true,
      message: 'Complaint submitted and verified successfully.',
      complaint: {
        id: newComplaint.id,
        status: newComplaint.status,
        imageUrl: newComplaint.imageUrl,
        pdfUrl: newComplaint.pdfUrl,
        metadataResults: newComplaint.metadataResults,
        modelResults: newComplaint.modelResults,
        piuEmailMapping: newComplaint.piuEmailMapping,
        emailDispatch: newComplaint.emailDispatch
      }
    });

  } catch (err) {
    console.error('Server error handling complaint:', err);
    res.status(500).json({ error: 'Internal Server Error', message: err.message });
  }
});

/**
 * Endpoint: GET /api/complaints
 * Returns list of all filed complaints (for search lists and admin tables)
 */
app.get('/api/complaints', (req, res) => {
  const complaints = readComplaints();
  res.json(complaints);
});

/**
 * Endpoint: GET /api/complaints/stats
 * Aggregates statistics for the dashboard
 */
app.get('/api/complaints/stats', (req, res) => {
  const complaints = readComplaints();
  
  const stats = {
    total: complaints.length,
    verified: complaints.filter(c => c.metadataResults.isValid).length,
    flagged: complaints.filter(c => !c.metadataResults.isValid).length,
    categories: {},
    piuDistribution: {}
  };

  complaints.forEach(c => {
    const cat = c.category;
    stats.categories[cat] = (stats.categories[cat] || 0) + 1;

    const piu = c.piuEmailMapping.name;
    stats.piuDistribution[piu] = (stats.piuDistribution[piu] || 0) + 1;
  });

  res.json(stats);
});

/**
 * Endpoint: GET /api/complaints/geo
 * Returns normalized complaint location records for heatmap dashboards.
 */
app.get('/api/complaints/geo', (req, res) => {
  try {
    const geoComplaints = readComplaints()
      .map(c => {
        const gps = c.metadataResults && c.metadataResults.details
          ? c.metadataResults.details.gpsCoords
          : null;

        if (!gps || !Number.isFinite(Number(gps.latitude)) || !Number.isFinite(Number(gps.longitude))) {
          return null;
        }

        const model = c.modelResults || {};
        const category = model.defectCategory || model.primaryClass || c.category || 'other';
        const severity = model.severityLevel || model.severity || 'Medium';

        return {
          id: c.id,
          latitude: Number(gps.latitude),
          longitude: Number(gps.longitude),
          category,
          displayName: model.displayName || category,
          severity,
          confidence: model.confidenceScore || model.confidence || null,
          status: c.status,
          timestamp: c.createdAt,
          imageUrl: c.imageUrl,
          pdfUrl: c.pdfUrl,
          piuName: c.piuEmailMapping ? c.piuEmailMapping.name : 'Unassigned'
        };
      })
      .filter(Boolean);

    res.json(geoComplaints);
  } catch (err) {
    console.error('Error preparing geospatial complaint data:', err.message);
    res.status(500).json({ error: 'Unable to load geospatial complaint data' });
  }
});

/**
 * Endpoint: GET /api/complaints/:id
 * Retrieves a single complaint history record
 */
app.get('/api/complaints/:id', (req, res) => {
  const complaints = readComplaints();
  const complaint = complaints.find(c => c.id === req.params.id);
  
  if (!complaint) {
    return res.status(404).json({ error: 'Complaint not found' });
  }
  
  res.json(complaint);
});

/**
 * Endpoint: GET /api/email-activity
 * Retrieves the activity logs of sent email notifications
 */
app.get('/api/email-activity', (req, res) => {
  const logPath = path.join(SENT_EMAILS_DIR, 'activity_log.json');
  if (fs.existsSync(logPath)) {
    return res.json(JSON.parse(fs.readFileSync(logPath, 'utf8') || '[]'));
  }
  res.json([]);
});

// Serve frontend main page fallback for SPA routing
app.get('*', (req, res) => {
  res.sendFile(path.join(PUBLIC_DIR, 'index.html'));
});

// Start listening
app.listen(PORT, HOST, () => {
  const networkUrls = getLocalNetworkUrls(PORT);
  console.log(`================================================================`);
  console.log(` NHAI Safety Portal running in ${NODE_ENV} mode`);
  console.log(` Local URL:   http://localhost:${PORT}`);
  console.log(` Network URL: ${networkUrls[0] || `http://<local-ip-address>:${PORT}`}`);
  networkUrls.slice(1).forEach(url => console.log(`              ${url}`));
  console.log(` Admin Interface available, files & email previews mounted.`);
  console.log(`================================================================`);
});
