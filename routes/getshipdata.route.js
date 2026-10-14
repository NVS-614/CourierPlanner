const express = require('express');
const router = express.Router();

/**
 * @swagger
 * /getshipData:
 *   post:
 *     summary: Get shipent data
 *     tags: [Get shipment data]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/GetShipRequest'
 *     responses:
 *       200:
 *         description: Get shipment data Response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/GetShipResponse'
 *       400:
 *         description: Bad Request
 */
router.post('/', require('../carriers/getshipdata'));

module.exports = router;