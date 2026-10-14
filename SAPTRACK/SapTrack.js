const express = require('express');
const router = express.Router();
const dbCon = require("../database/dbsaveandupdate.js");
const axios = require('axios');
const dotenv = require('dotenv');
const basicAuth = require('basic-auth');
const { getLBNToken } = require('../Reuse/LBNTokenManager.js');

dotenv.config();

// Set your accepted basic auth credentials
const AUTH_USER = 'abc';
const AUTH_PASS = 'xyz';

// Middleware to check Basic Auth
function authMiddleware(req, res, next) {
  const user = basicAuth(req);

  if (!user || user.name !== AUTH_USER || user.pass !== AUTH_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="PushTrackevents"');
    return res.status(401).send('Authentication required.');
  }

  next();
}


router.put('/', async (request, response) => {
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  try {
    const carrierReferenceDocument = request.body.shipment.carrierReferenceDocument;
    const bnValue =
      carrierReferenceDocument.find(d => d.type?.toUpperCase() === 'BN')?.value ||
      carrierReferenceDocument.find(d => d.type?.toUpperCase() === 'T67')?.value ||
      carrierReferenceDocument.find(d => d.type?.toUpperCase() === 'T50')?.value ||
      null; // => BN first, else T67, else T50, else null
    let Carrier = carrierReferenceDocument.find(item => item.type === 'SCAC')?.value || '';
    const TrackingNumber = request.body?.trackId || bnValue;
    // Normalize and identify Carrier based on SCAC
    if (Carrier) {
      Carrier = Carrier.toUpperCase();

      if (Carrier.startsWith('UP')) {
        Carrier = 'UPS';
      } else if (Carrier.startsWith('RL')) {
        Carrier = 'RL';
      } else if (Carrier.startsWith('F')) {
        Carrier = 'FEDEX';
      } else {
        // If SCAC is not one of UPS/RL/FEDEX, default to FEDEX
        Carrier = 'FEDEX';
      }
    } else {
      // If SCAC not available, infer from tracking number
      if (TrackingNumber?.startsWith('1Z')) {
        Carrier = 'UPS';
      } else {
        Carrier = 'FEDEX'; // default fallback
      }
    }

    let lbntrackreq = request.body;
    lbntrackreq.XTRACKINGNO = TrackingNumber,
      lbntrackreq.Carrier = Carrier,
      lbntrackreq.CarrierStatus = '',
      lbntrackreq.LBNStatus = '',

      lbntrackreq.trackingEvents = [];

    const uniqueid = await dbCon.dbTracksaveandUpdate(lbntrackreq);

    let logEntry =
    {
      id: uniqueid,
      dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
      endpointURL: "/sapTrack/LBNOrderForTracking",
      EventType: "BN4L_NETWORK-EXTERNAL_SYSTEM",
      request: JSON.stringify(request.body),
      response: '',
      StatusCode: ''
    }
    await dbCon.dbSAP_TRACK_transactionssave(logEntry);

    const token = await getLBNToken();


    const SapEventRequest = await buildLBN_EventRequest(request.body, TrackingNumber);

    console.log(JSON.stringify(SapEventRequest));
    try {
      const sapRes = await axios.post(process.env.LBN_CLOUD_ORDEREVENTS_URL, SapEventRequest, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });


      return response.status(200).json(sapRes.data);
    } catch (error) {

      return response.status(500).json({ error: "SAP API request failed" });
    }

  } catch (error) {
    console.log(error?.response?.data || error?.message)
    return response.status(500).json({ error: error?.message });
  }
});


async function buildLBN_EventRequest(requestBody, TrackingNumber) {
  const SapEventRequest = {
    shipper: { shipperLBNID: requestBody.shipper.shipperLBNID },
    carrier: { carrierLBNID: requestBody.carrier.carrierLBNID },
    technicalId: requestBody.technicalId,
    orderId: requestBody.shipment.orderId,
    trackId: TrackingNumber,
    events: []
  };

  if (requestBody?.networkPartner?.networkPartnerLBNID) {
    SapEventRequest.networkPartner = { networkPartnerLBNID: requestBody.networkPartner.networkPartnerLBNID };
  }

  return SapEventRequest;
}

module.exports = router;
