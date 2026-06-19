# NHAI Citizen Safety & Road Defect Management Portal

An automated, full-stack platform designed to collect road defect complaints, run integrity & originality validations, classify pavement damage via computer vision, generate official complaint letters, and route notifications to regional NHAI Project Implementation Units (PIU).

---

## 🏗️ System Architecture & Workflow

```mermaid
graph TD
    A[Citizen Frontend UI] -->|1. Submit Photo & Form| B[Express Backend Server]
    B --> C[2. Originality Check Service]
    B --> D[3. AI Damage Classification]
    B --> E[4. PDF Document Generator]
    B --> F[5. PIU Email Router]
    
    C -->|Extracts EXIF Coordinates, Taken-Time, & Check Dupes| G[(Local JSON database)]
    D -->|Validates Potholes / Cracks / Faded Markings| G
    E -->|Generates Formal NHAI PDF Letter with Image| H[Public/PDFs/ Folder]
    F -->|Maps Location to Closest PIU Office| I[Sent_Emails/ Preview Folder]
    
    G -->|Retrieve Status & Timeline| J[Tracking Dashboard]
```

---

## 👥 Team Roles & Integration Blueprint

This codebase acts as the central integration base for our project. Here is how our team's deliverables map to the codebase:

### 1. Jesika (Completed & Fully Operational)
* **Intake Interface**: HTML5 Drag-and-drop form with Leaflet map pinpointing.
* **Originality Audit Engine**: Validates image EXIF geotags, checks timestamp differences, audits editing software traces, and scans image SHA-256/pixel fingerprints to reject duplicate uploads.
* **Model Integration Module**: Serves classifications and coordinates.
* **Complaint Letter PDF Compiler**: Generates formatted A4 PDF letters with official headers, metadata metrics, and embedded image evidence.
* **PIU Email Router**: Calculates geodesic distances using the Haversine formula to map coordinates to regional PIU offices (Delhi, Mumbai, Varanasi, Bangalore, Chennai, Guwahati, Kolkata) and logs dispatch files.
* **Tracking System**: A step-by-step workflow tracking timeline.

### 2. Hemhalatha (Integration Hooks Prepared)
* **Model Training Integration**: Hook points are created inside `services/modelService.js`. When your road defect trained model is ready, toggle `USE_REAL_MODEL_API` to `true` to direct image streams to your classification API.
* **Heatmap Generation**: All coordinates, timestamps, and categories are saved inside `data/complaints.json`. You can read this database file on your heatmap UI and plot coordinates onto Leaflet/Google maps.
* **Multilingual UI Support**: CSS and layout tags are fully structured to easily map translation JSON elements on the frontend.

### 3. Meenakshi (Integration Hooks Prepared)
* **AI Chatbot with RAG**: Chat UI placeholders and Express backend server handles are structured. You can mount your chatbot endpoint inside `server.js` and serve it through the frontend UI.
* **Country Onboarding Framework**: Data onboarding APIs can read and push records through `POST /api/complaints` and `GET /api/complaints`.

---

## ⚙️ Installation & Running the Application

Ensure you have [Node.js](https://nodejs.org/) installed, then follow these steps:

### 1. Initialize Dependencies
Open your terminal in the project directory and run:
```bash
npm install
```
This installs the required packages: `express`, `multer` (file handling), `exifreader` (metadata parsing), `pdfkit` (PDF rendering), `nodemailer` (email routing), and `uuid` (unique ID generation).

### 2. Run the Server
Start the local server process:
```bash
npm start
```
The server binds to `0.0.0.0` by default and prints both local and LAN URLs, for example:
```text
Local URL:   http://localhost:3000
Network URL: http://192.168.1.10:3000
```

### 3. Open on Desktop or Phone
Open the local URL on the development machine:
```
http://localhost:3000
```

Open the network URL from any phone, tablet, or laptop on the same Wi-Fi/LAN:
```
http://<local-ip-address>:3000
```

On mobile browsers, use the Camera button to capture a road photo directly, Gallery to choose an existing image, Share Current GPS to provide the device location, or Pick Location on Map when GPS/EXIF is unavailable.

---

## 🌐 Environment Configuration

Copy `.env.example` values into your deployment environment as needed:

```bash
HOST=0.0.0.0
PORT=3000
NODE_ENV=development
CORS_ORIGIN=*
```

Useful presets:

* **Development/LAN:** `HOST=0.0.0.0`, `CORS_ORIGIN=*`
* **Staging:** set `NODE_ENV=staging`, restrict `CORS_ORIGIN` to your staging URL
* **Production:** set `NODE_ENV=production`, restrict `CORS_ORIGIN` to your public domain

The app uses relative frontend API calls, so it works behind a public URL, reverse proxy, Railway/Render URL, cloud VPS, AWS, Azure, or Google Cloud without code changes.

---

## 🐳 Docker Deployment

Build and run locally:

```bash
docker build -t road-safety-complaints .
docker run --rm -p 3000:3000 --env-file .env road-safety-complaints
```

For cloud platforms, expose port `3000` and provide environment variables from `.env.example`. Mount persistent storage for `data/`, `public/uploads/`, `public/pdfs/`, and `sent_emails/` if complaint history must survive container restarts.

---

## 📱 PWA Support

The frontend includes a web app manifest and service worker. Mobile users can install the portal to the home screen from supported browsers. Static assets are cached for an app-like shell; complaint submission still requires network access.

---

## 🛠️ Code Structure & Developer Guide

```
Road safety 1/
│
├── server.js               # Main Express app, middleware, and api routes
├── package.json            # Node dependency configurations
├── .gitignore              # Excludes development folders, uploads, PDFs, and email drafts
│
├── services/               # Jesika's Backend Business Logic
│   ├── metadataService.js  # EXIF parsing, gps validation, distance maths, & duplicate hashing
│   ├── modelService.js     # Road classification engine (pluggable API model bridge)
│   ├── pdfService.js       # Assembles the NHAI official letter PDF documents
│   └── emailService.js     # Resolves closest PIU emails and writes dispatch previews
│
├── data/
│   └── complaints.json     # Local database record storing all filed incidents
│
├── sent_emails/            # Preview drafts of sent email logs (Open HTML files in browser)
│
└── public/                 # Citizen Dashboard Frontend UI
    ├── index.html          # Web page structural sections (Tabs, Form, Stepper Tracker)
    ├── css/style.css       # Premium glassmorphic custom theme
    ├── js/app.js           # Extracts client EXIF, updates Leaflet maps, & runs API fetches
    ├── uploads/            # Holds citizen evidence photographs
    └── pdfs/               # Holds compiled NHAI complaint PDF documents
```

---

## 🔍 How to Test the Portals Features

1. **Verify GPS Pinning (Real Photo)**:
   * Select a picture taken on a smartphone with location services enabled.
   * The Leaflet map on the right will instantly pin the photo's exact capture location.
   * Submit the complaint. The AI laser line will scan, file the issue, generate a PDF, map the closest PIU office, and write a mock dispatch email.

2. **Verify Fake Detection (Downloaded Picture / Screenshot)**:
   * Select a downloaded image from Google or a screenshot (EXIF headers are stripped/missing).
   * The system will flag a `Warning: Missing GPS` badge and lock the map.
   * If submitted, the portal marks the status as `Flagged for Review` (Quarantined) and blocks it from routing emails to PIU offices.

3. **Verify Spoof Detection (Edited Photo)**:
   * Upload an image edited in Photoshop or Lightroom.
   * The system flags the editing software used in the metadata list, drops the Originality Score, and flags it as suspicious.

4. **Verify Duplicate Prevention**:
   * Attempt to upload the exact same image twice.
   * The backend rejects the second upload instantly, notifying the citizen of a duplicate submission.

5. **Review Outputs**:
   * Inspect the formatted PDF letters inside `public/pdfs/`.
   * Open the mock HTML email dispatches in the `sent_emails/` folder to review what details route to the Project Directors.
