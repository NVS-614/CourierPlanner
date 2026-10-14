const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const convert = require('xml-js');
const pool = require("../database/db.js");

const parser = new xml2js.Parser({
  explicitArray: false,  // This option prevents wrapping single values in arrays
});
const { json } = require('body-parser');
const { exit } = require('process');
const { escapeIdentifier } = require('pg');
const fedexRates = require("../CARRIER/FEDEX/FedExRateAll.js");
const upsRates = require("../CARRIER/UPS/UPSRateAll.js");
const uspsRates = require("../CARRIER/USPS/uspsRateAll.js");

const estesRates = require("../CARRIER/ESTES/estesRateAll.js");
const abfRates = require("../CARRIER/ABF/abfRateAll.js");
const rlRates = require("../CARRIER/RL/rlRateAll.js");




let date_ob = new Date();
router.post('/', async (request, response) => {

  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  // Check if request.body is an object
  if (typeof request.body === 'object') {
    xmlString = request.body.xmlData;
    if (!xmlString) {
      return response.status(400).send('XML data not found in the request.');
    }
  } else {
    // If request.body is a string, use it directly
    xmlString = request.body;
  }

  // Ensure xmlString is a string and trim it
  if (typeof xmlString !== 'string') {
    xmlString = xmlString.toString();
  }


  try {
    xmlString = xmlString.replace(/<asx:abap.*?>\s*/, '').replace(/<asx:values>/, '<values>').replace(/<\/asx:values>/, '</values>').replace(/<\/asx:abap>\s*/, '');
  } catch (error) {

  }
  xmlString = xmlString.trim();
  // Parse the XML
  parser.parseString(xmlString, (err, result) => {
    if (err) {
      console.error('Error parsing XML:', err);
      return response.status(400).send('Error parsing XML.');
    }
    request = result
  });

  console.log(request);

  //const carriercredentialres = await pool.query("SELECT * FROM public.\"CARRIER_DETAILS\""); // WHERE \"Carrier\" = 'UPS'
  const carriercredentialres = await pool.query("SELECT details 	FROM public.carrieraccounts where details->>'IsActive' = 'true'");
  //console.log(carriercredentialres.rows);

  // Filter the shipper (PARTN_ROLE == "ZZ") and shipTO (PARTN_ROLE == "WE")
  const shippers = request.TAB.item.ORDER_PARTNERS.BAPIPARNR.filter(x => x.PARTN_ROLE === 'ZZ');
  const shipTo = request.TAB.item.ORDER_PARTNERS.BAPIPARNR.find(x => x.PARTN_ROLE === 'WE');
  // Filter the items where REQ_QTY > 0
  const lstItems = (Array.isArray(request.TAB.item.ORDER_SCHEDULES_IN.BAPISCHDL)
    ? request.TAB.item.ORDER_SCHEDULES_IN.BAPISCHDL
    : [request.TAB.item.ORDER_SCHEDULES_IN.BAPISCHDL]
  ).filter(x => parseFloat(x.REQ_QTY) > 0);

  const BAPISDITM = request?.TAB?.item?.ORDER_ITEMS_IN?.BAPISDITM;
  const bapisArray = Array.isArray(BAPISDITM) ? BAPISDITM : [BAPISDITM];
  let strRequest = '[';
  for (let i = 0; i < shippers.length; i++) {
    let packItems = [];
    const packages = bapisArray.filter(x => x.SHIP_POINT === shippers[i].PARTN_NUMB);

    // Adding items from lstItems to packItems
    packages.forEach(pkg => {
      packItems = packItems.concat(lstItems.filter(item => item.ITM_NUMBER === pkg.ITM_NUMBER));
      pkg.getPerUnitWeight = function () {
        return parseFloat(this.GROSS_WGHT) / parseFloat(this.TARGET_QTY);
      };

    });

    const distDates = [...new Set(packItems.map(x => x.DLV_DATE))]; // Get distinct delivery dates

    for (let j = 0; j < distDates.length; j++) {
      let weight = 0;

      // Calculate weight for the current delivery date
      const lstDate = packItems.filter(x => x.DLV_DATE === distDates[j]);

      lstDate.forEach(item => {
        // const perUnitWeight = packages.find(itm => itm.ITM_NUMBER === item.ITM_NUMBER)?.getPerUnitWeight() ?? null;
        const packageItem = packages.find(itm => itm.ITM_NUMBER === item.ITM_NUMBER);
        const perUnitWeight = packageItem ? packageItem.getPerUnitWeight() : null;
        weight += parseFloat(item.REQ_QTY) * perUnitWeight;
      });
      // Calculate remainder and number of packages
      let remainder = weight % 68;
      let noOfPacks = Math.floor(weight / 68);
      if (remainder == 0) {
        remainder = 68
        noOfPacks = noOfPacks - 1;
      }
      strRequest += `
    {
       "HEADER_INFO": {
            "ShipDate": "${new Date().toISOString().slice(0, 19)}",
            "ShippingPoint": "${shippers[i].PARTN_NUMB}",
           "SalesOrderDate": "${distDates[j]}"
        },
        "Shipper": {
            "COMPANY": "${shippers[i].NAME}",
            "CONTACT": "${shippers[i].NAME}",
            "ADDRESS_LINE1": "${shippers[i].STREET}",
            "ADDRESS_LINE2": "",
            "ADDRESS_LINE3": "",
            "CITY": "${shippers[i].CITY}",
            "STATE": "${shippers[i].REGION}",
            "ZIPCODE": "${shippers[i].POSTL_CODE}",
            "COUNTRY": "${shippers[i].COUNTRY}",
            "PHONE": "",
            "EMAIL": ""
        },
        "ShipFrom": {
            "COMPANY": "${shippers[i].NAME}",
            "CONTACT": "${shippers[i].NAME}",
            "ADDRESS_LINE1": "${shippers[i].STREET}",
            "ADDRESS_LINE2": "",
            "ADDRESS_LINE3": "",
            "CITY": "${shippers[i].CITY}",
            "STATE": "${shippers[i].REGION}",
            "ZIPCODE": "${shippers[i].POSTL_CODE}",
            "COUNTRY": "${shippers[i].COUNTRY}",
            "PHONE": "",
            "EMAIL": ""
        },
        "ShipTo": {
            "COMPANY": "${shipTo.NAME}",
            "CONTACT": "${shipTo.NAME}",
            "ADDRESS_LINE1": "${shipTo.STREET}",
            "ADDRESS_LINE2": null,
            "ADDRESS_LINE3": "",
            "CITY": "${shipTo.CITY}",
            "STATE": "${shipTo.REGION}",
            "ZIPCODE": "${shipTo.POSTL_CODE}",
            "COUNTRY": "${shipTo.COUNTRY}",
            "PHONE": "",
            "EMAIL": ""
        },
        "Packages": [`;
      // Loop through the number of packages
      for (let k = 0; k < noOfPacks; k++) {
        strRequest += `
        {
            "Weightunits": "${packages.find(p => p)?.UNTOF_WGHT || ""}", 
            "DimensionUnits": "IN",
            "ShippingPoint": "${shippers[i].PARTN_NUMB}",
            "ItemNo": "",
            "SalesOrderDate": "${distDates[j]}",
            "Weight": "68",
            "Class":"50"
        },`;
      }
      // Add the remainder package

      strRequest += `
        {
            "Weightunits": "${packages.find(p => p)?.UNTOF_WGHT || ""}",
            "DimensionUnits": "IN",
            "ShippingPoint": "${shippers[i].PARTN_NUMB}",
            "ItemNo": "",
            "SalesOrderDate": "${distDates[j]}",
            "Weight": "${remainder}",
            "Class":"50"
           
        }]}`;


      // Close the outer object
      if (j == distDates.length) {
        strRequest += `}`;
      }
      else {
        strRequest += `,`;
      }


    }
  }

  strRequest = strRequest.slice(0, -1) + ']'; // Close the JSON string

  console.log(strRequest); // Return or further process the constructed request


  const JsonOrders = JSON.parse(strRequest);


  const CARRIER_HANDLERS = {
    FEDEX: fedexRates.getFEDEXRates,
    UPS: upsRates.getUPSRates,
    USPS: uspsRates.getUSPSRates,
    ESTES: estesRates.getESTESRates,
    ABF: abfRates.getABFRates,
    RL: rlRates.getRLRates
  };

  const RateResponse = {
    RateServices: [],
    Errors: [],
    Tokens: []
  };

  const ratePromises = [];

  // Loop through each carrier credential
  carriercredentialres.forEach(carrier => {
    const carrierName = carrier.details.CarrierName.toUpperCase();
    const carrierHandler = CARRIER_HANDLERS[carrierName];

    if (!carrierHandler) return; // skip unknown carriers

    const carrierDetails = {
      ...carrier.details,
      SHIPPING_ACCOUNT: carrier.details.Account, // standardize naming
      PaymentType: "SENDER"
    };

    // Loop through each order
    JsonOrders.forEach(order => {
      const clonedOrder = JSON.parse(JSON.stringify(order)); // deep copy to avoid mutation
      clonedOrder.CARRIER_DETAILS = carrierDetails;

      // Add promise to ratePromises
      ratePromises.push(carrierHandler(clonedOrder));
    });
  });

  Promise.all(ratePromises)
    .then(results => {
      results.forEach(result => {
        if (result.status === 'SUCCESS') {
          RateResponse.RateServices.push(...result.rates || []);
          if (result.token) {
            RateResponse.Tokens.push(result.token); // optional: collect tokens if present
          }
        } else {
          RateResponse.Errors.push(...(result.message || [result.error || "Unknown error"]));
        }
      });

      response.status(200).send(RateResponse);
    })
    .catch(error => {
      console.error('One of the promises failed:', error);
      response.status(500).send({ error: "Rate retrieval failed", details: error });
    });


});



module.exports = router;
