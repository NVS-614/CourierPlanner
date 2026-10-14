const express = require('express');
const router = express.Router();
const rateAllController = require('../controllers/rateAll.controller');


/**
 * @swagger
 * /rateall:
 *   post:
 *     summary: Get Rates From Multiple Carriers
 *     tags: [RateAll]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/RateAllRequest'
 *     responses:
 *       200:
 *         description: Rate Response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/RateAllResponse'
 */

router.post('/', rateAllController.rateAll);

module.exports = router;