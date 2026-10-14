const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const xml2js = require('xml2js');
const convert = require('xml-js');
const pool = require("../database/db.js");
const dbCon = require("../database/dbsaveandupdate.js");
const parser = new xml2js.Parser({
  explicitArray: false,  // This option prevents wrapping single values in arrays
});
const { json } = require('body-parser');
const { exit } = require('process');
const { escapeIdentifier } = require('pg');
const FedExRates = require("../CARRIER/FEDEX/FedExRateAll.js");
const uspsRates = require("../CARRIER/USPS/uspsRateAll.js");
const upsRates = require("../CARRIER/UPS/UPSRateAll.js");
const abfRates = require("../CARRIER/ABF/abfRateAll.js");

let date_ob = new Date();
router.post('/', async (request, response) => {

  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  const orderId = request.body.FO_Number;
  const FOrateurl = process.env.FORATE_URL.replace('##FONUMBER##', orderId)
  let payloaddata = await axios.get(FOrateurl, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${process.env.FO_ID}:${process.env.FO_PASSWORD}`).toString('base64'),

      Accept: 'application/json',
    },
  }).catch((ex) => {
    console.log('----Res Exception is...: ')
    console.log(ex.response.data)
    var errorres = {};
    errorres['status'] = 'Error';
    errorres['Errors'] = [];
    errorres.Errors.push(ex.response.data.message);
    response.send(errorres).status(400);
    return; // Stop further execution
  });

  payload = payloaddata.data.value[0];

  const shipper = payload._ShipperAddrDfltRprstn;
  const shipTo = payload._ConsigneeAddrDfltRprstn;
  let noOfPacks = 1;
  const packages = payload._FreightOrderItem || [];
  let packItems = packages.filter(item =>
    item.TranspOrdItemType === "PACK"
  );

  if (!packItems || packItems.length === 0) {
    let totalWeight = 0;
    let weightUnit = '';
    for (const item of packages) {
      if (item.TranspOrdItemGrossWeight && item.TranspOrdItemGrossWeightUnit) {
        totalWeight += item.TranspOrdItemGrossWeight;
        if (!weightUnit) {
          weightUnit = item.TranspOrdItemGrossWeightUnit;
        }
      }
    }
    packItems = [{
      "TranspOrdItemGrossWeight": totalWeight,
      "TranspOrdItemGrossWeightUnit": weightUnit,
    }]
  }
  //console.log('packItems', packItems);
  let requestPayload = [];

  let packageData = {
    Shipper: formatAddress(shipper),
    ShipTo: formatAddress(shipTo),
    Packages: createPackagesArray(packItems),
    HEADER_INFO: {
      ShipDate: new Date().toISOString().slice(0, 19)

    },
  };


  requestPayload.push(packageData);

  // response.send(strRequest);
  const jsonObject = JSON.parse(JSON.stringify(requestPayload));
  var Carriers = [];
  //response.send(jsonObject).status(200);


  //const res = await pool.query("SELECT * FROM public.\"CARRIER_DETAILS\""); // WHERE \"Carrier\" = 'UPS'
  // try {
  //   const res = await pool.query("SELECT details 	FROM public.carrieraccounts where details->>'IsActive' = 'true'");
  //   console.log(res.rows);
  // } catch (error) {
  //   console.log(error.message);
  // }
  //response.send(jsonObject).status(200);
  var getreq = {
    login: "venkat",
    password: "rvs@Pc01",
    carrier: ""
  };
  Carriers = await axios.post('https://shipv2_xcservices.cfapps.eu10-004.hana.ondemand.com/lbn', getreq, {
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
  }).catch((ex) => {
    console.log('----Res Exception is...: ')
    console.log(ex.response.data)
    var errorres = {};
    errorres['status'] = 'Error';
    errorres['Errors'] = [];
    errorres.Errors.push(ex.response.data.message);
    response.send(errorres).status(400);
    return; // Stop further execution
  });

  const chargeCodeData = await dbCon.fetchChargeCodes();
  if (!Carriers || !Carriers.data) return;

  //  console.log('Carriers', Carriers.data);

  var RateResponse = {};
  RateResponse['RateServices'] = [];
  RateResponse['Errors'] = [];
  RateResponse['Tokens'] = [];
  var rateall = [];

  Carriers.data.forEach(element => {
    if (element.details?.CarrierName?.toUpperCase() === "FEDEX" & element.details.IsActive === true) {
      jsonObject.forEach(rate => {
        rate["CARRIER_DETAILS"] = formatCarrierData(element.details)
        rateall.push(FedExRates.getFEDEXRates(rate))
      });
    }
    else if (element.details.CarrierName === "UPS" & element.details.IsActive === true) {
      jsonObject.forEach(rate => {
        rate["CARRIER_DETAILS"] = formatCarrierData(element.details);
        rate.chargeCodeData = chargeCodeData;
        rateall.push(upsRates.getUPSRates(rate))
      });

    }
    // else if (element.details.CarrierName == "USPS") { rateall.push(uspsRates.getUSPSRates(request)) }
    // else if (element.details.CarrierName == "ABF") { rateall.push(abfRates.getABFRates(request)) }

  });


  Promise.all(rateall)
    .then(results => {
      //console.log('results:', results);
      results.forEach(rateservice => {
        if (rateservice.status == 'SUCCESS') {

          rateservice.rates.forEach(service => {
            RateResponse.RateServices.push(service);
          });

        }
        else {
          rateservice.message.forEach(er => {
            RateResponse.Errors.push(er);
          });

        }
        try {
          //  RateResponse.Tokens.push(rateservice.Tokens);
        } catch (ex) { }

      })
      //  const xml = convert.json2xml(RateResponse, { compact: true, spaces: 4 });
      // response.send('<Response>' + xml + '</Response>').status(200);
      response.send(RateResponse).status(200);
    })
    .catch((error) => {
      response.send(error);
      console.error('One of the promises failed:', error);
    });


});



function createPackagesArray(packages) {
  let packageArray = [];

  for (let i = 0; i < packages.length; i++) {
    if (packages[i]?.TranspOrdItemGrossWeightUnit) {
      packageArray.push({
        Weightunits: packages[i]?.TranspOrdItemGrossWeightUnit || '',
        DimensionUnits: "IN",
        Description: packages[i]?.TranspOrdItemDesc,
        Weight: packages[i]?.TranspOrdItemGrossWeight
      });
    }
  }
  return packageArray;
}
// Helper function to format the address object
function formatAddress(addressObj) {
  return {
    COMPANY: addressObj?.AddresseeFullName || '',
    CONTACT: addressObj?.HouseID || '',
    ADDRESS_LINE1: addressObj?.StreetName || '',
    ADDRESS_LINE1: addressObj?.HouseNumber || '',
    CITY: addressObj?.CityName || '',
    STATE: addressObj?.Region || '',
    ZIPCODE: addressObj?.PostalCode || '',
    COUNTRY: addressObj?.Country || '',
    PHONE: addressObj?.InternationalPhoneNumber || '',
    EMAIL: addressObj?.EmailAddress || '',
  };
}
function formatCarrierData(element) {
  return {
    Carrier: element.CarrierName,
    ServiceName: "",
    PaymentType: "Sender",
    SHIPPING_ACCOUNT: element.Account,
    BillingAccount: element.Account,
    BillingCountry: "",
    BillingZipCode: "",
    USERID: element.USERID,
    PASSWORD: element.PASSWORD
  };
}
module.exports = router;
