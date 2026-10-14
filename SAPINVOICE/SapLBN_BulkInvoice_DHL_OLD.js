const express = require('express');
const router = express.Router();
const axios = require('axios');
const XLSX = require('xlsx');
const ftp = require("basic-ftp");
const dbCon = require("../database/dbsaveandupdate.js");
const fs = require("fs");
const { json } = require('body-parser');
const { getLBNToken } = require('../Reuse/LBNTokenManager.js');
const reuse = require('../Reuse/utilityfunctions.js');
const cron = require("node-cron");
require("dotenv").config();


async function processDHLInvoice() {
  try {
    const data = await reuse.readExcelFromFTP();
    if (!data || !data.length) {
      return;
    }

    const headers = data[0];
    // Find index for each column we need
    const columnIndex = {
      lineType: headers.indexOf('Line Type'),
      invoiceNumber: headers.indexOf('Invoice Number'),
      currency: headers.indexOf('Currency'),
      ShipmentNumber: headers.indexOf('Shipment Number'),
      invoiceDate: headers.indexOf('Invoice Date'),
      grossAmount: headers.indexOf('Total amount (incl. VAT)'),
      totalTaxAmount: headers.indexOf('Total Tax'),
      weightCharge: headers.indexOf('Weight Charge'),
      xc1Code: headers.indexOf('XC1 Code'),
      xc1Charge: headers.indexOf('XC1 Charge'),
      xc1Total: headers.indexOf('XC1 Total'),
      xc2Code: headers.indexOf('XC2 Code'),
      xc2Charge: headers.indexOf('XC2 Charge'),
      xc2Total: headers.indexOf('XC2 Total'),
      xc3Code: headers.indexOf('XC3 Code'),
      xc3Charge: headers.indexOf('XC3 Charge'),
      xc3Total: headers.indexOf('XC3 Total')
    };

    const strCurrency = columnIndex.currency;
    // Find the header row (Line Type I)
    const headerRow = data.find(row => row[columnIndex.lineType] === 'I');
    // Find all item rows (Line Type S)
    const itemRows = data.filter(row => row[columnIndex.lineType] === 'S');
    if (!headerRow) {
      console.log("No header row found with Line Type 'I'")
      return;
    }
    const chargeCodeData = await fetchChargeCodes();
    // 1) Build the lookup map once (keys must be strings)
    const allTrackingNos = [...new Set(itemRows.map(r => String(r[columnIndex.ShipmentNumber])))];
    const freightOrdersByTrackingNo = await dbCon.getHeaderInfosByTrackingNos(allTrackingNos); // Map<string, HEADER_INFO>

    const rawDateStr = headerRow[columnIndex.invoiceDate].toString();
    const formattedDate = `${rawDateStr.substring(0, 4)}-${rawDateStr.substring(4, 6)}-${rawDateStr.substring(6, 8)}`; // '2025-02-24'
    const FreightOrderdata = freightOrdersByTrackingNo.get(allTrackingNos[0]) || null;
    // Build the JSON structure complete excel data....

    // 2) Build invreq using the per-row lookup
    const invreq = {
      carrierInvoiceID: headerRow[columnIndex.invoiceNumber],
      invoiceDate: formatDateTime(headerRow[columnIndex.invoiceDate]),
      grossAmount: headerRow[columnIndex.grossAmount],
      grossAmountCurrency: headerRow[strCurrency],
      orderingPartyLbnId: FreightOrderdata.orderingPartyLbnId,
      carrierLbnId: FreightOrderdata.carrierLbnId,
      baseDocumentType: '1122',
      purchasingParty: FreightOrderdata.purchasingParty,
      billFromParty: FreightOrderdata.billFromParty,
      totalTaxAmount: headerRow[columnIndex.totalTaxAmount],
      taxAmountCurrency: headerRow[strCurrency],
      senderSystemId: FreightOrderdata.senderSystemId,

      items: itemRows.map(item => {
        const trackingNo = String(item[columnIndex.ShipmentNumber]);
        const freightOrderData = freightOrdersByTrackingNo.get(trackingNo) || {}; // {} fallback
        return {
          grossAmount: item[columnIndex.grossAmount],
          grossAmountCurrency: item[strCurrency],
          // FROM Freight Order (HEADER_INFO), pulled by tracking no:
          freightDocumentID: freightOrderData.DocumentNumber ?? null,
          pricingElements: [
            {
              lbnChargeCode: "FRT",
              rateAmount: item[columnIndex.weightCharge] || 0,
              rateAmountCurrency: item[strCurrency],
              finalAmount: item[columnIndex.weightCharge],
              finalAmountCurrency: item[strCurrency],
            },
            {
              lbnChargeCode: reuse.getsapchargecode("UPS", item[columnIndex.xc1Code], chargeCodes),
              rateAmount: item[columnIndex.xc1Charge] || 0,
              rateAmountCurrency: item[strCurrency],
              finalAmount: item[columnIndex.xc1Total],
              finalAmountCurrency: item[strCurrency],
            },
            {
              lbnChargeCode: item[columnIndex.xc2Code] || "NN",
              rateAmount: item[columnIndex.xc2Charge] || 0,
              rateAmountCurrency: item[strCurrency],
              finalAmount: item[columnIndex.xc2Total],
              finalAmountCurrency: item[strCurrency]
            },
            {
              lbnChargeCode: item[columnIndex.xc3Code] || "YY",
              rateAmount: item[columnIndex.xc3Charge] || 0,
              rateAmountCurrency: item[strCurrency],
              finalAmount: item[columnIndex.xc3Total],
              finalAmountCurrency: item[strCurrency]
            }
          ].filter(pe => pe.rateAmount > 0) // Only include pricing elements with amount > 0
        };
      })
    };

    const token = await getLBNToken();


    // Loop over each item (child)
    for (const item of itemRows) {
      // Build common header part
      const commonHeader = {
        carrierInvoiceID: headerRow[columnIndex.invoiceNumber],
        invoiceDate: formatDateTime(headerRow[columnIndex.invoiceDate]),
        grossAmount: headerRow[columnIndex.grossAmount],
        grossAmountCurrency: headerRow[strCurrency],
        orderingPartyLbnId: FreightOrderdata.orderingPartyLbnId,
        carrierLbnId: FreightOrderdata.carrierLbnId,
        baseDocumentType: '1122',
        purchasingParty: FreightOrderdata.purchasingParty,
        billFromParty: FreightOrderdata.billFromParty,
        totalTaxAmount: headerRow[columnIndex.totalTaxAmount],
        taxAmountCurrency: headerRow[strCurrency],
        senderSystemId: FreightOrderdata.senderSystemId,
      };
      const trackingNo = String(item[columnIndex.ShipmentNumber]);
      const freightOrderData = freightOrdersByTrackingNo.get(trackingNo) || {}; // {} fallback
      const itemDetail = {
        grossAmount: item[columnIndex.grossAmount],
        grossAmountCurrency: item[strCurrency],
        freightDocumentID: freightOrderData.DocumentNumber,
        pricingElements: [
          {
            lbnChargeCode: "FRT",
            rateAmount: item[columnIndex.weightCharge] || 0,
            rateAmountCurrency: item[strCurrency],
            finalAmount: item[columnIndex.weightCharge],
            finalAmountCurrency: item[strCurrency]
          },
          {
            lbnChargeCode: item[columnIndex.xc1Code] || "FF",
            rateAmount: item[columnIndex.xc1Charge] || 0,
            rateAmountCurrency: item[strCurrency],
            finalAmount: item[columnIndex.xc1Total],
            finalAmountCurrency: item[strCurrency]
          },
          {
            lbnChargeCode: item[columnIndex.xc2Code] || "NN",
            rateAmount: item[columnIndex.xc2Charge] || 0,
            rateAmountCurrency: item[strCurrency],
            finalAmount: item[columnIndex.xc2Total],
            finalAmountCurrency: item[strCurrency]
          },
          {
            lbnChargeCode: item[columnIndex.xc3Code] || "YY",
            rateAmount: item[columnIndex.xc3Total] || 0,
            rateAmountCurrency: item[strCurrency],
            finalAmount: item[columnIndex.x],
            finalAmountCurrency: item[strCurrency]
          }
        ].filter(pe => pe.rateAmount > 0)
      };

      const fullDetails = {
        ...commonHeader,
        items: itemDetail // Use `item` key (not `items`) since it's one child per record
      };

      console.log(JSON.stringify(fullDetails))

      try {
        const logEntry = {
          invoicedate: formattedDate,
          carrier: 'DHL',
          details: fullDetails,
          reference: 'C:/savedpath/invoice123.json'
        };
        const uniqueid = await dbCon.dbSAP_INVOICE_save(logEntry);
        console.log('Saved item with id:', uniqueid);
      } catch (error) {
        console.error('Error saving child record:', error);
      }

    }

    try {
      const sapRes = await axios.post(process.env.INVOICE_URL, invreq, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
      console.log('sapInvoiceResponse:', JSON.stringify(sapRes.data));
    } catch (error) {
      console.log(error?.response?.data || error.message)
    }

    return;

  } catch (error) {
    console.error('Unexpected Error:', error);
  }
}




async function fetchChargeCodes() {

  const checkResult = await db.query(`SELECT details FROM public.chargecodes`); // replace with your query
  return checkResult;
}
function formatDateTime(strdate) {
  if (!strdate) return null;
  const cleaned = String(strdate).trim();
  const dateformat = /^\d{8}$/.test(cleaned)
    ? new Date(`${cleaned.slice(0, 4)}-${cleaned.slice(4, 6)}-${cleaned.slice(6, 8)}`)
    : new Date(cleaned);
  if (isNaN(dateformat.getTime())) return null; // Invalid date
  dateformat.setSeconds(0, 0); // Zero out seconds/milliseconds
  return dateformat.toISOString().replace(".000Z", "Z");
}
// Prevent overlapping runs
let isRunning = false;

// Run every 5 minutes
cron.schedule("*/10 * * * *", async () => {
  if (isRunning) {
    console.warn("⏱️ Job skipped: previous run still in progress.");
    return;
  }

  isRunning = true;
  console.log(`🚀 Job started at ${new Date().toLocaleString()}`);

  try {
    await processDHLInvoice();
  } catch (err) {
    console.error("❌ Job error:", err.message);
  }

  isRunning = false;
  console.log(`✅ Job finished at ${new Date().toLocaleString()}`);
});
