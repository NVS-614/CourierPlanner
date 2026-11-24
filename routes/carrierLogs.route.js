const express = require('express');
const router = express.Router();
const carrierLogsController = require('../controllers/carrierLogs.controller');

/**
 * @swagger
 * /logs/carrier:
 *   get:
 *     summary: Retrieve carrier API transaction logs
 *     description: Returns locally stored carrier request and response exchanges, optionally filtered by delivery number or carrier. Requires an authenticated Swagger Google session.
 *     tags: [Carrier Logs]
 *     parameters:
 *       - in: query
 *         name: deliveryNo
 *         schema:
 *           type: string
 *         description: Delivery or document number
 *       - in: query
 *         name: carrier
 *         schema:
 *           type: string
 *         description: Carrier name or partial name
 *       - in: query
 *         name: operation
 *         schema:
 *           type: string
 *         description: HTTP operation or route text
 *       - in: query
 *         name: from
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Inclusive start timestamp
 *       - in: query
 *         name: to
 *         schema:
 *           type: string
 *           format: date-time
 *         description: Inclusive end timestamp
 *       - in: query
 *         name: limit
 *         schema:
 *           type: integer
 *           default: 100
 *           maximum: 500
 *       - in: query
 *         name: offset
 *         schema:
 *           type: integer
 *           default: 0
 *     responses:
 *       200:
 *         description: Carrier API logs
 *       400:
 *         description: Invalid query parameter
 *       500:
 *         description: File storage or server error
 */
router.get('/carrier', carrierLogsController.getCarrierLogs);

/**
 * @swagger
 * /logs/delivery/{deliveryNo}:
 *   get:
 *     summary: Retrieve carrier API logs for a delivery
 *     tags: [Carrier Logs]
 *     parameters:
 *       - in: path
 *         name: deliveryNo
 *         required: true
 *         schema:
 *           type: string
 *         description: Delivery or document number
 *     responses:
 *       200:
 *         description: Carrier API logs for the delivery
 *       400:
 *         description: Invalid query parameter
 *       500:
 *         description: File storage or server error
 */
router.get('/delivery/:deliveryNo', carrierLogsController.getCarrierLogs);

module.exports = router;
