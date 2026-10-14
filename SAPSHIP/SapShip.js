const express = require('express');
const router = express.Router();
const axios = require('axios');
const fs = require('fs');
const logEmitter = require("../Reuse/Logger.js");
const dbCon = require("../database/dbsaveandupdate.js");
const FedExShip = require("../CARRIER/FEDEX/SapFedEx.js");
const rlShip = require("../CARRIER/RL/SapRL.js");
const upsShip = require("../CARRIER/UPS/SapUPS.js");
const { getLBNToken } = require('../Reuse/LBNTokenManager.js');


let CarrierCredentialsData = null;
let Carrierreq = ''; let Carrierres = '';
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

  CarrierCredentialsData = await dbCon.fetchCarrierCredentials();
  const carrierReferenceDocument = request.body.carrier.standardIds;
  let carrier = carrierReferenceDocument.find(item => item.type === '182')?.id ?? '';
  const shipper = request.body.transportationStages[0].loadingLocation.address;
  const shipTo = request.body.transportationStages[0].unloadingLocation.address;
  let noOfPacks = (request.body.transportationStages[0].assignedItems.length);
  const itempackages = request.body.items || [];
  const packages = request.body.transportationStages[0].assignedItems || [];
  //console.log(itempackages);
  //console.log('packages' , packages);
  let packItems = [];
  packages.forEach(pkg => {
    packItems = packItems.concat(itempackages.filter(x => x.id === pkg));

  });
  //console.log('packItems' ,packItems);
  let requestPayload = [];

  let packageData = {
    HEADER_INFO: { FeederSystem: '', DocumentNumber: request.body?.businessDocumentReferences[0]?.id, ShipDate: request.body?.businessDocumentReferences[0]?.dateTime, ERP: 'SAP EWM' },
    Shipper: formatAddress(shipper),
    ShipTo: formatAddress(shipTo),
    ShipFrom: formatAddress(shipper),
    SoldTo: formatAddress(shipTo),
    Items: [],
    Packages: createPackagesArray(noOfPacks, packItems),
    INTERNATIONAL_DETAILS: { ITEM_INFO: [] }
  };


  requestPayload.push(packageData);

  // response.send(requestPayload);
  const jsonObject = JSON.parse(JSON.stringify(requestPayload));


  //**** */ 1. Need to save the SAP req in DB API*****
  // try {
  //   let saptrackreq = {
  //     login: "venkat",
  //     password: "rvs@Pc01",
  //     request: request.body
  //   };
  //   const sappayload = JSON.stringify(saptrackreq);
  //   console.log(JSON.stringify(saptrackreq))
  //   axios.post('https://shipv2_xcservices.cfapps.eu10-004.hana.ondemand.com/tracklbn', sappayload, {
  //     headers: {
  //       'Content-Type': 'application/json',
  //       Accept: 'application/json',
  //     },
  //   }).then((sres) => {
  //     console.log('tracklbn res' + sres.data)
  //     //response.send(sres.data).status(200);
  //   })
  //     .catch((ex) => {
  //       console.log('--tracklbn Res Exception is...: ')
  //       console.log(ex.response?.data)
  //     });
  // } catch (error) {
  //   console.log('--tracklbn Res Exception is...: ', error.message)
  // }

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
  let ServiceName = '';
  if (carrier === 'FDEG' || carrier === 'FDEN' || carrier === 'FEDEX') {
    carrier = 'FEDEX'; ServiceName = 'FEDEX_GROUND'
  }
  if (carrier === 'UPS') {
    ServiceName = '03'
  }
  let carrierResponse;
  shipmentData.CARRIER_DETAILS = await reuse.mapCarrierCredentials(CarrierCredentialsData, carrier, '', ServiceName);
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
  let confirmationStatus = '';
  let NOTE = '';


  if (isSuccess === 'SUCCESS') {
    jsonObject[0]['status'] = carrierresponse.status;
    jsonObject[0]['TRACKING_STATUS'] = 'Shipped';
    jsonObject[0]['shippingCharges'] = carrierresponse['shippingCharges'];
    jsonObject[0]['SHIPPING_DOCUMENTS'] = carrierresponse['SHIPPING_DOCUMENTS'];
    try {
      jsonObject[0].HEADER_INFO['XTRACKINGNO'] = carrierresponse.PACKAGES[0]?.TRACKING_NUMBER;
      jsonObject[0].Packages[0]['TrackingNumber'] = carrierresponse.PACKAGES[0]?.TRACKING_NUMBER;
    } catch (error) { }
    // console.log(jsonObject);


    try {
      dbCon.dbShipsave(jsonObject[0]);

      // let logEntry =
      // {
      //   id: uniqueid,
      //   dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
      //   endpointURL: "SapShip/LbnFreightOrderForSubcontracting",
      //   EventType: "BN4L_NETWORK-EXTERNAL_SYSTEM",
      //   request: JSON.stringify(request.body),
      //   response: '',
      //   StatusCode: ''
      // }
      // await dbCon.dbSAP_TRACK_transactionssave(logEntry);
    } catch (error) {
      console.log(error.message)
    }



    ShipResponse = carrierresponse
    confirmationStatus = 'CN'
  }
  else {
    console.log(carrierresponse)
    carrierresponse.message.forEach(er => {
      ShipResponse.Errors.push(er);
    });
    confirmationStatus = 'RE'

  }


  const token = await getLBNToken();


  var SAPResponse = {};
  SAPResponse['carrierPartyLbnId'] = request.body.carrierPartyLbnId;
  SAPResponse['confirmationStatus'] = confirmationStatus;
  SAPResponse['attachments'] = [];
  SAPResponse['businessDocumentReferences'] = [];
  if (confirmationStatus === 'CN') {
    ShipResponse.shippingCharges.forEach((piece) => {
      if (piece.description == 'Discounted Freight') {
        // SAPResponse['proposalPrice'] = {};
        //   SAPResponse.proposalPrice['value'] = piece.amount,
        //   SAPResponse.proposalPrice['currency'] = piece.currency
      }
    });
    var trackingno = '';
    ShipResponse.PACKAGES.forEach((piece) => {
      trackingno = piece.TrackingNumber;
      idobject = {};
      idobject['documentId'] = piece.TrackingNumber,
        idobject['documentTypeCode'] = 'T67'
      // idobject['documentDateTime'] = ''
      SAPResponse.businessDocumentReferences.push(idobject)

      // idobject1 = {};
      // idobject1['documentId'] = piece.TrackingNumber,
      // idobject1['documentTypeCode'] = 'VPID'
      // SAPResponse.businessDocumentReferences.push(idobject1)

      // idobject2 = {};
      // idobject2['documentId'] = piece.TrackingNumber,
      //   idobject2['documentTypeCode'] = 'TKN_ID'
      // SAPResponse.businessDocumentReferences.push(idobject2)

      idobject3 = {};
      idobject3['documentId'] = piece.TrackingNumber,
        idobject3['documentTypeCode'] = 'BN'
      SAPResponse.businessDocumentReferences.push(idobject3)
    });
    ShipResponse.SHIPPING_DOCUMENTS.forEach((piece) => {
      var mimeCode = ''
      if (piece.docType == 'PDF') {
        mimeCode = 'application/pdf';
      } else {
        mimeCode = 'image/png';
      }
      InvoiceLabel = {};
      InvoiceLabel['name'] = trackingno + '_Label.pdf',
        InvoiceLabel['mimeCode'] = mimeCode,
        InvoiceLabel['fileContentBinaryObject'] = piece.encodedLabel
      SAPResponse.attachments.push(InvoiceLabel);


    });

  }
  else {
    SAPResponse['note'] = {};
    SAPResponse.note = {}; SAPResponse.note['text'] = ShipResponse.Errors[0].Message;
  }

  // console.log(SAPResponse);
  // try {
  //   const logEntry = generateTransactionLog(
  //     request.body,
  //     SAPResponse,
  //     "https://api.example.com/endpoint",
  //     Carrierreq,
  //     Carrierres,
  //     "Error processing request" // Message
  //   );
  //   let saveresult1 = dbCon.dbtransactionssave(logEntry);
  // } catch (error) {
  // }

  try {
    const sapRes = await axios.post(`https://api.logistics.eu.business-network.cloud.sap/http/v1/LbnFreightOrderForSubcontracting/${request.body.orderingPartyLbnId}/${request.body.originatorId}/${request.body.freightOrderId}/carrierResponse`, SAPResponse, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });

    // logEntry =
    // {
    //   id: uniqueid,
    //   dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
    //   endpointURL: process.env.LBN_CLOUD_ORDEREVENTS_URL,
    //   EventType: "EXTERNAL_SYSTEM-BN4L_NETWORK",
    //   request: JSON.stringify(SapEventRequest),
    //   response: JSON.stringify(sapRes.data),
    //   StatusCode: 200
    // }
    // dbCon.dbSAP_TRACK_transactionssave(logEntry);
    return response.status(200).json(sapRes.data);
  } catch (error) {
    // logEntry =
    // {
    //   id: uniqueid,
    //   dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
    //   endpointURL: process.env.LBN_CLOUD_ORDEREVENTS_URL,
    //   EventType: "EXTERNAL_SYSTEM-BN4L_NETWORK",
    //   request: JSON.stringify(SapEventRequest),
    //   response: JSON.stringify(error),
    //   StatusCode: 500
    // }
    // dbCon.dbSAP_TRACK_transactionssave(logEntry);
    return response.status(500).json({ error: error?.message + "SAP API request failed" });
  }

  ;

});

function createPackagesArray(noOfPacks, packages) {
  let packageArray = [];

  for (let i = 0; i < noOfPacks; i++) {
    if (packages[i]?.grossWeight.value) {
      packageArray.push({
        ItemsInfo: [],
        Sno: i,
        Weightunits: packages[i]?.grossWeight.unit || '',
        DimensionUnits: packages[i]?.length.unit,
        Dimension: packages[i]?.length.value + 'X' + packages[i]?.width.value + 'X' + packages[i]?.height.value,
        Description: packages[i]?.description,
        Weight: packages[i]?.grossWeight.value
      });
    }
  }

  return packageArray;
}
// Helper function to format the address object
function formatAddress(addressObj) {
  return {
    COMPANY: addressObj.name?.length > 30 ? addressObj.name.substring(0, 30) + "..." : addressObj.name,
    CONTACT: addressObj.name1?.length > 30 ? addressObj.name1.substring(0, 30) + "..." : addressObj.name1,
    ADDRESS_LINE1: addressObj?.street || '',
    ADDRESS_LINE2: addressObj?.house || '',
    CITY: addressObj?.city || '',
    STATE: addressObj?.region || '',
    ZIPCODE: addressObj?.postalCode || '',
    COUNTRY: addressObj?.country || '',
    PHONE: addressObj?.mobileNumber.subscriberId,
    EMAIL: addressObj?.emailAddress
  };
}
const generateTransactionLog = (userRequest, userResponse, endpoint, endpointRequest, endpointResponse, message) => {
  return {
    transactiondate: new Date().toISOString().split('T')[0], // Format as YYYY-MM-DD
    status: "Error",
    userrequest: JSON.stringify(userRequest),
    userresponse: JSON.stringify(userResponse),
    endpoint: endpoint,
    endpointrequest: JSON.stringify(endpointRequest),
    endpointresponse: JSON.stringify(endpointResponse),
    message: message
  };
};
module.exports = router;