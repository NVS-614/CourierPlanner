const express = require('express');
const router = express.Router();
const multer = require('multer');
const shipController = require('../controllers/ship.controller');

/*
  Use memory storage (best for Docker / Cloud Foundry)
  No disk usage
*/
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 } // 10MB limit
});

/*
  Always allow invoiceFile
  Only FedEx / UPS will use it
  Others ignore req.file safely
*/

/**
 * @swagger
 * /ship:
 *   post:
 *     summary: Create Shipment
 *     tags: [Ship]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/ShipRequest'
 *     responses:
 *       200:
 *         description: Shipment created successfully
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/ShipResponse'
 */
router.post(
  '/',
  upload.single('invoiceFile'),
  shipController.ship
);

module.exports = router;