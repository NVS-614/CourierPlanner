// batchShip_email_processor.js

// -----------------------------
// Imports
// -----------------------------
const imaps = require('imap-simple');
const { simpleParser } = require('mailparser');
const XLSX = require("xlsx");
const fs = require("fs");
const path = require("path");
const os = require("os");
const cron = require("node-cron");
const { Pool } = require("pg");
//require('dotenv').config();
const dotenv = require('dotenv');
dotenv.config();
// -----------------------------
// IMAP Email Config (Gmail Sample)
// -----------------------------
const imapConfig = {
  imap: {
    user: process.env.EMAIL_USER,
    password: process.env.EMAIL_PASS,
    host: "imap.gmail.com",
    port: 993,
    tls: true,
    tlsOptions: {
      rejectUnauthorized: false // <-- accept self-signed certs
    }
  }
};

// -----------------------------
// Postgres Database Connection
// -----------------------------

const pool = new Pool({
  user: process.env.DB_USER,
  host: process.env.DB_HOST,
  database: process.env.DB_NAME,
  password: process.env.DB_PASSWORD,
  port: process.env.DB_PORT,
});

// -----------------------------
// Main Background Job
// -----------------------------

async function readEmailsAndFetchAttachments() {
  console.log("Checking for new emails...");
  let connection;
  try {
    connection = await imaps.connect(imapConfig);
    await connection.openBox("INBOX");
    const searchCriteria = ['UNSEEN'];
    const fetchOptions = {
      bodies: ['HEADER.FIELDS (FROM SUBJECT DATE)', 'TEXT'], // Fetch both headers and text body
      markSeen: false,
      struct: true
    };
    const messages = await connection.search(searchCriteria, fetchOptions);
    console.log("Found unread emails:", messages.length);
    if (messages.length === 0) {
      connection.end();
      return;
    }
    for (const message of messages) {
      const uid = message.attributes.uid;
      // Extract headers directly from the message
      const headers = message.parts.find(part => part.which === 'HEADER.FIELDS (FROM SUBJECT DATE)');
      if (!headers) {
        console.log("No headers found for message:", uid);
        continue;
      }
      const from = headers.body.from?.[0] || '';
      const subject = (headers.body.subject?.[0] || '').toLowerCase();
      const date = headers.body.date?.[0] || '';

      // Parse date
      let emailDate;
      try {
        emailDate = new Date(date);
        if (isNaN(emailDate.getTime())) {
          emailDate = new Date();
        }
      } catch (err) {
        emailDate = new Date();
      }
      // Extract sender email from from field
      const senderEmail = from.match(/<([^>]+)>/)?.[1] || from;
      console.log("From:", senderEmail);
      console.log("Subject:", subject);
      console.log("Date:", emailDate);

      // Check if subject matches batch shipping pattern
      if (!/batch[\s-]*ship/i.test(subject)) {
        console.log(`Skipping email (subject does not match Batch Shipping): ${subject}`);
        continue;
      }

      // Look for attachments in the message structure
      const parts = imaps.getParts(message.attributes.struct);
      let hasAttachments = false;

      for (const part of parts) {
        if (part.disposition && part.disposition.type && part.disposition.type.toUpperCase() === 'ATTACHMENT') {
          hasAttachments = true;
          try {
            const partData = await connection.getPartData(message, part);

            const filename = part.disposition.params.filename || part.params?.name || 'attachment.bin';
            const ext = filename.toLowerCase();

            // Accept Excel formats
            if (!(ext.endsWith(".xlsx") || ext.endsWith(".xls") || ext.endsWith(".csv"))) {
              console.log("Skipping non-excel file:", filename);
              continue;
            }

            console.log("Processing attachment:", filename);
            await processExcelBuffer(partData, filename, senderEmail, emailDate);

          } catch (err) {
            console.error("Error processing attachment:", err);
          }
        }
      }

      if (!hasAttachments) {
        console.log("No attachments found in email");
        continue;
      }

      // Move message to Processed folder
      try {
        await connection.moveMessage(uid.toString(), "Processed");
        console.log("Mail processed and moved to Processed folder:", uid);
      } catch (e) {
        console.log("Folder 'Processed' not found → creating...");
        await connection.addBox("Processed");
        await connection.moveMessage(uid.toString(), "Processed");
        console.log("Mail processed and moved to Processed folder:", uid);
      }
    }
  } catch (err) {
    console.error("Error reading email:", err);
  } finally {
    if (connection) connection.end();
  }
}


// -----------------------------
// Parse Excel File & Insert into DB
// -----------------------------
async function processExcelBuffer(buffer, filename, senderEmail, date) {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json(sheet);

  console.log("Excel rows:", rows.length);

  // create batch in `automated_shipments` table
  const batch = await createAutomatedShipment(rows.length, senderEmail, date);

  for (const row of rows) {
    await insertIntoBatchShipments(row, batch.batchname);
  }
}

async function getNextBatchId() {
  const result = await pool.query(`
    SELECT LPAD((COALESCE(MAX(batch_id)::BIGINT, 0) + 1)::TEXT, 1, '0') AS batch_id 
    FROM public.batch_shipments
  `);

  return result.rows[0].batch_id;
}
async function createAutomatedShipment1(totalCount, senderEmail, receivedDate) {
 //here id is 1, batchname is batch_2
  const query = `
    INSERT INTO public.automated_shipments
    (batchname, details, date, status, total, success_count, failed, op_email, op_send_status)
    VALUES (      'batch_' || nextval('automated_shipments_id_seq'),   -- generate batchname using next ID
      '{}'::json,      $1,      'open',      $2,      0,      0,      $3,      false    )
    RETURNING id, batchname;
  `;

  const result = await pool.query(query, [
    receivedDate,
    totalCount,
    senderEmail
  ]);

  return result[0]; // { id, batchname }
}

async function createAutomatedShipment(totalCount, senderEmail, receivedDate) {
  // Step 1: insert row without batchname
  const insertQuery = `
    INSERT INTO public.automated_shipments
      (batchname, details, date, status, total, success_count, failed, op_email, op_send_status)
    VALUES ('', '{}'::json, $1, 'open', $2, 0, 0, $3, false)
    RETURNING id;
  `;

  const insertResult = await pool.query(insertQuery, [
    receivedDate,
    totalCount,
    senderEmail,
  ]);

  let id = 0;
  if (insertResult?.rows[0]) {
    id = insertResult.rows[0].id;
  } else {
    id = insertResult[0].id;
  }
  const batchname = `batch_${id}`;

  // Step 2: update batchname with correct ID
  const updateQuery = `
    UPDATE public.automated_shipments
    SET batchname = $1
    WHERE id = $2;
  `;

  await pool.query(updateQuery, [batchname, id]);

  return { id, batchname };
}



// -----------------------------
// Insert Row into batch_shipments
// -----------------------------
async function insertIntoBatchShipments(row, batchId) {
  try {
    const rowJson = JSON.stringify(row);

    const result = await pool.query(
      `INSERT INTO public.batch_shipments (batch_id, details, status, message)
       VALUES ($1, $2, NULL, NULL)
       RETURNING id`,
      [batchId, rowJson]
    );

    console.log("Inserted record ID:", result.rows[0].id);

  } catch (err) {
    console.error("Insert error:", err);
  }
}


// Prevent overlapping runs
let isRunning = false;

// Run every 15 minutes
cron.schedule("*/25 * * * *", async () => {
  if (isRunning) {
    console.warn("⏱️ Job skipped: previous run still in progress.");
    return;
  }

  isRunning = true;
  console.log(`🚀 Job started at ${new Date().toLocaleString()}`);

  try {
    await readEmailsAndFetchAttachments();
  } catch (err) {
    console.error("❌ Job error:", err.message);
  }
  isRunning = false;
  console.log(`✅ Job finished at ${new Date().toLocaleString()}`);
});

//readEmailsAndFetchAttachments();
