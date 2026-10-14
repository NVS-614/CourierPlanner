const express = require("express");
const router = express.Router();
const db = require("../database/db");

router.post("/", async (req, res) => {
  try {
    const docNumbers = req.body?.DELIVERY_NUMBERS || req.body?.REQUEST?.DELIVERY_NUMBERS || [];
    const trackNumbers = req.body?.TRACKING_NUMBERS || req.body?.REQUEST?.TRACKING_NUMBERS || [];

    const RESPONSE = await getShipmentSummary(docNumbers, trackNumbers);

    res.json({ RESPONSE });
  } catch (err) {
    console.error(err);
    res.status(500).json({ ERROR: err.message });
  }
});

async function getShipmentSummary(docNumbers, trackNumbers) {

  const sql = `
    SELECT details
    FROM public.shipments
    WHERE details @> '{"TRACKING_STATUS":"Shipped"}'
    AND (
        ($1::text[] IS NOT NULL AND details->'HEADER_INFO'->>'DOCUMENT_NUMBER' = ANY($1))
        OR
        ($2::text[] IS NOT NULL AND (
            details->'HEADER_INFO'->>'MASTER_TRACKING_NUMBER' = ANY($2)
            OR EXISTS (
                SELECT 1
                FROM jsonb_array_elements(details->'PACKAGES') pkg
                WHERE pkg->>'TRACKING_NUMBER' = ANY($2)
            )
        ))
    )
  `;
  const result = await db.query(sql, [docNumbers, trackNumbers]);
  // return only the `details` objects, not wrapped in { details: ... }
  return result.map(row => row.details);
}

module.exports = router;