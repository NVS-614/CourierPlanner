const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const logEmitter = require("../Reuse/Logger.js");
const dbCon = require("../database/dbsaveandupdate.js");
const FedExShip = require("../CARRIER/FEDEX/SapFedEx.js");
const rlShip = require("../CARRIER/RL/SapRL.js");
const upsShip = require("../CARRIER/UPS/SapUPS.js");
const dhlShip = require("../CARRIER/DHL/SapDHL.js");
const abfShip = require("../CARRIER/ABF/SapABF.js");
const db = require('../database/db');
const xml2js = require('xml2js');
const ewmdata = require("../SHIPCORE/bulk-ewm-shipcore-job.js");


let serviceMapList = null;
let CarrierCredentialsData = null;
let dbcarrier = ''
apiClient = axios.create({
  timeout: 30000,
  headers: {
    Authorization: 'Basic ' + Buffer.from(`${process.env.FO_ID}:${process.env.FO_PASSWORD}`).toString('base64')
  }
});


// Usage example
router.post('/', async (request, response) => {
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  serviceMapList = await dbCon.fetchCarrierServiceCodes();
  CarrierCredentialsData = await dbCon.fetchCarrierCredentials();
  try {
    // Step 1: Call API1 to get the outbound delivery orders
    const api1Response = await callAPI1(process.env.GET_DELIVERYNO_URL);
    const deliveryOrders = api1Response.value;

    console.log(`Found ${deliveryOrders.length} delivery orders to process`);

    // Step 2: Process each delivery order sequentially
    const results = [];
    for (const order of deliveryOrders) {
      try {
        console.log(`Processing order: ${order.EWMOutboundDeliveryOrder}`);
        if (order.EWMOutboundDeliveryOrder === '80000058') {
          const processedOrder = await processSingleOrder(order.EWMOutboundDeliveryOrder, order.SalesOrganization);
          results.push(processedOrder);
        }


      } catch (orderError) {
        console.error(`Error processing order ${order.EWMOutboundDeliveryOrder}:`, orderError.message);
        results.push({
          EWMOutboundDeliveryOrder: order.EWMOutboundDeliveryOrder,
          error: orderError.message,
          status: 'failed'
        });
      }
    }
    return response.status(200).send(results);

  } catch (error) {
    console.error('Batch processing failed:', error);
    return response.status(200).send(error.message);

  }
});


async function processSingleOrder(EWMOutboundDeliveryOrder, PlantID) {
  try {

    HEADER_INFO = {
      FeederSystem: "",
      DocumentNumber: EWMOutboundDeliveryOrder,
      DocumentType: "Delivery",
      ShipDate: new Date().toISOString(),
      ShipmentType: "",
      Location: PlantID,
      ERP: "SAP EWM"
    }
    ShipFrom =
    EWMOutboundDeliveryOrder = '80000058'
    // Step 3: Call DeliveryAddress, HUpackInfo, CarrierSupplier in parallel
    // If ANY of these fail, Promise.all will reject immediately
    const [DeliveryAddressResponse, HUpackInfoResponse, CarrierSupplierResponse] = await Promise.all([
      callDeliveryAddress(EWMOutboundDeliveryOrder),
      callHUpackInfo(EWMOutboundDeliveryOrder),
      callCarrierSupplier(EWMOutboundDeliveryOrder)
    ]);

    // Step 4-6: Process responses

    const address = await extractAddressFromDeliveryAddress(DeliveryAddressResponse);
    const Packages = prepareHandlingUnitsFromHU(HUpackInfoResponse);
    const supplier = await extractSupplierFromSupplier(CarrierSupplierResponse);
    // Step 7: Combine all data
    return {
      HEADER_INFO,
      CARRIER_DETAILS: supplier,
      ShipFrom,
      ShipTo: address,
      PACKAGES,
      processedAt: new Date().toISOString(),
      status: 'success'
    };

  } catch (error) {
    console.error(`Failed to process order ${EWMOutboundDeliveryOrder}:`, error.message);
    throw new Error(`Order ${EWMOutboundDeliveryOrder} processing failed: ${error.message}`);
  }
}

// API Call Methods
async function callAPI1(url) {
  try {
    const response = await apiClient.get(url);
    return response.data;
  } catch (error) {
    throw new Error(`API1 call failed: ${error.message}`);
  }
}

async function callDeliveryAddress(deliveryOrder) {
  try {
    const response = await apiClient.get(process.env.GET_ELIVERYADDRESS_URL.replace('##DELIVERYNO##', deliveryOrder));
    return response.data;
  } catch (error) {
    throw new Error(`DeliveryAddress call failed for order ${deliveryOrder}: ${error.message}`);
  }
}

async function callHUpackInfo(deliveryOrder) {
  try {
    const response = await apiClient.get(process.env.GET_DELIVERYHU_URL.replace('##DELIVERYNO##', deliveryOrder));
    return response.data;
  } catch (error) {
    throw new Error(`HUpackInfo call failed for order ${deliveryOrder}: ${error.message}`);
  }
}

async function callCarrierSupplier(deliveryOrder) {
  try {
    const response = await apiClient.get(process.env.GET_DELIVERYCARRIER_URL.replace('##DELIVERYNO##', deliveryOrder));
    return response.data;
  } catch (error) {
    throw new Error(`CarrierSupplier call failed for order ${deliveryOrder}: ${error.message}`);
  }
}

// Response Processing Methods
async function extractSupplierFromSupplier(SupplierResponse) {
  try {
    //console.log('SupplierResponse :', JSON.stringify(SupplierResponse, null, 2));

    // Handle both string and object responses
    const data = typeof SupplierResponse === 'string'
      ? JSON.parse(SupplierResponse)
      : SupplierResponse;

    if (!data.d.results || !Array.isArray(data.d.results)) {
      throw new Error('No results array found in DeliveryAddress response');
    }

    // Find entry with PartnerFunction 'CR'
    const crEntry = data.d.results.find(entry =>
      entry.PartnerFunction === 'CR'
    );

    if (!crEntry) {
      throw new Error('No entry found with PartnerFunction CR');
    }
    if (crEntry.Supplier === "17386001") {
      dbcarrier = 'FEDEX'
    }
    return mapCarrierCredentials(dbcarrier,'','');

  } catch (error) {
    throw new Error(`Failed to extract supplier from SupplierResponse: ${error.message}`);
  }
}
async function mapCarrierCredentials(dbcarrier, dbaccount, ServiceName) {
  const found = CarrierCredentialsData.find(item =>
    item.details.CarrierName === dbcarrier
  ); //&& item.details.Account === dbaccount  * Need to add

  return found ? {
    Carrier: found.details.CarrierName,
    ServiceName: "FEDEX_GROUND",
    PaymentType: "Sender",
    SHIPPING_ACCOUNT: found.details.Account, //"740561073",
    USERID: found.details.USERID,  //"l7e48144d986db4a25a418bcb9a186383e",
    PASSWORD: found.details.PASSWORD  //"d73181e3e6044eba83160516b0e8d987"
  } :
    {
      Carrier: 'FEDEX',
      ServiceName: "FEDEX_GROUND",
      PaymentType: "Sender",
      SHIPPING_ACCOUNT: "740561073",
      USERID: "l7e48144d986db4a25a418bcb9a186383e",
      PASSWORD: "d73181e3e6044eba83160516b0e8d987"
    };
}
async function extractAddressFromDeliveryAddress(DeliveryAddressResponse) {
  try {
    const entries = DeliveryAddressResponse.d.results;
    if (!entries) return null;

    // Ensure entries is an array
    const entriesArray = Array.isArray(entries) ? entries : [entries];

    // Find entry with PartnerFunction 'SH'
    const shEntry = entriesArray.find(entry =>
      entry.PartnerFunction === 'SH'
    );

    if (!shEntry) return null;

    const properties = shEntry;

    // Create address object
    return {
      businessPartnerName: properties['BusinessPartnerName1'],
      careOfName: properties['CareOfName'] || '',
      street: `${properties['HouseNumber'] || ''} ${properties['StreetName'] || ''}`.trim(),
      city: properties['CityName'],
      region: properties['Region'],
      postalCode: properties['PostalCode'],
      country: properties['Country'],
      email: properties['EmailAddress'],
      phone: properties['PhoneNumber']
    };

  } catch (error) {
    console.error('Error parsing DeliveryAddressResponse:', error);
    return null;
  }
}

function prepareHandlingUnitsFromHU(HUResponse) {
  try {
    if (!HUResponse.value || !Array.isArray(HUResponse.value)) {
      return [];
    }

    // Transform the handling units array
    return HUResponse.value.map(unit => ({
      handlingUnitExternalID: unit.HandlingUnitExternalID,
      warehouse: unit.Warehouse,
      packagingMaterial: unit.PackagingMaterial,
      highestLevelHandlingUnitNumber: unit.HighestLevelHandlingUnitNumber,
      weight: {
        gross: unit.GrossWeight,
        net: unit.NetWeight,
        tare: unit.HandlingUnitTareWeight,
        max: unit.HandlingUnitMaxWeight,
        unit: unit.WeightUnit,
        tareUnit: unit.HandlingUnitTareWeightUnit
      },
      dimensions: {
        length: unit.HandlingUnitLength,
        width: unit.HandlingUnitWidth,
        height: unit.HandlingUnitHeight,
        unit: unit.UnitOfMeasureDimension
      },
      referenceDocument: unit.HandlingUnitReferenceDocument
    }));

  } catch (error) {
    console.error('Error processing HUResponse:', error);
    return [];
  }
}


// If you want to run it immediately
// main();
module.exports = router;