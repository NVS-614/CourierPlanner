const express = require('express');
const router = express.Router();
const axios = require('axios');
const trackuse = require("../SAPTRACK/trackUtilities.js");
const dbCon = require("../database/dbsaveandupdate.js");
const dotenv = require('dotenv');


dotenv.config();

// 1) Get from/to addresses for a tracking number
router.get('/:trackingNo', async (req, res) => {
  const trackingNo = req.params.trackingNo;

  try {
    const query = `
      SELECT details
      FROM saptrack
      WHERE details->>'XTRACKINGNO' = $1
      LIMIT 1
    `;
    const result = await db.query(query, [trackingNo]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Tracking number not found' });
    }

    const details = result.rows[0].details;

    // Assuming from/to address is stored in JSON somewhere in details:
    // Adjust the path based on your JSON structure
    const fromAddress = details.fromAddress || null;
    const toAddress = details.toAddress || null;

    res.json({ fromAddress, toAddress });
  } catch (error) {
    console.error('Error fetching tracking info:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 2) Add a tracking event to existing record
router.post('/event', async (req, res) => {
  const event = req.body;

  // Extract trackingNo from event (adjust if needed)
  const trackingNo = event.Masterwaybillno || event.Waybillno || event.DocumentNo;

  if (!trackingNo) {
    return res.status(400).json({ error: 'Tracking number missing in event data' });
  }

  try {
    // Fetch current record
    const selectQuery = `
      SELECT details
      FROM saptrack
      WHERE details->>'XTRACKINGNO' = $1
      LIMIT 1
    `;
    const result = await db.query(selectQuery, [trackingNo]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Tracking number not found' });
    }

    let details = result.rows[0].details;

    // Ensure events array exists
    if (!Array.isArray(details.events)) {
      details.events = [];
    }

    // Add new event
    details.events.push(event);

    // Update record
    const updateQuery = `
      UPDATE saptrack
      SET details = $2
      WHERE details->>'XTRACKINGNO' = $1
    `;
    await db.query(updateQuery, [trackingNo, details]);

    res.json({ message: 'Event added successfully' });
  } catch (error) {
    console.error('Error updating events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// 3) Get all events for a tracking number
router.get('/:trackingNo/events', async (req, res) => {
  const trackingNo = req.params.trackingNo;

  try {
    const query = `
      SELECT details->'events' as events
      FROM saptrack
      WHERE details->>'XTRACKINGNO' = $1
      LIMIT 1
    `;
    const result = await db.query(query, [trackingNo]);

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Tracking number not found' });
    }

    const events = result.rows[0].events || [];

    res.json(events);
  } catch (error) {
    console.error('Error fetching events:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
});



module.exports = router;
