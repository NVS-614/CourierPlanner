const express = require('express');
const router = express.Router();
const basicAuth = require('basic-auth');
const dbCon = require("../database/dbsaveandupdate.js");
const pushtrack = require("../jobs/shipmentTracker.js");


// Set your accepted basic auth credentials
const AUTH_USER = 'abc';
const AUTH_PASS = 'xyz';

// Middleware to check Basic Auth
function authMiddleware(req, res, next) {
  const user = basicAuth(req);

  if (!user || user.name !== AUTH_USER || user.pass !== AUTH_PASS) {
    res.set('WWW-Authenticate', 'Basic realm="PushTrackevents"');
    return res.status(401).send({ error: 'Authentication required/failed.' });
  }

  next();
}

/**
 * @swagger
 * /api/pushtrackevents/{carrier}:
 *   put:
 *     summary: Receive tracking data from a carrier.
 *     description: Carriers Push the event statuses when the event change(FEDEX, UPS, DHL, etc.).
 *     security:
 *       - basicAuth: []
 *     parameters:
 *       - in: pathPush
 *         name: carrier
 *         required: true
 *         schema:
 *           type: string
 *           enum: [FEDEX, UPS, DHL,ABF]
 *         description: The carrier to use for the push events.
 *     requestBody:
 *       required: true
 *       content:
  *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               trackingNumber:
 *                 type: string
 *               status:
 *                 type: string
 *               timestamp:
 *                 type: string
 *                 format: date-time
 *     responses:
 *       200:
 *         description: Track Events Pushed successfully
 *       400:
 *         description: Invalid input
 *       404:
 *         description: Carrier not found
 */


// router.post('/:carrier', async (req, res) => {
//   const { carrier } = req.params;
//   const shipmentData = req.body;
//   let result;
//   // Dynamically call the appropriate carrier module
//   switch (carrier.toLowerCase()) {
//     case 'fedex':
//       result = fedex.createShipment(shipmentData);
//       break;
//     default:
//       return res.status(404).json({ error: 'Carrier not found' });
//   }
//   res.json(result);
// });


router.put('/:carrier', authMiddleware, async (req, res) => {
  try {
    const { carrier } = req.params;
    const trackingData = req.body;
    console.log(`Received tracking data from ${carrier}:`, trackingData);
    await dbCon.dbSAP_pushCarrierEvent_transactionssave(trackingData, carrier);
    const result = await pushtrack.DirectCarrier_PushTrackShipment(trackingData, carrier);
    res.json(result);
  } catch (error) {
    console.error('Error processing pushTrack response:', error.message);
    res.status(500).json({ error: 'Internal server error' });
  }
});

module.exports = router;