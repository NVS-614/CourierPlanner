const express = require('express');
const router = express.Router();
const lbnall = require("../SAPINVOICE/SapLBN_BulkInvoice_DHL.js");

// Prevent overlapping runs
let isRunning = false;
// Run every 10 minutes
cron.schedule('*/1 * * * *', async () => {
  if (isRunning) {
    console.warn('⏱️ Job skipped: previous run still in progress.');
    return;
  }
  isRunning = true;
  console.log(`🚀 Job started at ${new Date().toLocaleString()}`);

  try {
    await lbnall.processDHLInvoice();
  } catch (err) {
    console.error('❌ Job error:', err.message);
  }

  isRunning = false;
  console.log(`✅ Job finished at ${new Date().toLocaleString()}`);
});


module.exports = router;
