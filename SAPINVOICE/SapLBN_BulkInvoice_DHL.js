const express = require('express');
const router = express.Router();
const axios = require('axios');
const XLSX = require('xlsx');
const ftp = require('basic-ftp');
const dbCon = require('../database/dbsaveandupdate.js');
const fs = require('fs');
const { json } = require('body-parser');
const { getLBNToken } = require('../Reuse/LBNTokenManager.js');
const reuse = require('../Reuse/utilityfunctions.js');
const cron = require('node-cron');
require('dotenv').config();

async function processDHLInvoice() {
  try {
    // Read Excel rows from FTP
    const data = await reuse.readExcelFromFTP();
    if (!Array.isArray(data) || data.length === 0) return;

    const headers = data[0];

    // Column indices
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
      xc3Total: headers.indexOf('XC3 Total'),
    };
    const currencyIdx = columnIndex.currency;
    // Header row (I) and item rows (S)
    const headerRow = data.find((row) => row[columnIndex.lineType] === 'I');
    const itemRows = data.filter((row) => row[columnIndex.lineType] === 'S');
    if (!headerRow || itemRows.length === 0) return;

    // Build trackingNo → FreightOrder map (one DB hit)
    const allTrackingNos = [...new Set(itemRows.map((r) => String(r[columnIndex.ShipmentNumber]).trim()))];
    const freightByTrackingNo = await dbCon.getHeaderInfosByTrackingNos(allTrackingNos); // Map<string, HEADER_INFO>
    // If nothing came back, stop right here
    if (!freightByTrackingNo || freightByTrackingNo.size === 0) {
      console.warn('No Freight Orders found for the given tracking numbers. Stopping.');
      return;
    }
    // Use the FIRST RECORD from the Map (not the first trackingNo)
    const [firstFOKey, firstFO] = freightByTrackingNo.entries().next().value;

    // Build common header once
    const commonHeader = {
      carrierInvoiceID: headerRow[columnIndex.invoiceNumber],
      invoiceDate: reuse.formatDateTime(headerRow[columnIndex.invoiceDate]),
      grossAmount: headerRow[columnIndex.grossAmount],
      grossAmountCurrency: headerRow[currencyIdx],
      orderingPartyLbnId: firstFO.orderingPartyLbnId,
      carrierLbnId: firstFO.carrierLbnId,
      baseDocumentType: '1122',
      purchasingParty: firstFO.purchasingParty,
      billFromParty: firstFO.billFromParty,
      totalTaxAmount: headerRow[columnIndex.totalTaxAmount],
      taxAmountCurrency: headerRow[currencyIdx],
      senderSystemId: firstFO.senderSystemId,

    };
    const chargeCodes = await dbCon.fetchINVChargeCodes('UPS');
    // Build items ONCE (single source of truth)
    const itemDetails = itemRows.map((item, idx) => {
      const trackingNo = String(item[columnIndex.ShipmentNumber]).trim();
      const fo = freightByTrackingNo.get(trackingNo) || {};
      if (!fo.DocumentNumber) {
        const current = Number(commonHeader?.grossAmount ?? 0) || 0;
        const amt = Number(String(item?.[columnIndex.grossAmount] ?? 0).replace(/[,\s₹$]/g, '')) || 0;
        commonHeader.grossAmount = Number((current - amt).toFixed(2));
      }
      else {
        // Pricing elements (only include if amount > 0)
        const pricingElements = [
          {
            lbnChargeCode: "FRT",
            rateAmount: item[columnIndex.weightCharge] || 0,
            rateAmountCurrency: item[currencyIdx],
            finalAmount: item[columnIndex.weightCharge],
            finalAmountCurrency: item[currencyIdx],
          },
          {
            lbnChargeCode: getsapchargecode(item[columnIndex.xc1Code], chargeCodes) || "FUEL",
            rateAmount: item[columnIndex.xc1Charge] || 0,
            rateAmountCurrency: item[currencyIdx],
            finalAmount: item[columnIndex.xc1Total],
            finalAmountCurrency: item[currencyIdx],
          },
          {
            lbnChargeCode: getsapchargecode(item[columnIndex.xc2Code], chargeCodes) || "NN",
            rateAmount: item[columnIndex.xc2Charge] || 0,
            rateAmountCurrency: item[currencyIdx],
            finalAmount: item[columnIndex.xc2Total],
            finalAmountCurrency: item[currencyIdx]
          },
          {
            lbnChargeCode: getsapchargecode(item[columnIndex.xc3Code], chargeCodes) || "YY",
            rateAmount: item[columnIndex.xc3Charge] || 0,
            rateAmountCurrency: item[currencyIdx],
            finalAmount: item[columnIndex.xc3Total],
            finalAmountCurrency: item[currencyIdx]
          }
        ].filter((pe) => pe.rateAmount > 0);

        return {
          grossAmount: item[columnIndex.grossAmount],
          grossAmountCurrency: item[currencyIdx],
          freightDocumentID: fo.DocumentNumber ?? null, // pulled by tracking no
          pricingElements,
        };
      }

    });

    // Save EACH item with the same common header (no re-computation)
    const rawDateStr = String(headerRow[columnIndex.invoiceDate] ?? '');
    const formattedDate =
      rawDateStr.length >= 8
        ? `${rawDateStr.substring(0, 4)}-${rawDateStr.substring(4, 6)}-${rawDateStr.substring(6, 8)}`
        : null;

    for (const itemDetail of itemDetails) {
      const fullDetails = { ...commonHeader, items: itemDetail };
      try {
        const logEntry = {
          invoicedate: formattedDate,
          carrier: 'DHL',
          details: fullDetails,
          reference: 'C:/savedpath/invoice123.json',
        };
        const uniqueid = await dbCon.dbSAP_INVOICE_save(logEntry);
        console.log('Saved item with id:', uniqueid);
      } catch (error) {
        console.error('Error saving child record:', error);
      }
    }

    // Build final API payload from the SAME items (no duplication)
    const invreq = {
      ...commonHeader,
      items: itemDetails,
    };

    console.log(JSON.stringify(invreq))
    // Send to SAP
    try {
      const token = await getLBNToken();
      const sapRes = await axios.post(process.env.INVOICE_URL, invreq, {
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      });
      console.log('sapInvoiceResponse:', JSON.stringify(sapRes.data));
    } catch (error) {
      console.log(error?.response?.data || error.message);
    }
  } catch (error) {
    console.error('Unexpected Error:', error);
  }
}

function getsapchargecode(chargeCode, chargeCodes) {
  try {
    const found = chargeCodes.find(item =>
      item.details.carrierchatgecode === chargeCode
    );
    return found ? found.details.sapchargecode : null;
  } catch (error) {
    return null;
  }

}



module.exports = {
  processDHLInvoice
};