const ExcelJS = require("exceljs");
const nodemailer = require("nodemailer");
const db = require('../database/db');
async function jsonToExcelBuffer(jsonRows) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Data");

  // Auto-generate columns from JSON keys
  const columns = Object.keys(jsonRows[0]).map(key => ({
    header: key,
    key: key,
    width: 25,
  }));

  sheet.columns = columns;

  // Insert all rows
  jsonRows.forEach(row => sheet.addRow(row));

  // Return buffer (no file stored on disk)
  return await workbook.xlsx.writeBuffer();
}

async function sendEmailWithExcel(toEmail, subject, excelBuffer, fileName, SuccessCount, ErrorCount, batch_id) {
  let transporter = nodemailer.createTransport({
    host: "smtp.gmail.com",
    port: 587,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS // Your app password
    }
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: toEmail,
    subject: subject,
    text: `Hi ${toEmail}, Please find attached Excel file.\n\nTotal shipments processed: ${SuccessCount}\nFailed shipments: ${ErrorCount}`,
    attachments: [
      {
        filename: fileName,
        content: excelBuffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }
    ]
  });
  console.log("Email sent with Excel attachment!");
  try {
    dbBatchAutomated_statusUpdate(batch_id);
  } catch (error) {

  }
}
async function generateAndSendExcel(batch_id, toEmail, SuccessCount, ErrorCount) {
  const checkquery = `SELECT details FROM public.batch_shipments WHERE batch_id = $1`;
  const result = await db.query(checkquery, [batch_id]);
  let jsonData = [];
  if (result && result.length > 0) {
    // Remove 'base64' key from each details object
    jsonData = result.map(row => {
      const { Base64_encodedLabel, ...detailsWithoutBase64 } = row.details;
      return detailsWithoutBase64;
    });
  }
  // 1. Convert JSON → Excel buffer
  const excelBuffer = await jsonToExcelBuffer(jsonData);

  // 2. Send email
  await sendEmailWithExcel(toEmail,
    "Batch Shipment Report",
    excelBuffer,
    batch_id + "PlutoCloud ShipCore batch_report.xlsx", SuccessCount, ErrorCount, batch_id
  );
}
async function dbBatchAutomated_statusUpdate(batchid) {
  try {
    const updateQuery = `UPDATE public.automated_shipments SET op_send_status = true WHERE batchname = $1`;
    const result = await db.query(updateQuery, [batchid]);
  } catch (error) {
    console.error("Failed dbBatchAutomated_statusUpdate:", error);
  }
}
module.exports = { generateAndSendExcel }
