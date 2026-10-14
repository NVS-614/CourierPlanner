const express = require('express');
const router = express.Router();

/**
 * @swagger
 * /addressvalidation:
 *   post:
 *     summary: Address Validation
 *     tags: [Address Validation]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             $ref: '#/components/schemas/AddressRequest'
 *     responses:
 *       200:
 *         description: Address Validation Response
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/AddressResponse'
 *       400:
 *         description: Bad Request
 */
router.post('/', require('../carriers/fedex/addressvalidation'));

module.exports = router;