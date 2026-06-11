const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

// Import our custom services
const { verifyOriginality } = require('./services/metadataService');
const { analyzeRoadCondition } = require('./services/modelService');
const { createComplaintPDF } = require('./services/pdfService');
const { routeComplaintEmail, findNearestPIU } = require('./services/emailService');
const { findNearestContract, calculateHazardIndex } = require('./services/contractService');

const app = express();
const PORT = process.env.PORT || 3000;

// Setup directories
const PUBLIC_DIR = path.join(__dirname, 'public');
const UPLOAD_DIR = path.join(PUBLIC_DIR, 'uploads');
const PDF_DIR = path.join(PUBLIC_DIR, 'pdfs');
const DATA_FILE = path.join(__dirname, 'data', 'complaints.json');
const SENT_EMAILS_DIR = path.join(__dirname, 'sent_emails');

[PUBLIC_DIR, UPLOAD_DIR, PDF_DIR, SENT_EMAILS_DIR].forEach(dir => {
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
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(PUBLIC_DIR));

// Allow serving email logs in browser for testing/inspections
app.use('/sent_emails', express.static(SENT_EMAILS_DIR));

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
 * Endpoint: POST /api/complaints
 * Submits a new road complaint, executes originality check, model parsing, PDF generation, and routes emails.
 */
app.post('/api/complaints', upload.single('image'), async (req, res) => {
  try {
    const { category, description, browserLocation } = req.body;
    
    if (!req.file) {
      console.error('Upload route called without a parsed file', {
        body: req.body,
        headers: req.headers
      });
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

    // Generate unique complaint ID (NHAI-YYYY-UUID)
    const year = new Date().getFullYear();
    const complaintId = `NHAI-${year}-${uuidv4().substring(0, 8).toUpperCase()}`;

    // 3. Save the image to the public upload directory
    const imageExt = path.extname(req.file.originalname || '') || '.jpg';
    const imageFileName = `${complaintId}${imageExt}`;
    const savedImagePath = path.join(UPLOAD_DIR, imageFileName);
    fs.writeFileSync(savedImagePath, imageBuffer);
    const imageUrl = `/uploads/${imageFileName}`;

    // 4. Resolve closest NHAI PIU unit coordinates
    const gpsCoords = metadataResults.details.gpsCoords;
    const piuEmailMapping = findNearestPIU(
      gpsCoords ? gpsCoords.latitude : null,
      gpsCoords ? gpsCoords.longitude : null
    );

    // Resolve closest contractor & budget info
    const contractorDetails = findNearestContract(
      gpsCoords ? gpsCoords.latitude : null,
      gpsCoords ? gpsCoords.longitude : null
    );

    // Calculate dynamic Hazard index
    const hazardResults = calculateHazardIndex(category, description, metadataResults.score);

    // Create the full complaint structure
    const newComplaint = {
      id: complaintId,
      category: category,
      description: description,
      imageUrl: imageUrl,
      imagePath: savedImagePath,
      sha256: metadataResults.details.sha256,
      fingerprint: metadataResults.details.fingerprint,
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
          browserDistanceKm: metadataResults.details.browserDistanceKm
        },
        flags: metadataResults.flags
      },
      modelResults: modelResults,
      piuEmailMapping: {
        name: piuEmailMapping.name,
        email: piuEmailMapping.email,
        distanceKm: piuEmailMapping.distanceKm || null
      },
      contractorDetails: contractorDetails,
      hazardResults: hazardResults,
      status: metadataResults.isValid ? 'Emailed to PIU' : 'Flagged for Review',
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
        contractorDetails: newComplaint.contractorDetails,
        hazardResults: newComplaint.hazardResults,
        emailDispatch: newComplaint.emailDispatch
      }
    });

  } catch (err) {
    console.error('Server error handling complaint:', err);
    if (err.stack) {
      console.error(err.stack);
    }
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
app.listen(PORT, () => {
  console.log(`================================================================`);
  console.log(` NHAI Safety Portal backend running on http://localhost:${PORT}`);
  console.log(` Admin Interface available, files & email previews mounted.`);
  console.log(`================================================================`);
});
