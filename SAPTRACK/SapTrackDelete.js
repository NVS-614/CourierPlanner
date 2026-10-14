const express = require('express');
const router = express.Router();
const dbCon = require("../database/dbsaveandupdate.js");
const axios = require('axios');
const dotenv = require('dotenv');
const basicAuth = require('basic-auth');
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


router.delete('/', async (request, response) => {
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  try {
    const uniqueid = await dbCon.dbSAP_TRACK_Delete(request.body?.trackId);
    return response.status(200).send('');
    // let logEntry =
    // {
    //   id: uniqueid,
    //   dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
    //   endpointURL: "/sapTrack/LBNOrderForTracking",
    //   EventType: "BN4L_NETWORK-EXTERNAL_SYSTEM",
    //   request: JSON.stringify(request.body),
    //   response: '',
    //   StatusCode: ''
    // }
    // await dbCon.dbSAP_TRACK_transactionssave(logEntry);
    // const token = await getLBNToken();
    // try {
    //   const sapRes = await axios.post(process.env.LBN_CLOUD_ORDEREVENTS_URL, request, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });


    //   return response.status(200).json(sapRes.data);
    // } catch (error) {

    //   return response.status(500).json({ error: "SAP API request failed" });
    // }

  } catch (error) {
    console.log(error?.response?.data || error?.message)
    return response.status(500).json({ error: error?.message });
  }
});


module.exports = router;
