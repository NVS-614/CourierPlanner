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
const FedExShip = require("../CARRIER/FEDEX/SapFedEx.js");

router.post('/', async (request, response) => {

    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

    // Check if request.body is an object
    if (typeof request.body === 'object') {
        xmlString = request.body.xmlData;
        if (!xmlString) {
            return res.status(400).send('XML data not found in the request.');
        }
    } else {
        // If request.body is a string, use it directly
        xmlString = request.body;
    }

    // Ensure xmlString is a string and trim it
    if (typeof xmlString !== 'string') {
        xmlString = xmlString.toString();
    }


    try {  //<n0:TransportationOrderGenericRequest xmlns:n0="http://sap.com/xi/SAPGlobal20/Global" xmlns:prx="urn:sap.com:proxy:J03:/1SAI/TAS7D5BCC4C0558D06D798D:912">

        xmlString = xmlString.replace(/<n0:/g, '<').replace(/<\/n0:/g, '</');
        xmlString = xmlString.replace('xmlns:n0="http://sap.com/xi/SAPGlobal20/Global"', '').replace('xmlns:prx="urn:sap.com:proxy:J03:/1SAI/TAS7D5BCC4C0558D06D798D:912"', '');
    } catch (error) {

    }
    xmlString = xmlString.trim();
    // Parse the XML
    parser.parseString(xmlString, (err, result) => {
        if (err) {
            console.error('Error parsing XML:', err);
            return res.status(400).send('Error parsing XML.');
        }
        request = result
    });

    const shipper = request.TransportationOrderGenericRequest.TransportationOrder.TransportationStage.MainLoadingLocation.Address.PhysicalAddress;
    const shipTo = request.TransportationOrderGenericRequest.TransportationOrder.TransportationStage.MainUnloadingLocation.Address.PhysicalAddress;
    let noOfPacks = (request.TransportationOrderGenericRequest.TransportationOrder.TransportationStage.ItemAssignment.length);
    const itempackages = request.TransportationOrderGenericRequest.TransportationOrder.Item || [];
    const packages = request.TransportationOrderGenericRequest.TransportationOrder.TransportationStage.ItemAssignment || [];
    //console.log(itempackages);
    //console.log('packages' , packages);
    let packItems = [];
    packages.forEach(pkg => {
        packItems = packItems.concat(itempackages.filter(x => x.ID === pkg.ItemID));

    });
    //console.log('packItems' ,packItems);
    let requestPayload = [];

    let packageData = {
        Shipper: formatAddress(shipper),
        ShipTo: formatAddress(shipTo),
        Packages: createPackagesArray(noOfPacks, packItems)
    };


    requestPayload.push(packageData);

    // response.send(strRequest);
    const jsonObject = JSON.parse(JSON.stringify(requestPayload));

    


    //const res = await pool.query("SELECT * FROM public.\"CARRIER_DETAILS\""); // WHERE \"Carrier\" = 'UPS'
    //   try {
    //     const res = await pool.query("SELECT details 	FROM public.carrieraccounts where details->>'IsActive' = 'true'");
    //     console.log(res.rows);
    //   } catch (error) {
    //     console.log(error.message);
    //   }
    //response.send(jsonObject).status(200);

    var ShipAll = [];
    var ShipResponse = {}
    ShipResponse['Errors'] = [];

    jsonObject.forEach(Ship => {
        Ship["CARRIER_DETAILS"] = {
            "Carrier": "FEDEX",
            "ServiceName": "FEDEX_GROUND",
            "PaymentType": "Sender",
            "SHIPPING_ACCOUNT": "740561073",
            "USERID": "l7e48144d986db4a25a418bcb9a186383e",
            "PASSWORD": "d73181e3e6044eba83160516b0e8d987"
        };
       
        ShipAll.push(FedExShip.SapFedEx(Ship))
    });



    Promise.all(ShipAll)
    .then(results => {
  
      results.forEach(carrierresponse => {
        if (carrierresponse.status.toUpperCase() == 'SUCCESS') {
            ShipResponse =carrierresponse
                  }
        else {
            carrierresponse.message.forEach(er => {
            ShipResponse.Errors.push(er);
          });

        }
             })
    
      response.send(ShipResponse).status(200);
    })
    .catch((error) => {
      response.send(error);
      console.error('One of the promises failed:', error);
    });

});

function createPackagesArray(noOfPacks, packages) {
    let packageArray = [];

    for (let i = 0; i < noOfPacks; i++) {
        if (packages[i]?.GrossWeightTransportationQuantity._) {
            packageArray.push({
                Weightunits: packages[i]?.GrossWeightTransportationQuantity.$.unitCode || '',
                DimensionUnits: "IN",

                Description: packages[i]?.DESCRIPTION,
                Weight: packages[i]?.GrossWeightTransportationQuantity._
            });
        }
    }

    return packageArray;
}
// Helper function to format the address object
function formatAddress(addressObj) {
    return {
        COMPANY: addressObj?.HouseID || '',
        CONTACT: addressObj?.HouseID || '',
        ADDRESS_LINE1: addressObj?.StreetName || '',
        ADDRESS_LINE1: addressObj?.HouseID || '',
        CITY: addressObj?.CityName || '',
        STATE: addressObj?.RegionCode || '',
        ZIPCODE: addressObj?.StreetPostalCode || '',
        COUNTRY: addressObj?.CountryCode || '',
        PHONE: '',
        EMAIL: ''
    };
}
module.exports = router;
