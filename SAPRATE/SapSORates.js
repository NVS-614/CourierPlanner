const express = require('express');
const router = express.Router();
const axios = require('axios');
const pool = require("../database/db.js");
const dbCon = require("../database/dbsaveandupdate.js");
const xml2js = require('xml2js');
const parser = new xml2js.Parser({
  explicitArray: false,  // This option prevents wrapping single values in arrays
});

const fedexRates = require("../CARRIER/FEDEX/FedExRateAll.js");
const upsRates = require("../CARRIER/UPS/UPSRateAll.js");
const uspsRates = require("../CARRIER/USPS/uspsRateAll.js");
const estesRates = require("../CARRIER/ESTES/estesRateAll.js");
const saiaRates = require("../CARRIER/SAIA/saiaRateAll.js");
const abfRates = require("../CARRIER/ABF/abfRateAll.js");
const rlRates = require("../CARRIER/RL/rlRateAll.js");
const fedexfreightRates = require("../CARRIER/FedExFreight/FedExFreightRateAll.js");
router.post('/', async (req, response) => {
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");


  // // Check if request.body is an object
  // if (typeof request.body === 'object') {
  //   xmlString = request.body.xmlData;
  //   if (!xmlString) {
  //     return response.status(400).send('XML data not found in the request.');
  //   }
  // } else {
  //   // If request.body is a string, use it directly
  //   xmlString = request.body;
  // }

  // // Ensure xmlString is a string and trim it
  // if (typeof xmlString !== 'string') {
  //   xmlString = xmlString.toString();
  // }


  // try {
  //   xmlString = xmlString.replace(/<asx:abap.*?>\s*/, '').replace(/<asx:values>/, '<values>').replace(/<\/asx:values>/, '</values>').replace(/<\/asx:abap>\s*/, '');
  // } catch (error) {

  // }
  // xmlString = xmlString.trim();
  // // Parse the XML
  // parser.parseString(xmlString, (err, result) => {
  //   if (err) {
  //     console.error('Error parsing XML:', err);
  //     return response.status(400).send('Error parsing XML.');
  //   }
  //   request = result
  // });

  const request = req.body;
  try {
    console.log(JSON.stringify(request));
  } catch (error) {
    console.log(error.message)
  }
  let logEntry =
  {
    id: 0,
    carrier: 'ALL',
    dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
    endpointURL: "/api/SapxSalesOrderRates",
    eventType: "SAP-SIG",
    request: JSON.stringify(request),
    response: '',
    statusCode: ''
  }
  const uniqueid = await dbCon.dbSAP_RATEALL_transactionssave(logEntry);

  //const carriercredentialres = await pool.query("SELECT * FROM public.\"CARRIER_DETAILS\""); // WHERE \"Carrier\" = 'UPS'
  // const carriercredentialres = await pool.query("SELECT details 	FROM public.carrieraccounts where details->>'IsActive' = 'true'");
  //console.log(carriercredentialres.rows);

  // Filter the shipper (PARTN_ROLE == "ZZ") and shipTO (PARTN_ROLE == "WE")
  const shippers = request.TAB.item.ORDER_PARTNERS.BAPIPARNR.filter(x => x.PARTN_ROLE === 'ZZ');
  const shipTo = request.TAB.item.ORDER_PARTNERS.BAPIPARNR.find(x => x.PARTN_ROLE === 'WE');

  const Accessorials = request.TAB?.Accessorials;

  const specialServices = {
    FedExOneRate: false,
    SaturdayPickup: false,
    SaturdayDelivery: false,
    InsidePickup: false,
    InsideDelivery: false,
    CallBeforeDelivery: false,
    DeliveryNotification: false,
    DeliveryAppointment: false,
    Hazmat: false,
    ResidentialDelivery: false,
    PriorityAlert: false,
    LiftGatePickup: false,
    LiftGateDelivery: false,
    LimitedAccessPickup: false,
    LimitedAccessDelivery: false,
  };

  const mapping = {
    SATURDAY_PICKUP: "SaturdayPickup",
    SATURDAY_DELIVERY: "SaturdayDelivery",
    INSIDE_PICKUP: "InsidePickup",
    INSIDE_DELIVERY: "InsideDelivery",
    ARRIVAL_NOTIFICATION: "DeliveryNotification",
    CALL_BEFOREDELIVERY: "CallBeforeDelivery",
    DELIVERY_APPOINTMENT: "DeliveryAppointment",
    DG: "Hazmat",
    RESIDENTIAL_DELIVERY: "ResidentialDelivery",
    PRIORITY_ALERT: "PriorityAlert",
    LIFTGATE: "LiftGatePickup",
    LIMITED_ACCESS: "LimitedAccessDelivery",
  };
  if (Accessorials) {
    for (const [inputKey, targetKey] of Object.entries(mapping)) {
      if (Accessorials[inputKey] === "X") {
        specialServices[targetKey] = true;
      }
    }
  }
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
      // Calculate remainder and number of packages //"${new Date().toISOString().slice(0, 19)}",
      let remainder = weight % 68;
      let noOfPacks = Math.floor(weight / 68);
      if (remainder == 0) {
        remainder = 68
        noOfPacks = noOfPacks - 1;
      }
      strRequest += `
    {
       "HEADER_INFO": {
            "id": "${uniqueid}",
            "ShipDate": "${distDates[j]}",
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
        "SHIPMENT_LVL_SPECIAL_SERVICES": ${JSON.stringify(specialServices)},
       
        "Packages": [`;
      // Loop through the number of packages  //${packages.find(p => p)?.UNTOF_WGHT || ""}
      for (let k = 0; k < noOfPacks; k++) {
        strRequest += `
        {
            "Weightunits": "LB", 
            "DimensionUnits": "IN",
            "ShippingPoint": "${shippers[i].PARTN_NUMB}",
            "ItemNo": "",
            "SalesOrderDate": "${distDates[j]}",
            "Weight": "68",
            "Class":"50"
        },`;
      }
      // Add the remainder package //"Weightunits": "${packages.find(p => p)?.UNTOF_WGHT || ""}",

      strRequest += `
        {
            "Weightunits": "LB", 
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

  const chargeCodeData = await dbCon.fetchChargeCodes();

  const CARRIER_HANDLERS = {
    FEDEX: fedexRates.getFEDEXRates,
    UPS: upsRates.getUPSRates,
    USPS: uspsRates.getUSPSRates,
    ESTES: estesRates.getESTESRates,
    SAIA: saiaRates.getSAIARates,
    ABF: abfRates.getABFRates,
    RL: rlRates.getRLRates,
    FEDEXFREIGHT: fedexfreightRates.getFedExFreightRates,
  };

  const RateResponse = {
    RateServices: [],
    Errors: [],
    Tokens: []
  };

  //const token = await gettoken('https://shipv2_xcservices.cfapps.eu10-004.hana.ondemand.com/User', 'venkat', 'rvs@Pc01');

  try {
    // Fetch active carriers from DB
    const carriercredentialres = await pool.query(`
      SELECT details
      FROM public.carrieraccounts
      WHERE details->>'IsActive' = 'true'
    `);

    // Build a map for quick lookup
    const activeCarriersMap = {};
    carriercredentialres.forEach(carrier => {
      const carrierName = carrier.details.CarrierName.toUpperCase();
      activeCarriersMap[carrierName] = {
        ...carrier.details,
        SHIPPING_ACCOUNT: carrier.details.Account,
        PaymentType: "SENDER"
      };
    });

    // Step 1: Call routing API in parallel for all orders
    // const routingResults = await Promise.all(
    //   JsonOrders.map(order =>
    //     axios.post(
    //       "https://shipv2_xcservices.cfapps.eu10-004.hana.ondemand.com/processRoutingRules/",
    //       order, {
    //       headers: {
    //         'x-token': token
    //       },
    //     }
    //     ).then(res => ({ order, routing: res.data }))
    //       .catch(err => ({ order, error: err.message }))
    //   )
    // );

    // Step 2: Build rate promises based on routing response
    const ratePromises = [];

    // routingResults.forEach(({ order, routing, error }) => {
    //   if (error) {
    //     RateResponse.Errors.push(`Routing API failed: ${error}`);
    //     return;
    //   }

    //   // Flatten all carrierDetails from the routing array
    //   const carrierDetailsList = routing
    //     ?.flatMap(r => r?.details?.shippingProcess?.carrierDetails || []) || [];

    //   //Extract unique carrier names (case-insensitive)
    //   const carrierNamesFromRouting = [
    //     ...new Set(carrierDetailsList.map(cd => cd.CarrierName.toUpperCase()))
    //   ];


    //   // For each carrier from routing, check DB active list and push rate call
    //   carrierNamesFromRouting.forEach(carrierName => {
    //     const carrierDetails = activeCarriersMap[carrierName];
    //     const carrierHandler = CARRIER_HANDLERS[carrierName];

    //     if (carrierDetails && carrierHandler) {
    //       const clonedOrder = JSON.parse(JSON.stringify(order));
    //       clonedOrder.CARRIER_DETAILS = carrierDetails;
    //       ratePromises.push(carrierHandler(clonedOrder));
    //     }
    //   });
    // });

    JsonOrders.forEach(order => {

      const carrierNamesFromRouting = ['FEDEX', 'UPS', 'RL', 'ABF', 'ESTES', 'FEDEXFREIGHT','SAIA']
      // For each carrier from routing, check DB active list and push rate call
      carrierNamesFromRouting.forEach(carrierName => {
        const carrierDetails = activeCarriersMap[carrierName];
        const carrierHandler = CARRIER_HANDLERS[carrierName];

        if (carrierDetails && carrierHandler) {
          const clonedOrder = JSON.parse(JSON.stringify(order));
          clonedOrder.CARRIER_DETAILS = carrierDetails;
          clonedOrder.chargeCodeData = chargeCodeData;
          ratePromises.push(carrierHandler(clonedOrder));
        }
      });
    });

    // Step 3: Execute all rate calls in parallel
    const results = await Promise.all(ratePromises);

    results.forEach(result => {
      if (result.status === 'SUCCESS') {
        RateResponse.RateServices.push(...(result.rates || []));
        if (result.token) {
          RateResponse.Tokens.push(result.token);
        }
      } else {
        RateResponse.Errors.push(
          ...(result.message || [result.error || "Unknown error"])
        );
      }
    });
    response.status(200).send(RateResponse);
  } catch (err) {
    console.error('Processing failed:', err);
    response.status(500).send({ error: "Rate retrieval failed", details: err.message });
  }
});


async function gettoken(url, user, password) {
  try {
    const sres = await axios.post(url, {
      "login": user,
      "password": password
    }, {
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
    });

    return sres.data.key;
  } catch (ex) {

    throw new Error(ex);
  }
}

module.exports = router;
