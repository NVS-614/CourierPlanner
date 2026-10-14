const express = require('express');
const router = express.Router();
const multer = require('multer');
const returnController = require('../controllers/return.controller');


/**
 * @swagger
 * /return:
 *   post:
 *     summary: Create Return Shipment
 *     tags: [Return Shipment]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipRequest'
 *     responses:
 *       200:
 *         description: Return Shipment created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipResponse'
 */
router.post('/', returnController.return);

module.exports = router;