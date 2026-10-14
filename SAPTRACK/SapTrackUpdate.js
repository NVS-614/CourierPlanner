const express = require('express');
const router = express.Router();
const track = require("../jobs/shipmentTracker.js");
const db = require('../database/db');

router.post('/', async (request, response) => {
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  try {
    const checkquery = `SELECT * FROM public.saptrack WHERE details->>'XTRACKINGNO' = $1`;
    const result = await db.query(checkquery, [request.body.XTRACKINGNO]);

    if (result.length > 0) {
      const trackresult = await track.process_JobTrackShipmentDB(result[0]);
      response.status(200).send(trackresult);
    } else {
      console.log('No matching record found.');
      response.status(500).send({ error: 'No matching record found' });
    }
  } catch (error) {
    console.error('Tracking request failed:', error);
    response.status(500).send({ error: 'Tracking request failed' });
  }
});


module.exports = router;
