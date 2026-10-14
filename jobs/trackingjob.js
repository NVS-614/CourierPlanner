const express = require('express'); 
const router = express.Router();
const track = require("./shipmentTracker.js");

router.post('/', async (request, response) => {
  response.header("Access-Control-Allow-Origin", "*");
  response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

  try {
    console.log('Running shipment tracking job...');
    await track.track_SapCloudTmsDB(request);  //track_SapCloudTmsDB ,track_ShipmentsDB
    console.log('Tracking job completed.');
    response.status(200).send({ status: 'Tracking Job Completed' });
  } catch (error) {
    console.error('Tracking job failed:', error);
    response.status(500).send({ error: 'Tracking job failed' });
  }
});

module.exports = router;
