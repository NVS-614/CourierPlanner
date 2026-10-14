const express = require('express');
const router = express.Router();
const axios = require('axios');
const apiRequest = require("../Reuse/apiClient.js");
const trackuse = require("../SAPTRACK/trackUtilities.js");
const dbCon = require("../database/dbsaveandupdate.js");
const dotenv = require('dotenv');
const { getLBNToken } = require('../Reuse/LBNTokenManager.js');

dotenv.config();

router.put('/', async (request, response) => {
  try {
    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");


    let podbase64 = '', strmimeType = "application/pdf"; docType = 'PDF';
    let podfileName = '';


    let lbntrackreq = request.body;
    lbntrackreq.XTRACKINGNO = request.body.trackingId,
      lbntrackreq.Carrier = 'TEST',
      lbntrackreq.CarrierStatus = '',
      lbntrackreq.LBNStatus = '',

      lbntrackreq.trackingEvents = [];

    const uniqueid = await dbCon.dbTracksaveandUpdate(lbntrackreq);

    let logEntry =
    {
      id: uniqueid,
      dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
      endpointURL: "/sapTrack/LBNTrackingObjects",
      EventType: "BN4L_NETWORK-EXTERNAL_SYSTEM",
      request: JSON.stringify(request.body),
      response: '',
      StatusCode: ''
    }
    await dbCon.dbSAP_TRACK_transactionssave(logEntry);

    return response.status(200).json({ success: "LBNTrackingObjects saved " });

  } catch (error) {
    return response.status(500).json({ error: error?.message });
  }
});



module.exports = router;
