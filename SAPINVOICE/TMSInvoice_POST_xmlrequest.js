const express = require('express');
const router = express.Router();
const axios = require('axios');
const dbCon = require("../database/dbsaveandupdate.js");
require("dotenv").config();

const url = process.env.TMINV_URL;
const Actionurl = process.env.TMINV_ACTIONURL;
const username = process.env.TMINV_USER;
const password = process.env.TMINV_PASSWORD;

async function TMSInvoicePOSTxml(xml) {
  try {
    console.log(xml);
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
    return error.message;
  }
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

function yyyymmddToIso(yyyymmdd) {
  if (!yyyymmdd || yyyymmdd.length !== 8) return null;
  const yyyy = yyyymmdd.slice(0, 4);
  const mm = yyyymmdd.slice(4, 6);
  const dd = yyyymmdd.slice(6, 8);
  return `${yyyy}-${mm}-${dd}`;
}
function getsapchargecode(chargeCode, chargeCodes) {
  const found = chargeCodes.find(item =>
    item.details.carrierchatgecode === chargeCode
  );

  return found ? found.details.sapchargecode : null;
}
//Utility: safe number from any string
const toNum = (v) => {
  if (v == null) return null;
  const n = Number(String(v).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : null;
};
module.exports = { TMSInvoicePOSTxml, getFreightOrder, yyyymmddToIso, toNum, getsapchargecode };