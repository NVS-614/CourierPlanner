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
const s4data = require("../SHIPCORE/bulk-s4-del-shipcore.js");
const commonreq = require("../SHIPCORE/commonRequestMapping.js");
const { processShipment } = require("./shipmentRouter");
const pLimit = require("p-limit").default;

let serviceMapList = null;
let CarrierCredentialsData = null;
let dbcarrier = ''
// Global concurrency limit
const limit = pLimit(5); // max 5 parallel shipments

// Usage example
router.post('/', async (request, response) => {
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  serviceMapList = await dbCon.fetchCarrierServiceCodes();
  CarrierCredentialsData = await dbCon.fetchCarrierCredentials();
  shipperslist = await dbCon.fetchShippersFromWH();
  let batchshipdata = [];
  try {
    if (request.body.ewmDelivery) {
      batchshipdata = await ewmdata.runbulkewmShipCoreJob(request.body.ewmDelivery)
    }
    else if (request.body.s4Delivery) {
      batchshipdata = await s4data.runbulks4ShipCoreJob(request.body.s4Delivery)
    }
    else if (request.body.tmFreightOrder) {
      batchshipdata = await s4data.runbulks4ShipCoreJob(request.body.s4Delivery)
    }
      else if (request.body.tmReturnSalesOrder) {
      batchshipdata = await s4data.runbulks4ShipCoreJob(request.body.s4Delivery)
    }
    else if (request.body.batchShippingData) {
      batchshipdata = request.body.batchShippingData
    }
    const shipments = await commonreq.transformData(batchshipdata, CarrierCredentialsData, shipperslist, serviceMapList);

    const tasks = shipments.map(shipment =>
      limit(async () => {
        try {
          const carrierResponse = await processShipment(shipment); // ✅ FIX 2
          const isSuccess = carrierResponse.status?.toUpperCase() === 'SUCCESS';
          try {
            if (isSuccess) {
              shipment.status = carrierResponse.status;
              shipment.TRACKING_STATUS = 'Shipped';
              shipment.shippingCharges = carrierResponse.shippingCharges;
              shipment.SHIPPING_DOCUMENTS = carrierResponse.SHIPPING_DOCUMENTS;
              try {
                shipment.HEADER_INFO['XTRACKINGNO'] = carrierResponse.PACKAGES[0]?.TRACKING_NUMBER;
                shipment.Packages[0]['TrackingNumber'] = carrierResponse.PACKAGES[0]?.TRACKING_NUMBER;
              } catch (error) { }
              dbuniquid = await dbCon.dbShipsave(shipment);
              return { id: dbuniquid }
            } else {
              shipment.status = carrierResponse.status;
              shipment.Errors = carrierResponse.message
              dbuniquid = await dbCon.dbShipsave(shipment);
              return { id: dbuniquid }
            }



          } catch (error) {
            console.log(error.message)
          }

        } catch (error) {

        }
      })
    );

    const results = await Promise.all(tasks); // ✅ FIX 3
    return response.status(200).send(results);
    // Output the result
    //console.log(JSON.stringify(result, null, 2));
    //return response.status(200).send(result);

  } catch (error) {
    console.error('Batch processing failed:', error);
    return response.status(200).send(error.message);

  }
});



module.exports = router;