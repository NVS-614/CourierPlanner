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
const reuse = require('../Reuse/utilityfunctions.js');
//const { getLBNToken } = require('../Reuse/LBNTokenManager.js');

let CarrierCredentialsData = null;
let Carrierreq = ''; let Carrierres = '';
let dbuniquid = null;
// Listen for emitted request logs
logEmitter.on('logRequest', (data) => {
  Carrierreq = data;
});
logEmitter.on('logResponse', (data) => {
  Carrierres = data;
});
router.post('/', async (request, response) => {

  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  console.log('SAP_Req', request.body)
  CarrierCredentialsData = await dbCon.fetchCarrierCredentials();
  const carrierReferenceDocument = request.body.carrier.standardID;
  let carrier = carrierReferenceDocument.find(item => item.schemeAgencyId === '182')?.identificationNumber ?? '';
  const shipper = request.body.shipFromLocation;
  const shipTo = request.body.shipToLocation;
  const packages = request.body.items || [];
  const labelType = request.body?.printLabelFormat || 'PNG'
  let shipmentData = {
    HEADER_INFO:
    {
      FeederSystem: '',
      DocumentNumber: request.body?.referenceDocument,
      ShipDate: request.body?.requestedPickupDateTimePeriod?.startDateTime,
      ERP: 'SAPLGM'
    },
    Shipper: formatAddress(shipper),
    ShipTo: formatAddress(shipTo),
    ShipFrom: formatAddress(shipper),
    SoldTo: formatAddress(shipTo),
    Items: [],
    Packages: createPackagesArray(packages),
    INTERNATIONAL_DETAILS: { ITEM_INFO: [] }
  };


  // response.send(requestPayload);
  //const jsonObject = JSON.parse(JSON.stringify(requestPayload));
  let ServiceName = '';
  if (carrier === 'FDEG' || carrier === 'FDEN' || carrier === 'FEDEX') {
    carrier = 'FEDEX'; ServiceName = 'FEDEX_GROUND'
  }
  if (carrier === 'UPS') {
    ServiceName = '03'
  }
  let carrierResponse;
  shipmentData.CARRIER_DETAILS = await reuse.mapCarrierCredentials(CarrierCredentialsData, carrier, '', ServiceName);
  shipmentData.CARRIER_DETAILS.LABELTYPE = labelType
  if (carrier === 'FEDEX') {
    carrierResponse = await FedExShip.SapFedEx(shipmentData);
  } else if (carrier === 'UPS') {
    carrierResponse = await upsShip.SapUPS(shipmentData);
  } else if (carrier === 'RLCA') {
    carrierResponse = await rlShip.SapRL(shipmentData);
  } else if (carrier === 'ABF') {
    carrierResponse = await abfShip.SapABF(shipmentData);
  } else if (carrier.startsWith('UPS')) {
    carrierResponse = await upsShip.SapUPS(shipmentData);
  } else if (carrier.startsWith('DHL')) {
    carrierResponse = await dhlShip.Sapdhl(shipmentData);
  } else {
    carrierResponse = await FedExShip.SapFedEx(shipmentData);
  }

  // Process the carrier response
  const isSuccess = carrierResponse.status?.toUpperCase() === 'SUCCESS';
  let confirmationStatus = isSuccess ? 'CON' : 'RE';
  let rejectionReasonCode = null;
  let NOTE = '';

  if (isSuccess) {
    shipmentData.status = carrierResponse.status;
    shipmentData.TRACKING_STATUS = 'Shipped';
    shipmentData.shippingCharges = carrierResponse.shippingCharges;
    shipmentData.SHIPPING_DOCUMENTS = carrierResponse.SHIPPING_DOCUMENTS;
    try {
      shipmentData.HEADER_INFO['XTRACKINGNO'] = carrierResponse.PACKAGES[0]?.TRACKING_NUMBER;
      shipmentData.Packages[0]['TrackingNumber'] = carrierResponse.PACKAGES[0]?.TRACKING_NUMBER;
    } catch (error) { }
  } else {
    shipmentData.Error = carrierResponse.message[0]
  }
  try {
    dbuniquid = await dbCon.dbShipsave(shipmentData);
    let logEntry =
    {
      id: dbuniquid,
      dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
      endpointURL: "//processShipmentRequest",
      EventType: "LGM_NETWORK-EXTERNAL_SYSTEM",
      request: JSON.stringify(request.body),
      response: '',
      StatusCode: ''
    }
    await dbCon.dbSAP_SHIP_transactionssave(logEntry);
  } catch (error) {
    console.log(error.message)
  }
  if (isSuccess) {
    let SAPResponse = {
      referenceDocument: request.body.referenceDocument,
      externalPartnerReferenceId: carrierResponse.PACKAGES[0]?.TRACKING_NUMBER,
      confirmationStatus: confirmationStatus,
      rejectionReasonCode: rejectionReasonCode,
      confirmedCarrier: request.body.carrier.internalId,
      printLabelSize: request.body.printLabelSize,
      printLabelFormat: request.body.printLabelFormat,
      items: []
    };
    carrierResponse.SHIPPING_DOCUMENTS.forEach((piece, count) => {
      SAPResponse.items.push({
        shippingHandlingUnitId: request.body.items[count].shippingHandlingUnitId,
        externalPartnerReferenceId: carrierResponse.Packages[count].TrackingNumber || '',
        printLabel: piece.encodedLabel,
      });
    });

    try {
      let logEntry =
      {
        id: dbuniquid,
        dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
        endpointURL: "//processShipmentRequest",
        EventType: "EXTERNAL_SYSTEM-LGM_NETWORK",
        request: '',
        response: JSON.stringify(SAPResponse),
        StatusCode: '200'
      }
      await dbCon.dbSAP_SHIP_transactionssave(logEntry);
    } catch (error) {
      console.log(error.message)
    }
    console.log('SAP_Response_success', SAPResponse)
    return response.status(200).json(SAPResponse);

  }
  else {
    console.log(carrierResponse)
    confirmationStatus = 'RE'
    rejectionReasonCode = 'RE'
    let SAPErrorResponse = {
      referenceDocument: request.body.referenceDocument,
      externalPartnerReferenceId: request.body.referenceDocument,
      confirmationStatus: confirmationStatus,
      rejectionReasonCode: rejectionReasonCode,
      confirmedCarrier: request.body.carrier.internalId,
      printLabelSize: request.body.printLabelSize,
      printLabelFormat: request.body.printLabelFormat,
      items: [],
      Error: carrierResponse.message[0]
    };

    try {
      let logEntry =
      {
        id: dbuniquid,
        dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
        endpointURL: "//processShipmentRequest",
        EventType: "EXTERNAL_SYSTEM-LGM_NETWORK",
        request: '',
        response: JSON.stringify(SAPErrorResponse),
        StatusCode: '400'
      }
      await dbCon.dbSAP_SHIP_transactionssave(logEntry);
    } catch (error) {
      console.log(error.message)
    }
    console.log('SAP_Response_err', SAPErrorResponse)
    return response.status(400).json(SAPErrorResponse);
  }

  //const token = await getLBNToken();



  // try {
  //   const sapRes = await axios.post(`https://api.logistics.eu.business-network.cloud.sap/http/v1/LbnFreightOrderForSubcontracting/${request.body.orderingPartyLbnId}/${request.body.originatorId}/${request.body.freightOrderId}/carrierResponse`, SAPResponse, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });

  //   // logEntry =
  //   // {
  //   //   id: uniqueid,
  //   //   dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
  //   //   endpointURL: process.env.LBN_CLOUD_ORDEREVENTS_URL,
  //   //   EventType: "EXTERNAL_SYSTEM-BN4L_NETWORK",
  //   //   request: JSON.stringify(SapEventRequest),
  //   //   response: JSON.stringify(sapRes.data),
  //   //   StatusCode: 200
  //   // }
  //   // dbCon.dbSAP_TRACK_transactionssave(logEntry);
  //   return response.status(200).json(sapRes.data);
  // } catch (error) {
  //   // logEntry =
  //   // {
  //   //   id: uniqueid,
  //   //   dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
  //   //   endpointURL: process.env.LBN_CLOUD_ORDEREVENTS_URL,
  //   //   EventType: "EXTERNAL_SYSTEM-BN4L_NETWORK",
  //   //   request: JSON.stringify(SapEventRequest),
  //   //   response: JSON.stringify(error),
  //   //   StatusCode: 500
  //   // }
  //   // dbCon.dbSAP_TRACK_transactionssave(logEntry);
  //   return response.status(500).json({ error: error?.message + "SAP API request failed" });
  // }

});


function createPackagesArray(packages) {
  let packageArray = [];
  for (let i = 0; i < packages.length; i++) {
    if (packages[i]?.grossWeight) {
      packageArray.push({
        ItemsInfo: [],
        Sno: i,
        Weightunits: packages[i]?.grossWeightUnitOfMeasure || '',
        DimensionUnits: packages[i]?.dimensionUnitOfMeasure,
        Dimension: packages[i]?.length + 'X' + packages[i]?.width + 'X' + packages[i]?.height,
        Description: packages[i]?.shippingHandlingUnitId,
        Weight: packages[i]?.grossWeight
      });
    }
  }


  return packageArray;
}
// Helper function to format the address object
function formatAddress(addressObj) {
  return {
    COMPANY: addressObj.addresseeName2?.length > 30 ? addressObj.addresseeName2.substring(0, 30) + "..." : addressObj.addresseeName2,
    CONTACT: addressObj.addresseeName1?.length > 30 ? addressObj.addresseeName1.substring(0, 30) + "..." : addressObj.addresseeName1,
    ADDRESS_LINE1: addressObj?.streetName || '',
    ADDRESS_LINE2: addressObj?.streetPrefix + ' ' + addressObj?.streetSuffix || '',
    CITY: addressObj?.city || '',
    STATE: addressObj?.region || '',
    ZIPCODE: addressObj?.postalCode || '',
    COUNTRY: addressObj?.country || '',
    PHONE: '9999999999',
    EMAIL: addressObj?.emailAddress || ''
  };
}

module.exports = router;