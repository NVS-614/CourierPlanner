const ExcelJS = require("exceljs");
const nodemailer = require("nodemailer");

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

async function sendEmailWithExcel(toEmail, subject, excelBuffer, fileName) {
  let transporter = nodemailer.createTransport({
    service: "gmail",
    auth: {
      user: process.env.EMAIL_USER,
      pass: process.env.EMAIL_PASS

    }
  });

  await transporter.sendMail({
    from: process.env.EMAIL_USER,
    to: toEmail,
    subject: subject,
    text: "Please find attached Excel file.",
    attachments: [
      {
        filename: fileName,
        content: excelBuffer,
        contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
      }
    ]
  });

  console.log("Email sent with Excel attachment!");
}
async function generateAndSendExcel(toEmail) {

  const jsonData = [
    { Name: "Ashok", City: "Hyderabad", Age: 30 },
    { Name: "Ravi", City: "Chennai", Age: 28 }
  ];

  // 1. Convert JSON → Excel buffer
  const excelBuffer = await jsonToExcelBuffer(jsonData);

  // 2. Send email
  await sendEmailWithExcel(toEmail,
    "Batch Shipment Report",
    excelBuffer,
    "batch_report.xlsx"
  );
}
module.exports = { generateAndSendExcel }
