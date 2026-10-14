const express = require('express');
const router = express.Router();
const tms = require("../SAPINVOICE/SapTMSInvoice_DHL.js");
const tmsupsedi = require("../SAPINVOICE/SapTMS_EDI_Invoice_UPS.js");
const lbn = require("../SAPINVOICE/SapLBNInvoice_DHL.js");
const lbnall = require("../SAPINVOICE/SapLBN_BulkInvoice_DHL.js");
const db = require('../database/db');

router.post('/lbnDHL', async (req, res) => {
  try {
    return await lbn.processDHLInvoice();
  } catch (err) {
    console.error("❌ error:", err.message);
    return null
  }
});

router.post('/lbnDHLAll', async (req, res) => {
  try {
    return await lbnall.processDHLInvoice();
  } catch (err) {
    console.error("❌ error:", err.message);
    return null
  }
});

router.post('/tmsDHL', async (req, res) => {
  try {
    return await tms.processDHLInvoice();
  } catch (err) {
    console.error("❌ error:", err.message);
    return null
  }
});

router.post('/EDI/tmsUPS', async (req, res) => {
  try {
    return await tmsupsedi.processUPSEDIInvoice();
  } catch (err) {
    console.error("❌ error:", err.message);
    return null
  }
});



module.exports = router;
