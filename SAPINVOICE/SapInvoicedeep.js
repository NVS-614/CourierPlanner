const express = require('express');
const router = express.Router();
const axios = require('axios');
const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

router.post('/', async (request, response) => {
  try {
    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");


    let bn4tdata = ''
    try {
      const input = `grant_type=client_credentials&client_id=sb-83f5edc3-a3f4-45f3-adbe-d068cb10a71e!b368405|it-rt-bn4lintegrationsuiteliveeu10-d2q5jmpt!b182722&client_secret=b9164b0d-8764-4b52-9583-5fc0180533e3$nlvj08C49CXynQ--aMi8cB1zaqTmLV5ONMLKew7ccxI=`;

      bn4tdata = await axios.post(
        'https://bn4lintegrationsuiteliveeu10-d2q5jmpt.authentication.eu10.hana.ondemand.com/oauth/token',
        input,
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
          },
        }
      );

      if (!bn4tdata || !bn4tdata.data) {
        return response.status(400).json({ error: "Sap Auth fail" });
      }


    } catch (ex) {
      console.log('----------Res token Exception is...: ');
      console.log(ex);

      let errorres = {
        status: 'Error',
        Errors: []
      };

      if (ex?.response?.data?.Errors) {
        ex.response.data.Errors.forEach((er) => {
          errorres.Errors.push(er.ErrorMessage);
        });
      } else {
        errorres.Errors.push(ex?.response?.data?.error_description || ex.message);
      }

      // Ensure the response is only sent once
      return response.status(400).json(errorres);
    }

    const workbook = XLSX.readFile('DHL.xlsx');
    const worksheet = workbook.Sheets[workbook.SheetNames[0]];
    const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

       const mappingPath = path.join(__dirname, `Invoice_fields_mappingInstructions.json`);
    const mappingInstructions = JSON.parse(fs.readFileSync('Invoice_fields_mappingInstructions.json', 'utf8'));

    // Process each sheet
    const results = {};
    workbook.SheetNames.forEach(sheetName => {
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      
      // Determine carrier type from sheet name
      let carrierType = sheetName.split(' ')[0]; // "DHL Invoice" -> "DHL"
      if (!mappingInstructions[carrierType]) carrierType = 'DHL'; // default
      
      const mapping = mappingInstructions[carrierType];
      const headers = data[0];
      
      // Helper function to get value based on mapping
      const getValue = (row, mapping) => {
        if (typeof mapping === 'string') {
          const colIndex = headers.indexOf(mapping);
          return colIndex !== -1 ? row[colIndex] : null;
        } else if (mapping.fieldname) {
          const colIndex = headers.indexOf(mapping.fieldname);
          return colIndex !== -1 ? row[colIndex] : (mapping.default || null);
        } else if (mapping.value) {
          return mapping.value;
        }
        return null;
      };

      // Get header row (if applicable)
      const headerRow = mapping.items?.rowtype 
        ? data.find(row => row[headers.indexOf('Line Type')] === mapping.items.rowtype)
        : data[0];

      // Get item rows (if applicable)
      const itemRows = mapping.items?.rowtype 
        ? data.filter(row => row[headers.indexOf('Line Type')] === mapping.items.rowtype)
        : data.slice(1); // skip header

      // Build the JSON structure
      const invreq = {};

      // Process root level fields
      Object.keys(mapping).forEach(key => {
        if (key !== 'items') {
          if (typeof mapping[key] === 'object' && !Array.isArray(mapping[key])) {
            invreq[key] = getValue(headerRow, mapping[key]);
          } else if (typeof mapping[key] === 'string') {
            invreq[key] = mapping[key];
          }
        }
      });

      // Process items
      if (mapping.items) {
        invreq.items = itemRows.map(itemRow => {
          const item = {};
          
          // Process item level fields
          Object.keys(mapping.items).forEach(key => {
            if (key !== 'pricingElements' && key !== 'rowtype') {
              if (typeof mapping.items[key] === 'object' && !Array.isArray(mapping.items[key])) {
                item[key] = getValue(itemRow, mapping.items[key]);
              } else if (typeof mapping.items[key] === 'string') {
                item[key] = mapping.items[key];
              }
            }
          });

          // Process pricing elements
          if (mapping.items.pricingElements) {
            item.pricingElements = mapping.items.pricingElements.map(peMapping => {
              const pe = {};
              Object.keys(peMapping).forEach(peKey => {
                pe[peKey] = getValue(itemRow, peMapping[peKey]);
              });
              return pe;
            }).filter(pe => {
              // Filter out pricing elements with no amount
              return (pe.rateAmount && pe.rateAmount > 0) || 
                     (pe.finalAmount && pe.finalAmount > 0);
            });
          }

          return item;
        });
      }

      results[sheetName] = invreq;
    });

    console.log(JSON.stringify(results, null, 2));
    response.json(results);

    
  } catch (error) {
    console.error('Unexpected Error:', error);
    return response.status(500).json({ error: "Internal server error" });
  }

});

module.exports = router;