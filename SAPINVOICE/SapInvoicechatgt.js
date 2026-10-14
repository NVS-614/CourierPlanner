const express = require('express');
const router = express.Router();
const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');
const { getLBNToken } = require('../Reuse/LBNTokenManager.js');

router.post('/', async (request, response) => {
  try {
    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

    const token = await getLBNToken();

    const mappingPath = path.join(__dirname, `DHL_Invoice_fields_mappingInstructions.json`);
    const workbook = XLSX.readFile('DHL.xlsx');
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

    const mapping = JSON.parse(fs.readFileSync(mappingPath, 'utf8'));

    const headers = data[0];
    const columnIndex = {};
    headers.forEach((header, idx) => {
      columnIndex[header] = idx;
    });

    const findRow = (type) => data.find(row => row[columnIndex['Line Type']] === type);
    const findRows = (type) => data.filter(row => row[columnIndex['Line Type']] === type);

    const getValue = (field, row) => {
      if (field.Default) return field.fieldname;
      const colName = field.fieldname || field.filedname;
      let val = row[columnIndex[colName]];

      if (field.format && typeof val === 'string') {
        const parsed = moment(val, [field.format, moment.ISO_8601]);
        return parsed.isValid() ? parsed.format('YYYYMMDD') : val;
      }

      return val;
    };

    const headerRow = findRow('I');
    const invreq = {};

    // Top-level fields
    for (const key in mapping) {
      if (key !== 'items') {
        invreq[key] = getValue(mapping[key], headerRow);
      }
    }

    const itemRows = findRows('S');
    invreq.items = itemRows.map(row => {
      const item = {};
      const itemMap = mapping.items[0];

      for (const key in itemMap) {
        if (key !== 'pricingElements') {
          item[key] = getValue(itemMap[key], row);
        }
      }

      item.pricingElements = itemMap.pricingElements.map(peMap => {
        const pe = {};
        for (const key in peMap) {
          pe[key] = getValue(peMap[key], row);
        }
        return pe;
      }).filter(pe => pe.rateAmount > 0);

      return item;
    });

    console.log(JSON.stringify(invreq, null, 2));

    return invreq;

    try {
      const sapRes = await axios.post(
        `https://api.logistics.eu.business-network.cloud.sap/http/v1/LogisticsInvoice`,
        invreq,
        {
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` }
        }
      );

      return response.status(200).json(sapRes.data);
    } catch (error) {
      console.error('SAP API Error:', error.response?.data);
      return response.status(500).json({ error: "SAP API request failed" });
    }








  } catch (error) {
    console.error('Unexpected Error:', error);
    return response.status(500).json({ error: "Internal server error" });
  }

});

module.exports = router;