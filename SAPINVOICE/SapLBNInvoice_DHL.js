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
    //console.log(data);
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
    const chargeCodes = await dbCon.fetchINVChargeCodes('UPS');
    // fetch once
    const allTrackingNos = itemRows.map(row => row[columnIndex.ShipmentNumber]);
    const headerInfoByTrackingNo = await dbCon.getHeaderInfosByTrackingNos(allTrackingNos);
    const rawDateStr = headerRow[columnIndex.invoiceDate].toString();
    const formattedDate = `${rawDateStr.substring(0, 4)}-${rawDateStr.substring(4, 6)}-${rawDateStr.substring(6, 8)}`; // '2025-02-24'
    const token = await getLBNToken();
    // Loop over each item (child)
    for (const item of itemRows) {
      //  let trackingNo = item[columnIndex.ShipmentNumber];
      //  const headerInfo = await dbCon.getHeaderInfoByTrackingNo(trackingNo);
      const trackingNo = String(item[columnIndex.ShipmentNumber]);
      const headerInfo = headerInfoByTrackingNo.get(trackingNo) || null;
      // Build common header part
      const commonHeader = {
        carrierInvoiceID: headerRow[columnIndex.invoiceNumber],
        invoiceDate: reuse.formatDateTime(formattedDate), //headerRow[columnIndex.invoiceDate],
        grossAmount: headerRow[columnIndex.grossAmount],
        grossAmountCurrency: headerRow[strCurrency],
        orderingPartyLbnId: HEADER_INFO.orderingPartyLbnId, // FROM LbnFreightOrderForSubcontracting 
        carrierLbnId: HEADER_INFO.carrierLbnId,// FROM LbnFreightOrderForSubcontracting 
        baseDocumentType: '1122',// FROM LbnFreightOrderForSubcontracting 
        purchasingParty: HEADER_INFO.purchasingParty,// FROM LbnFreightOrderForSubcontracting 
        billFromParty: HEADER_INFO.billFromParty,// FROM LbnFreightOrderForSubcontracting 
        totalTaxAmount: headerRow[columnIndex.totalTaxAmount],
        taxAmountCurrency: headerRow[strCurrency],
        senderSystemId: HEADER_INFO.senderSystemId,// FROM LbnFreightOrderForSubcontracting 
      };
      const itemDetail = {

        grossAmount: item[columnIndex.grossAmount],
        grossAmountCurrency: item[strCurrency],
        freightDocumentID: HEADER_INFO.DocumentNumber, //FROM LbnFreightOrderForSubcontracting 
        // transportationItemID: "10", //FROM LbnFreightOrderForSubcontracting 
        // transportationStageID: "20", //FROM LbnFreightOrderForSubcontracting 
        pricingElements: [
          {
            lbnChargeCode: "FRT",
            rateAmount: item[columnIndex.weightCharge] || 0,
            rateAmountCurrency: item[strCurrency],
            finalAmount: item[columnIndex.weightCharge],
            finalAmountCurrency: item[strCurrency],
          },
          {
            lbnChargeCode: getsapchargecode(item[columnIndex.xc1Code], chargeCodes) || "FUEL",
            rateAmount: item[columnIndex.xc1Charge] || 0,
            rateAmountCurrency: item[strCurrency],
            finalAmount: item[columnIndex.xc1Total],
            finalAmountCurrency: item[strCurrency],
          },
          {
            lbnChargeCode: getsapchargecode(item[columnIndex.xc2Code], chargeCodes) || "NN",
            rateAmount: item[columnIndex.xc2Charge] || 0,
            rateAmountCurrency: item[strCurrency],
            finalAmount: item[columnIndex.xc2Total],
            finalAmountCurrency: item[strCurrency]
          },
          {
            lbnChargeCode: getsapchargecode(item[columnIndex.xc3Code], chargeCodes) || "YY",
            rateAmount: item[columnIndex.xc3Charge] || 0,
            rateAmountCurrency: item[strCurrency],
            finalAmount: item[columnIndex.xc3Total],
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
      try {
        const sapRes = await axios.post(process.env.INVOICE_URL, fullDetails, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
        console.log('sapInvoiceResponse:', JSON.stringify(sapRes.data));
      } catch (error) {
        console.log(error?.response?.data || error.message)
      }
    }
    return;

  } catch (error) {
    console.error('Unexpected Error:', error);
  }
}


function getsapchargecode(chargeCode, chargeCodes) {
  const found = chargeCodes.find(item =>
    item.details.carrierchatgecode === chargeCode
  );

  return found ? found.details.sapchargecode : null;
}

async function fetchChargeCodes() {

  const checkResult = await db.query(`SELECT details FROM public.chargecodes details->>'carrier' = 'UPS'`); // replace with your query
  return checkResult;
}

module.exports = {
  processDHLInvoice
};