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
const { getLBNToken } = require('../Reuse/LBNTokenManager.js');
const reuse = require('../Reuse/utilityfunctions.js');
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
  try {

    CarrierCredentialsData = await dbCon.fetchCarrierCredentials();
    let dbuniquid = null;
    let confirmationStatus = 'RE';
    const LBNtoken = await getLBNToken();
    const orderingPartyLbnId = request.body.orderingPartyLbnId;
    const originatorId = request.body.originatorId;
    const freightOrderId = request.body.freightOrderId;
    const carrierPartyLbnId = request.body.carrierPartyLbnId;

    const carrierReferenceDocument = request.body.carrier.standardIds;
    let carrier = carrierReferenceDocument.find(item => item.type === '182')?.id ?? '';
    const shipper = request.body.transportationStages[0].loadingLocation.address;
    const shipTo = request.body.transportationStages[0].unloadingLocation.address;
    let noOfPacks = (request.body.transportationStages[0].assignedItems.length);
    const itempackages = request.body.items || [];
    const packages = request.body.transportationStages[0].assignedItems || [];

    let packItems = [];
    packages.forEach(pkg => {
      const matched = itempackages.filter(x => x.id === pkg && x.categoryCode === "PKG");
      packItems = packItems.concat(matched);

    });

    if (!packItems || packItems.length === 0) {
      const SAPResponse = {
        carrierPartyLbnId: carrierPartyLbnId,
        confirmationStatus: confirmationStatus,
        attachments: [],
        businessDocumentReferences: [],
        note: {
          text: 'Your request is missing the packItems data. Please add the items and try again.'
        }
      };
      let ResponseubmitResult = await LBNFOcarrierResponsesubmit(SAPResponse, LBNtoken, orderingPartyLbnId, originatorId, freightOrderId, null)
      return response.status(200).json(ResponseubmitResult);
    }

    let shipmentData = {
      HEADER_INFO: {
        FeederSystem: '',
        DocumentNumber: request.body?.businessDocumentReferences[0]?.id,
        ShipDate: request.body?.businessDocumentReferences[0]?.dateTime,
        ERP: 'SAP EWM',
        orderingPartyLbnId: request.body?.orderingParty.lbnId, // FROM LbnFreightOrderForSubcontracting 
        carrierLbnId: request.body?.carrier.lbnId,// FROM LbnFreightOrderForSubcontracting 
        purchasingParty: request.body?.orderingParty.sourceSystemBusinessPartnerID,// FROM LbnFreightOrderForSubcontracting 
        billFromParty: request.body?.carrier.sourceSystemBusinessPartnerID,// FROM LbnFreightOrderForSubcontracting 
        senderSystemId: request.body?.originatorId,// FROM LbnFreightOrderForSubcontracting 
      },
      Shipper: formatAddress(shipper),
      ShipTo: formatAddress(shipTo),
      ShipFrom: formatAddress(shipper),
      SoldTo: formatAddress(shipTo),
      Items: [],
      Packages: createPackagesArray(noOfPacks, packItems),
      INTERNATIONAL_DETAILS: { ITEM_INFO: [] }
    };
    let ServiceName = '';
    if (carrier === 'FDEG' || carrier === 'FDEN' || carrier === 'FEDEX') {
      carrier = 'FEDEX'; ServiceName = 'FEDEX_GROUND'
    }
    if (carrier === 'UPS') {
      ServiceName = '03'
    }
    let carrierResponse;
    shipmentData.CARRIER_DETAILS = await reuse.mapCarrierCredentials(CarrierCredentialsData,carrier, '', ServiceName);
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
    confirmationStatus = isSuccess ? 'CN' : 'RE';

    if (isSuccess) {
      shipmentData.status = carrierResponse.status;
      shipmentData.TRACKING_STATUS = 'Shipped';
      shipmentData.shippingCharges = carrierResponse.shippingCharges;
      shipmentData.SHIPPING_DOCUMENTS = carrierResponse.SHIPPING_DOCUMENTS;

      try {
        shipmentData.HEADER_INFO['XTRACKINGNO'] = carrierResponse.PACKAGES[0]?.TRACKING_NUMBER;
        shipmentData.Packages[0]['TrackingNumber'] = carrierResponse.PACKAGES[0]?.TRACKING_NUMBER;
      } catch (error) { }
      // console.log(jsonObject);

      try {
        dbuniquid = await dbCon.dbShipsave(shipmentData);
        let logEntry =
        {
          id: dbuniquid,
          dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
          endpointURL: "SapShip/LbnFreightOrderForSubcontracting",
          EventType: "BN4L_NETWORK-EXTERNAL_SYSTEM",
          request: JSON.stringify(request.body),
          response: '',
          StatusCode: ''
        }
        await dbCon.dbSAP_SHIP_transactionssave(logEntry);
      } catch (error) {
        console.log(error.message)
      }
    }
    else {
      console.log(carrierResponse)
      confirmationStatus = 'RE'
    }

    let SAPResponse = {
      carrierPartyLbnId: carrierPartyLbnId,
      confirmationStatus: confirmationStatus,
      attachments: [],
      businessDocumentReferences: []
    }
    if (confirmationStatus === 'CN') {
      carrierResponse?.shippingCharges?.forEach((piece) => {
        if (piece.description == 'Discounted Freight') {
          // SAPResponse['proposalPrice'] = {};
          //   SAPResponse.proposalPrice['value'] = piece.amount,
          //   SAPResponse.proposalPrice['currency'] = piece.currency
        }
      });

      carrierResponse.PACKAGES.forEach((piece) => {
        SAPResponse.businessDocumentReferences.push({ documentId: piece.TrackingNumber, documentTypeCode: 'T67' });//documentDateTime
        SAPResponse.businessDocumentReferences.push({ documentId: piece.TrackingNumber, documentTypeCode: 'BN' });
        // SAPResponse.businessDocumentReferences.push({ documentId: piece.TrackingNumber, documentTypeCode: 'VPID' });
        // SAPResponse.businessDocumentReferences.push({ documentId: piece.TrackingNumber, documentTypeCode: 'TKN_ID' })
      });
      // Separate BOL from labels
      const bolDocuments = carrierResponse.SHIPPING_DOCUMENTS.filter(doc => doc.contentType === 'Bill Of Lading');
      const labelDocuments = carrierResponse.SHIPPING_DOCUMENTS.filter(doc => doc.contentType === 'Label');
      labelDocuments.forEach((piece, index) => {
        let mimeCode = piece.docType == 'PDF' ? 'application/pdf' : 'image/png';
        SAPResponse.attachments.push({
          name: packItems[index].ssccNumber + '_' + (carrierResponse.Packages[index]?.TrackingNumber || carrierResponse.PACKAGES[0]?.TRACKING_NUMBER) + '_Label.pdf',
          mimeCode: mimeCode,
          fileContentBinaryObject: piece.encodedLabel
        });
      });
      try {
        bolDocuments.forEach((piece) => {
          SAPResponse.attachments.push({
            name: carrierResponse.PACKAGES[0]?.TRACKING_NUMBER + '_BOL.pdf',
            mimeCode: 'application/pdf',
            fileContentBinaryObject: piece.encodedLabel
          });
        });
      } catch (error) { }
    }
    else {
      SAPResponse.note = {
        text: carrierResponse.message[0]
      }
    }
    const ResponseubmitResult = await LBNFOcarrierResponsesubmit(SAPResponse, LBNtoken, orderingPartyLbnId, originatorId, freightOrderId, dbuniquid)
    return response.status(200).json(ResponseubmitResult);
  } catch (error) {
    console.log('SapLbnFOSubcontractingShip Result:' + error.message)
    return response.status(400).json({});
  }



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
    PHONE: addressObj?.mobileNumber.subscriberId || '9999999999',
    EMAIL: addressObj?.emailAddress
  };
}
async function LBNFOcarrierResponsesubmit(SAPResponse, LBNtoken, orderingPartyLbnId, originatorId, freightOrderId, dbuniquid) {
  try {
    const sapRes = await axios.post(`https://api.logistics.eu.business-network.cloud.sap/http/v1/LbnFreightOrderForSubcontracting/${orderingPartyLbnId}/${originatorId}/${freightOrderId}/carrierResponse`, SAPResponse, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${LBNtoken}` } });

    if (dbuniquid) {
      logEntry =
      {
        id: dbuniquid,
        dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
        endpointURL: 'https://api.logistics.eu.business-network.cloud.sap/http/v1/LbnFreightOrderForSubcontracting/',
        EventType: "EXTERNAL_SYSTEM-BN4L_NETWORK",
        request: SAPResponse,
        response: JSON.stringify(sapRes.data),
        StatusCode: 200
      }
      dbCon.dbSAP_SHIP_transactionssave(logEntry);
    }

    return sapRes.data;
  } catch (error) {
    if (dbuniquid) {
      logEntry =
      {
        id: dbuniquid,
        dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
        endpointURL: 'https://api.logistics.eu.business-network.cloud.sap/http/v1/LbnFreightOrderForSubcontracting/',
        EventType: "EXTERNAL_SYSTEM-BN4L_NETWORK",
        request: SAPResponse,
        response: JSON.stringify({ error: error?.message + "SAP API request failed" }),
        StatusCode: 200
      }
      dbCon.dbSAP_SHIP_transactionssave(logEntry);
    }
    return { error: error?.message + "SAP API request failed" };
  }
}



module.exports = router;