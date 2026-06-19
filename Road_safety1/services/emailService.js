const nodemailer = require('nodemailer');
const fs = require('fs');
const path = require('path');
const { calculateDistance } = require('./metadataService');

// Major NHAI PIU (Project Implementation Units) coordinates & contact details
const NHAI_PIU_DATABASE = [
  { name: 'PIU Delhi', latitude: 28.58, longitude: 77.16, email: 'piu.delhi@nhai-mock.gov.in', district: 'Delhi/NCR' },
  { name: 'PIU Mumbai', latitude: 19.07, longitude: 72.87, email: 'piu.mumbai@nhai-mock.gov.in', district: 'Maharashtra' },
  { name: 'PIU Bangalore', latitude: 12.97, longitude: 77.59, email: 'piu.bangalore@nhai-mock.gov.in', district: 'Karnataka' },
  { name: 'PIU Chennai', latitude: 13.08, longitude: 80.27, email: 'piu.chennai@nhai-mock.gov.in', district: 'Tamil Nadu' },
  { name: 'PIU Kolkata', latitude: 22.57, longitude: 88.36, email: 'piu.kolkata@nhai-mock.gov.in', district: 'West Bengal' },
  { name: 'PIU Varanasi', latitude: 25.31, longitude: 82.97, email: 'piu.varanasi@nhai-mock.gov.in', district: 'Uttar Pradesh East' },
  { name: 'PIU Guwahati', latitude: 26.14, longitude: 91.73, email: 'piu.guwahati@nhai-mock.gov.in', district: 'Assam/North-East' }
];

const DEFAULT_HQ_PIU = {
  name: 'NHAI Headquarters (Central Division)',
  latitude: 28.54,
  longitude: 77.20,
  email: 'safety-hq@nhai-mock.gov.in',
  district: 'All-India Central'
};

/**
 * Finds the closest NHAI Project Implementation Unit (PIU) based on Latitude and Longitude.
 */
function findNearestPIU(latitude, longitude) {
  if (!latitude || !longitude) {
    return DEFAULT_HQ_PIU;
  }

  let closestPIU = DEFAULT_HQ_PIU;
  let minDistance = Infinity;

  for (const piu of NHAI_PIU_DATABASE) {
    const distance = calculateDistance(latitude, longitude, piu.latitude, piu.longitude);
    if (distance < minDistance) {
      minDistance = distance;
      closestPIU = piu;
    }
  }

  return {
    ...closestPIU,
    distanceKm: Math.round(minDistance * 100) / 100
  };
}

/**
 * Sends/Logs the routed email with the PDF attachment.
 * @param {Object} complaint - The complaint record
 * @param {string} pdfPath - Absolute path to the generated complaint PDF letter
 * @returns {Promise<Object>} Status of the email dispatch
 */
async function routeComplaintEmail(complaint, pdfPath) {
  const gpsCoords = complaint.metadataResults.details.gpsCoords;
  const targetPIU = findNearestPIU(
    gpsCoords ? gpsCoords.latitude : null,
    gpsCoords ? gpsCoords.longitude : null
  );
  const targetAuthority = complaint.authority || {
    type: 'NHAI PIU',
    name: targetPIU.name,
    email: targetPIU.email
  };

  const emailSubject = `[URGENT ROAD SAFETY] Complaint Filed - Ref ID: ${complaint.id} (${complaint.category.toUpperCase()})`;
  
  const emailHtml = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; color: #333333; line-height: 1.6; }
          .header { background-color: #0B3C5D; color: white; padding: 20px; text-align: center; }
          .content { padding: 20px; border: 1px solid #dddddd; border-radius: 5px; margin-top: 15px; }
          .info-table { width: 100%; border-collapse: collapse; margin: 15px 0; }
          .info-table th, .info-table td { border: 1px solid #dddddd; padding: 10px; text-align: left; }
          .info-table th { background-color: #f5f7fa; }
          .badge { padding: 5px 10px; border-radius: 3px; font-weight: bold; color: white; }
          .badge-green { background-color: #28a745; }
          .badge-red { background-color: #dc3545; }
          .footer { font-size: 11px; color: #777777; margin-top: 20px; text-align: center; }
        </style>
      </head>
      <body>
        <div class="header">
          <h2>NHAI Safety Portal - Dispatch Route Service</h2>
        </div>
        <div class="content">
          <p>Dear Project Director,</p>
          <p>An official road defect complaint has been registered on the NHAI Road Safety citizen portal. Based on road classification and geographical coordinate matching, this incident is routed to <strong>${targetAuthority.name}</strong> (${targetAuthority.type}).</p>
          
          <h3>Incident Summary:</h3>
          <table class="info-table">
            <tr>
              <th>Complaint Reference ID</th>
              <td><strong>${complaint.id}</strong></td>
            </tr>
            <tr>
              <th>Issue Classification (AI)</th>
              <td>${complaint.modelResults.displayName || complaint.category} (Confidence: ${complaint.modelResults.confidence}%)</td>
            </tr>
            <tr>
              <th>Road Context</th>
              <td>${complaint.roadName || 'Unknown road'} - ${complaint.roadType || 'Unclassified'}${complaint.district ? `, ${complaint.district}` : ''}${complaint.state ? `, ${complaint.state}` : ''}</td>
            </tr>
            <tr>
              <th>Responsible Authority</th>
              <td>${targetAuthority.name} (${targetAuthority.type})</td>
            </tr>
            <tr>
              <th>Geographical Location</th>
              <td>${gpsCoords ? `${gpsCoords.latitude.toFixed(6)}, ${gpsCoords.longitude.toFixed(6)}` : 'Manual Entry (No GPS in media)'}</td>
            </tr>
            <tr>
              <th>Citizen Description</th>
              <td>"${complaint.description}"</td>
            </tr>
            <tr>
              <th>Originality Status</th>
              <td>
                <span class="badge ${complaint.metadataResults.isValid ? 'badge-green' : 'badge-red'}">
                  ${complaint.metadataResults.status} (Score: ${complaint.metadataResults.score}%)
                </span>
              </td>
            </tr>
            <tr>
              <th>Originality Flags Logged</th>
              <td>${complaint.metadataResults.flags.length > 0 ? complaint.metadataResults.flags.join(', ') : 'None'}</td>
            </tr>
          </table>

          <p>The official, formatted <strong>Complaint Letter PDF</strong> has been attached to this email. Please review the details and assign this issue to the engineering maintenance team for inspection and remediation.</p>
          
          <p>Best regards,<br>NHAI Safety Portal Operations Team</p>
        </div>
        <div class="footer">
          <p>This is a simulated email route generated by the local application for Project Implementation Unit validation.</p>
        </div>
      </body>
    </html>
  `;

  // Create folder for sent emails logs (HTML preview format)
  const logDir = path.join(__dirname, '..', 'sent_emails');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }

  const logFileName = `email_${complaint.id}.html`;
  const logFilePath = path.join(logDir, logFileName);
  
  // Write the preview file
  const emailLogData = `
<!-- 
  TO: ${targetAuthority.email || targetPIU.email}
  SUBJECT: ${emailSubject}
  ATTACHMENT: ${pdfPath}
-->
${emailHtml}
  `;
  fs.writeFileSync(logFilePath, emailLogData);

  // nodemailer code mock / actual sending
  let sentInfo = {
    routedTo: targetAuthority.name,
    email: targetAuthority.email || targetPIU.email,
    subject: emailSubject,
    previewFile: `/sent_emails/${logFileName}`,
    sentTime: new Date().toISOString()
  };

  // We set up a mock transport or a JSON transporter for demo safety
  // (In production, the leader can input their SMTP config)
  try {
    // Write email activity to a local log index file
    const activityPath = path.join(logDir, 'activity_log.json');
    let activity = [];
    if (fs.existsSync(activityPath)) {
      try {
        activity = JSON.parse(fs.readFileSync(activityPath, 'utf8'));
      } catch (e) {
        activity = [];
      }
    }
    activity.unshift({
      id: complaint.id,
      piuName: targetAuthority.name,
      piuEmail: targetAuthority.email || targetPIU.email,
      sentAt: sentInfo.sentTime,
      previewFile: logFileName,
      subject: emailSubject,
      originalityScore: complaint.metadataResults.score
    });
    fs.writeFileSync(activityPath, JSON.stringify(activity, null, 2));
  } catch (logErr) {
    console.error('Failed to update email activity log:', logErr.message);
  }

  return sentInfo;
}

module.exports = {
  routeComplaintEmail,
  findNearestPIU,
  NHAI_PIU_DATABASE
};
