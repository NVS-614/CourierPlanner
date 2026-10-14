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
const db = require('../database/db.js');

const emailapp = require("../Reuse/email_processor.js");

let Carrierreq = ''; let Carrierres = '';
// Listen for emitted request logs
logEmitter.on('logRequest', (data) => {
  Carrierreq = data;
});
logEmitter.on('logResponse', (data) => {
  Carrierres = data;
});

let ErrorCount = 0;
let SuccessCount = 0;
let gettoemail = '';
let serviceMapList = null;
let CarrierCredentialsData = null;
router.post('/', async (request, response) => {
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
  try {
    dbCon.dbBatchAutomated_statusUpdate(request.body.batch_id);
  } catch (error) {

  }
  serviceMapList = await dbCon.fetchCarrierServiceCodes();
  CarrierCredentialsData = await dbCon.fetchCarrierCredentials();

  try {
    const checkquery = `SELECT * FROM public.batch_shipments WHERE batch_id = $1`;
    const result = await db.query(checkquery, [request.body.batch_id]);

    if (result.length === 0) {
      return response.status(200).send({ error: 'No matching record found' });
    }
    // ---------------------------------------
    // 🔥 GROUP RECORDS BY ReferenceID
    // ---------------------------------------
    const grouped = {};

    for (const row of result) {
      const details = row.details;
      const ref = details.ReferenceID;

      if (!grouped[ref]) {
        grouped[ref] = {
          rows: [],          // store DB rows for update
          common: details,   // common shipper/shipto data
          packages: []       // all package entries
        };
      }

      grouped[ref].rows.push(row);

      grouped[ref].packages.push({
        SpecialServices: {},
        Weightunits: details.Weight_Unit || "LB",
        DimensionUnits: details.Dimension_Unit || "IN",
        Sno: grouped[ref].packages.length + 1,
        IsInternal: true,
        HU: details.Package_ID || "",
        Weight: String(details.Package_Weight || ""),
        Dimension: `${details.Package_Length}X${details.Package_Width}X${details.Package_Height}`,
        DeclaredValue: details?.DECLARED_VALUE || "",
        Class: "50"
      });
    }

    // ---------------------------------------
    // 🔥 PROCESS ONE SHIPMENT PER ReferenceID
    // ---------------------------------------
    for (const ref in grouped) {
      const groupData = grouped[ref];
      let shipmentResult = await ProcessShipment(groupData);

      // ===========================================================
      // UPDATE ALL DB ROWS FOR THIS REFERENCE ID
      // ===========================================================
      for (let i = 0; i < shipmentResult.rows.length; i++) {
        let row = shipmentResult.rows[i];

        await dbCon.dbBatchShipUpdate({
          id: row.id,                                                // row-specific id
          Tracking_Number: shipmentResult.trackingNumbers[i] || '',   // index-based
          Base64_encodedLabel: shipmentResult.labels[i] || '',
          Discount_Freight: shipmentResult.Discount_Freight,
          Published_Freight: shipmentResult.Published_Freight,
          LabelType: row.details.LabelType || '',
          status: shipmentResult.status,
          Errormessage: shipmentResult.Errormessage
        });
      }
    }

    try {
      gettoemail = await dbCon.dbBatchAutomated_statusUpdateDone(SuccessCount, ErrorCount, request.body.batch_id);
    } catch (error) { }
    try {
      if (gettoemail) {
        emailapp.generateAndSendExcel(request.body.batch_id, gettoemail, SuccessCount, ErrorCount);
      }
    } catch (error) { }
    return response.status(200).send({ status: 'Process Completed', successCount: SuccessCount, faildCount: ErrorCount });


  } catch (error) {
    console.error('BatchShip request failed:', error);
    response.status(500).send({ error: 'BatchShip request failed' });
  }
});

async function ProcessShipment(shipmentGroup) {
  // shipmentGroup contains:
  // { common: row, packages: [pkg1, pkg2...] }
  let dbuniquid = null;
  let dbcarrier = shipmentGroup.common.CarrierCode.toUpperCase();
  if (dbcarrier === 'FEDX') { dbcarrier = 'FEDEX' }
  const dbservicename = shipmentGroup.common.ServiceCode.toUpperCase();
  const dbShipperAccountNumber = shipmentGroup.common.Shipper_AccountNumber;
  const { carrier, ServiceName } = await mapCarrierServiceCodes(dbcarrier, dbservicename)
  let shipmentData = buildShipmentJSON(shipmentGroup.common, shipmentGroup.packages);
  let carrierResponse;
  shipmentData.CARRIER_DETAILS = await mapCarrierCredentials(dbcarrier, dbShipperAccountNumber, ServiceName);

  if (dbcarrier === 'FEDEX') {
    carrierResponse = await FedExShip.SapFedEx(shipmentData);
  } else if (dbcarrier === 'UPS') {
    carrierResponse = await upsShip.SapUPS(shipmentData);
  } else {
    carrierResponse = await FedExShip.SapFedEx(shipmentData);
  }


  // Process the carrier response
  const isSuccess = carrierResponse.status?.toUpperCase() === 'SUCCESS';

  try {
    Object.assign(shipmentData, carrierResponse);
    dbuniquid = await dbCon.dbShipsave(shipmentData);
  } catch (error) {
    console.log(error.message)
  }

  if (isSuccess) {
    rows: shipmentGroup.rows,
      SuccessCount++;
    shipmentGroup.Status = carrierResponse.status;
    shipmentGroup.TRACKING_STATUS = 'Shipped';
    shipmentGroup.Discount_Freight = carrierResponse?.shippingCharges.find(c => c.description?.toLowerCase() === 'discount freight')?.amount || '';
    shipmentGroup.Published_Freight = carrierResponse?.shippingCharges.find(c => c.description?.toLowerCase() === 'published freight')?.amount || '';
    try {
      shipmentGroup.trackingNumbers = Array.isArray(carrierResponse.Packages) ? carrierResponse.PACKAGES.map(p => p.TrackingNumber || '') : [];
    } catch (error) { }
    try {
      shipmentGroup.labels = Array.isArray(carrierResponse.SHIPPING_DOCUMENTS) ? carrierResponse.SHIPPING_DOCUMENTS.map(p => p.encodedLabel || '') : [];
      shipmentGroup.LabelType = carrierResponse?.SHIPPING_DOCUMENTS[0].docType;
    } catch (error) { }
  }
  else {
    rows: shipmentGroup.rows,
      ErrorCount++;
    shipmentGroup.Status = carrierResponse.status;
    shipmentGroup.Errormessage = carrierResponse.message[0]
  }
  return shipmentGroup;




};

function buildShipmentJSON(input, packages) {
  return {
    HEADER_INFO: {
      FeederSystem: "",
      DocumentNumber: input.ReferenceID || "",
      DocumentType: "Delivery",
      ShipDate: new Date().toISOString(),
      ShipmentType: "",
      DeclaredValue: input?.DECLARED_VALUE || "",
      InsuranceAmount: input?.Insurance_Amount || "",
      InsuranceCurrency: input?.Insurance_Currency || "",
      Location: input.Location_ID || "",
      ERP: "SAP EWM"
    },

    Shipper: {
      COMPANY: input.ShipFrom_Name || "",
      CONTACT: input.ShipFrom_ContactName || "",
      ADDRESS_LINE1: input.ShipFrom_Street || "",
      ADDRESS_LINE2: input.ShipFrom_Street2 || "",
      ADDRESS_LINE3: "",
      CITY: input.ShipFrom_City || "",
      STATE: input.ShipFrom_State || "",
      ZIPCODE: String(input.ShipFrom_Zip || ""),
      COUNTRY: input.ShipFrom_Country || "",
      PHONE: input.ShipFrom_Phone || "",
      EMAIL: input.ShipFrom_Email || ""
    },
    ShipFrom: {
      COMPANY: input.ShipFrom_Name || "",
      CONTACT: input.ShipFrom_ContactName || "",
      ADDRESS_LINE1: input.ShipFrom_Street || "",
      ADDRESS_LINE2: input.ShipFrom_Street2 || "",
      ADDRESS_LINE3: "",
      CITY: input.ShipFrom_City || "",
      STATE: input.ShipFrom_State || "",
      ZIPCODE: String(input.ShipFrom_Zip || ""),
      COUNTRY: input.ShipFrom_Country || "",
      PHONE: input.ShipFrom_Phone || "",
      EMAIL: input.ShipFrom_Email || ""
    },
    ShipTo: {
      COMPANY: input.ShipTo_Name || "",
      CONTACT: input.ShipTo_ContactName || "",
      ADDRESS_LINE1: input.ShipTo_Street || "",
      ADDRESS_LINE2: "",
      ADDRESS_LINE3: "",
      CITY: input.ShipTo_City || "",
      STATE: input.ShipTo_State || "",
      ZIPCODE: String(input.ShipTo_Zip || ""),
      COUNTRY: input.ShipTo_Country || "",
      PHONE: input.ShipTo_Phone || "",
      EMAIL: input.ShipTo_Email || ""
    },
    SoldTo: {
      COMPANY: input.ShipTo_Name || "",
      CONTACT: input.ShipTo_ContactName || "",
      ADDRESS_LINE1: input.ShipTo_Street || "",
      ADDRESS_LINE2: "",
      ADDRESS_LINE3: "",
      CITY: input.ShipTo_City || "",
      STATE: input.ShipTo_State || "",
      ZIPCODE: String(input.ShipTo_Zip || ""),
      COUNTRY: input.ShipTo_Country || "",
      PHONE: input.ShipTo_Phone || "",
      EMAIL: input.ShipTo_Email || ""
    },
    Packages: packages,

    ShipmentLevelServices: {
      Signature_optionType: input.Signature_Service || "NONE",
      AdditionalServices_SATURDAY_DELIVERY: input.Is_Saturday_Delivery || false,
      AdditionalServices_SATURDAY_PICKUP: false,
      HOLD_AT_LOCATION: false,
      InsidePickup: false,
      InsideDelivery: false,
      LiftGatePickup: false,
      LiftGateDelivery: false,
      LimitedAccessPickup: false,
      LimitedAccessDelivery: false,
      PharmacyDelivery: false,
      ElectronicTradeDocument: false,
      FedExOneRate: true,
      BrokerSelect: false,
      ThirdPartyConsignee: false,
      EmailNotification: false,
      AdditionalServices_RESIDENTIAL_DELIVERY: input.Is_Residential || false,
      DeliveryAppointment: false,
      SortandSegregate: false,
      ProtectFromFreezing: false,
      OverLength: true,
      Hazmat: false,

      HomeDelivery: {
        PHONE: input.ShipTo_Phone || "",
        DeliveryDate: new Date().toISOString().split("T")[0],
        PremiumType: "APPOINTMENT"
      }
    },

    id: parseInt((input.ReferenceID || "").replace(/\D/g, "")) || 0
  };
}


async function mapCarrierServiceCodes(dbcarrier, dbservice) {
  const found = serviceMapList.find(item =>
    item.details.CarrierName === dbcarrier &&
    item.details.shipviacode === dbservice
  );

  return found ? { carrier: found.details.CarrierName, ServiceName: found.details.ServiceCode } :
    { carrier: dbcarrier, ServiceName: dbservice };
}

async function mapCarrierCredentials(dbcarrier, dbaccount, ServiceName) {
  const found = CarrierCredentialsData.find(item =>
    item.details.CarrierName === dbcarrier
  ); //&& item.details.Account === dbaccount  * Need to add

  return found ? {
    Carrier: found.details.CarrierName,
    ServiceName: ServiceName, //"FEDEX_GROUND",
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

module.exports = router;