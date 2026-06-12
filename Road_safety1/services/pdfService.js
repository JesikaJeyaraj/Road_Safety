const PDFDocument = require('pdfkit');
const fs = require('fs');
const path = require('path');

/**
 * Generates an official NHAI Road Safety Complaint Letter PDF.
 * @param {Object} complaint - The complaint data object
 * @param {string} imagePath - Path to the uploaded issue image
 * @param {string} outputPath - Output path for the generated PDF
 * @returns {Promise<string>} Path of the successfully created PDF
 */
function createComplaintPDF(complaint, imagePath, outputPath) {
  return new Promise((resolve, reject) => {
    try {
      const sha256 = complaint.sha256 || (complaint.metadataResults.details && complaint.metadataResults.details.sha256) || 'unavailable';

      // Ensure the output directory exists
      const dir = path.dirname(outputPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const doc = new PDFDocument({
        size: 'A4',
        margins: { top: 50, bottom: 50, left: 50, right: 50 }
      });

      const writeStream = fs.createWriteStream(outputPath);
      doc.pipe(writeStream);

      // --- Document Styling & Colors ---
      const darkBlue = '#0B3C5D';
      const slateGrey = '#328CC1';
      const warningGold = '#D9B310';
      const textDark = '#1D2731';
      const lightBG = '#F5F7FA';

      // --- Header (NHAI Letterhead) ---
      doc.rect(50, 45, 495, 8).fill(darkBlue);
      
      doc.moveDown(1.5);
      doc.fillColor(darkBlue)
         .fontSize(18)
         .font('Helvetica-Bold')
         .text('NATIONAL HIGHWAYS AUTHORITY OF INDIA', { align: 'center' });
         
      doc.fontSize(10)
         .font('Helvetica')
         .fillColor(slateGrey)
         .text('Road Safety and Highway Maintenance Division (PIU Support Branch)', { align: 'center' })
         .moveDown(0.5);
         
      doc.rect(50, 95, 495, 1).fillColor('#CCCCCC').fill();

      // --- Meta details Block (Two Columns) ---
      doc.moveDown(1.5);
      
      const startY = doc.y;
      
      // Column 1
      doc.font('Helvetica-Bold').fontSize(10).fillColor(textDark)
         .text('COMPLAINT ID:', 50, startY)
         .font('Helvetica').text(complaint.id, 150, startY)
         
         .moveDown(0.4)
         .font('Helvetica-Bold').text('DATE FILED:', 50)
         .font('Helvetica').text(new Date(complaint.createdAt).toLocaleString(), 150)
         
         .moveDown(0.4)
         .font('Helvetica-Bold').text('CATEGORY:', 50)
         .font('Helvetica').text(complaint.modelResults.displayName || complaint.category, 150);

      // Column 2
      doc.font('Helvetica-Bold').text('GPS LOCATION:', 320, startY);
      
      const gpsText = complaint.metadataResults.details.gpsCoords 
        ? `${complaint.metadataResults.details.gpsCoords.latitude.toFixed(6)}, ${complaint.metadataResults.details.gpsCoords.longitude.toFixed(6)}`
        : 'Not Available (Manual Entry)';
        
      doc.font('Helvetica').text(gpsText, 410, startY)
         
         .moveDown(0.4)
         .font('Helvetica-Bold').text('VERIFICATION:', 320)
         .fillColor(complaint.metadataResults.isValid ? 'green' : 'red')
         .font('Helvetica-Bold').text(`${complaint.metadataResults.status} (${complaint.metadataResults.score}%)`, 410)
         
         .moveDown(0.4)
         .fillColor(textDark)
         .font('Helvetica-Bold').text('REFERRED PIU:', 320)
         .font('Helvetica').text(complaint.piuEmailMapping.name || 'Unassigned', 410);

      // Separator line
      doc.moveDown(1.5);
      const endY = doc.y;
      doc.rect(50, endY, 495, 1).fillColor('#CCCCCC').fill();

      // --- Letter Body ---
      doc.moveDown(1.5);
      doc.font('Helvetica-Bold').fontSize(12).fillColor(darkBlue)
         .text('SUBJECT: Road Defect & Maintenance Safety Complaint Notification');
         
      doc.moveDown(1);
      doc.font('Helvetica').fontSize(10).fillColor(textDark)
         .text('To,', 50)
         .font('Helvetica-Bold')
         .text(`The Project Director,`, 50)
         .text(`National Highways Authority of India (NHAI),`, 50)
         .text(`Project Implementation Unit (PIU) - ${complaint.piuEmailMapping.name || 'Central Board'}`, 50);

      doc.moveDown(1.2);
      
      const bodyText = `This letter serves as an official report regarding a hazardous road condition detected and filed through the Road Safety Citizen Portal. The incident details are listed below:

Defect Type: ${complaint.modelResults.displayName || complaint.category}
Model Inference Confidence: ${complaint.modelResults.confidence}%
Reported Details: "${complaint.description}"

A verification protocol has been run against the uploaded media. The system verified GPS geo-tags embedded in the file, ensuring time and location consistency. Our classification model confirmed the presence of the road defect. Please dispatch the maintenance team to audit this location and take corrective actions at the earliest.`;

      doc.font('Helvetica').fontSize(10.5).text(bodyText, {
        align: 'justify',
        lineGap: 4
      });

      // --- Embedded Image Section ---
      doc.moveDown(1.5);
      
      if (imagePath && fs.existsSync(imagePath)) {
        try {
          doc.font('Helvetica-Bold').fontSize(10).fillColor(darkBlue)
             .text('ATTACHED EVIDENCE (PHOTOGRAPH):')
             .moveDown(0.5);

          // Embed image with a maximum height of 150 points to fit on the same page
          doc.image(imagePath, {
            fit: [300, 150],
            align: 'center'
          });
          doc.moveDown(1.5);
        } catch (imgErr) {
          console.error('Failed to embed image in PDF:', imgErr.message);
          doc.fillColor('red').text('[Evidence Image could not be rendered in PDF format]').moveDown(1);
        }
      }

      // --- Footer/Security Stamp ---
      // Fix position to bottom of the A4 page
      const footerY = 740;
      doc.rect(50, footerY - 10, 495, 1).fillColor('#E0E0E0').fill();
      
      doc.fillColor('#777777')
         .fontSize(8)
         .font('Helvetica-Oblique')
         .text(`This document is dynamically generated by the NHAI Safe-Drive Automated Portal. System Originality Verification: ${complaint.metadataResults.status} (Hash: ${sha256.substring(0, 16)}...)`, 50, footerY, {
           width: 495,
           align: 'center'
         });

      doc.end();

      writeStream.on('finish', () => {
        resolve(outputPath);
      });

      writeStream.on('error', (err) => {
        reject(err);
      });

    } catch (error) {
      reject(error);
    }
  });
}

module.exports = {
  createComplaintPDF
};
