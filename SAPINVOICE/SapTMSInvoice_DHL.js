const express = require('express');
const router = express.Router();
const axios = require('axios');
const XLSX = require('xlsx');
const ftp = require("basic-ftp");
const dbCon = require("../database/dbsaveandupdate.js");
const fs = require("fs");
const cron = require("node-cron");
const reuse = require('../Reuse/utilityfunctions.js');
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();

const url = process.env.TMINV_URL;
const Actionurl = process.env.TMINV_ACTIONURL;
const username = process.env.TMINV_USER;
const password = process.env.TMINV_PASSWORD;

function getsapchargecode(chargeCode, chargeCodes) {
  const found = chargeCodes.find(item =>
    item.details.carrierchatgecode === chargeCode
  );

  return found ? found.details.sapchargecode : null;
}
async function getFreightOrder(trackingNo) {
  try {
    const tn = String(trackingNo ?? '').trim().replace(/'/g, "''"); // OData: escape single quotes
    if (!tn) return null;
    //const filter = `_FreightOrderDocumentReference/any(d:d/TranspOrdDocReferenceID eq '${tn}' and d/TranspOrdDocReferenceType eq 'BN')`;
    //const url = `${baseUrl}?$filter=${encodeURIComponent(filter)}`;

    const baseUrl = 'https://PCS4H2022.plutocloud.com:8443/sap/opu/odata4/sap/api_freightorder/srvd_a2x/sap/freightorder/0001/FreightOrder';

    const filter = `_FreightOrderDocumentReference/any(d:d/TranspOrdDocReferenceID eq '${tn}' and d/TranspOrdDocReferenceType eq 'BN')`;

    const sapRes = await axios.get(baseUrl, {
      headers: {
        Authorization: 'Basic ' + Buffer.from(`${process.env.TMINV_USER}:${process.env.TMINV_PASSWORD}`).toString('base64')
      },
      params: { $filter: filter }, // Axios URL-encodes properly
      timeout: 30000
    });

    return sapRes.data?.value?.[0]?.TransportationOrder ?? null;
  } catch (error) {
    console.log('Error getFreightOrder:', error?.response?.data || error.message);
    return null;
  }
}

async function processDHLInvoice() {
  try {

    const data = await reuse.readExcelFromFTP();
    if (!data || !data.length) {
      return;
    }

    const headers = data[0];
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
      xc2Code: headers.indexOf('XC2 Code'),
      xc2Charge: headers.indexOf('XC2 Charge'),
      xc3Code: headers.indexOf('XC3 Code'),
      xc3Charge: headers.indexOf('XC3 Charge')
    };
    const chargeCodes = await dbCon.fetchINVChargeCodes('UPS');
    const strCurrency = columnIndex.currency;
    const headerRow = data.find(row => row[columnIndex.lineType] === 'I');
    const itemRows = data.filter(row => row[columnIndex.lineType] === 'S');
    let totalgrossamount = 0;
    if (!headerRow) {
      console.log("No header row found with Line Type 'I'");
      return;
    }
    // Build trackingNo → FreightOrder map (one DB hit)
    const allTrackingNos = [...new Set(itemRows.map((r) => String(r[columnIndex.ShipmentNumber]).trim()))];
    const freightByTrackingNo = await dbCon.getHeaderInfosByTrackingNos(allTrackingNos); // Map<string, HEADER_INFO>

    const formattedDate = reuse.formatDateTime(headerRow[columnIndex.invoiceDate]);
    const DocumentDate = reuse.formatDateTimeyyyymmdd(headerRow[columnIndex.invoiceDate]);
    // Build XML manually (for better control)
    let xml = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:edi="http://sap.com/xi/EDI">
   <soapenv:Header xmlns:wsa="http://www.w3.org/2005/08/addressing"><wsa:Action>http://sap.com/xi/EDI/Buyer/InvoiceRequest_In/InvoiceRequest_InRequest</wsa:Action><wsa:MessageID>uuid:${uuidv4()}</wsa:MessageID><wsa:To>https://PCS4H2022.plutocloud.com:8443/sap/bc/srt/xip/sap/invoicerequest_in/800/tminv/invbind</wsa:To></soapenv:Header>
   <soapenv:Body>
      <edi:InvoiceRequest>
         <MessageHeader>
            <CreationDateTime>${formattedDate}</CreationDateTime>
         </MessageHeader>
         <Invoice>
            <SupplierInvoiceID>${headerRow[columnIndex.invoiceNumber]}</SupplierInvoiceID>
            <SupplierInvoiceTypeCode>004</SupplierInvoiceTypeCode>
            <DocumentDate>${DocumentDate}</DocumentDate>`;

    // Loop through items  itemRows.forEach(async (item, idx) => { *****Array.forEach doesn’t await your async work

    for (const [idx, item] of itemRows.entries()) {
      const trackingNo = String(item[columnIndex.ShipmentNumber]).trim();
      const fo = freightByTrackingNo.get(trackingNo) || {};
      let freightDocumentID = fo?.DocumentNumber || await getFreightOrder(trackingNo);
      if (!freightDocumentID) {
        const current = Number(headerRow[columnIndex.grossAmount] ?? 0) || 0;
        const amt = Number(String(item?.[columnIndex.grossAmount] ?? 0).replace(/[,\s₹$]/g, '')) || 0;
        totalgrossamount = Number((current - amt).toFixed(2));
      }
      else {
        xml += `
            <Item>
               <SupplierInvoiceItemID>${String(idx + 1).padStart(4, '0')}</SupplierInvoiceItemID>
               <SupplierInvoiceItemTypeCode/>
               <NetAmount currencyCode="${item[strCurrency]}">${item[columnIndex.grossAmount]}</NetAmount>`;

        // Add Pricing Elements
        if (item[columnIndex.weightCharge]) {
          xml += `
               <PricingElement>
                  <SupplierConditionType>FRT</SupplierConditionType>
                  <ConditionAmount currencyCode="${item[strCurrency]}">${item[columnIndex.weightCharge]}</ConditionAmount>
               </PricingElement>`;
        }

        if (item[columnIndex.xc1Charge]) {
          xml += `
               <PricingElement>
                  <SupplierConditionType>${getsapchargecode(item[columnIndex.xc1Code], chargeCodes) || "FUEL"}</SupplierConditionType>
                  <ConditionAmount currencyCode="${item[strCurrency]}">${item[columnIndex.xc1Charge]}</ConditionAmount>
               </PricingElement>`;
        }

        if (item[columnIndex.xc2Charge]) {
          xml += `
               <PricingElement>
                  <SupplierConditionType>${getsapchargecode(item[columnIndex.xc2Code], chargeCodes) || "NN"}</SupplierConditionType>
                  <ConditionAmount currencyCode="${item[strCurrency]}">${item[columnIndex.xc2Charge]}</ConditionAmount>
               </PricingElement>`;
        }

        if (item[columnIndex.xc3Charge]) {
          xml += `
               <PricingElement>
                  <SupplierConditionType>${getsapchargecode(item[columnIndex.xc3Code], chargeCodes) || "YY"}</SupplierConditionType>
                  <ConditionAmount currencyCode="${item[strCurrency]}">${item[columnIndex.xc3Charge]}</ConditionAmount>
               </PricingElement>`;
        }

        xml += `
               <TransportationOrderReference>
                  <TransportationOrderID>${freightDocumentID || ''}</TransportationOrderID>
               </TransportationOrderReference>
            </Item>`;
      }
    };

    xml += `
     
            <GrossAmount currencyCode="${headerRow[strCurrency]}">${totalgrossamount}</GrossAmount>
            <Party PartyType="BillFrom">
               <BuyerPartyID>UPSR</BuyerPartyID>
               <SupplierPartyID/>
            </Party>
         </Invoice>
      </edi:InvoiceRequest>
   </soapenv:Body>
</soapenv:Envelope>`;



    console.log(xml);

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

    try {
      const response = await axios.post(url, xml, {
        headers: {
          "Content-Type": "text/xml;charset=UTF-8", "SOAPAction": Actionurl,
          "Accept-Encoding": "gzip,deflate", Connection: "Keep-Alive", "User-Agent": "Apache-HttpClient/4.5.5 (Java/17.0.12)"
        },
        auth: { username, password }
      });

      console.log("Response status:", response.status);
      console.log("Response data:", response.data);
      return { status: response.status };
    } catch (error) {
      console.error("SOAP Request failed:", error.message);
      if (error.response) {

        console.error("Response code:", error.response.status);
        console.error("Response body:", error.response.data);
        return error.response.status;
      } else {
        return error.message;
      }
    }


  } catch (error) {
    console.error('Unexpected Error:', error);
  }
}

module.exports = {
  processDHLInvoice
};