// routes/void.route.js

const express = require('express');
const router = express.Router();
const voidController = require('../controllers/void.controller');

/**
 * @swagger
 * /void:
 *   post:
 *     summary: Void Shipment
 *     tags: [Void]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/CancelRequest'
 *     responses:
 *       200:
 *         description: Void Response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/CancelResponse'
 *       400:
 *         description: Bad Request
 */
router.post('/', voidController.void);

module.exports = router;