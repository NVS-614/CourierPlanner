// routes/track.route.js

const express = require('express');
const router = express.Router();
const trackController = require('../controllers/track.controller');

/**
 * @swagger
 * /track:
 *   post:
 *     summary: Track Shipment
 *     tags: [Track]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/TrackRequest'
 *     responses:
 *       200:
 *         description: Tracking Response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/TrackResponse'
 *       400:
 *         description: Bad Request
 */
router.post('/', trackController.track);

module.exports = router;