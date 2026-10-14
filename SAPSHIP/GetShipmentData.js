const express = require('express');
const router = express.Router();
const db = require('../database/db');

router.post("/", async (req, res) => {
  try {
    const docNumbers = req.body.deliveryNumbers;
    const data = await getShipmentSummary(docNumbers);
    //console.log(data);
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});


async function getShipmentSummary(docNumbers) {
  const sql = `
    SELECT
      details -> 'HEADER_INFO' ->> 'DOCUMENT_NUMBER' AS "DOCUMENT_NUMBER",
      jsonb_agg(
        jsonb_build_object(
          'TRACKING_NUMBER', p ->> 'TRACKING_NUMBER'
        )
      ) FILTER (WHERE p ? 'TRACKING_NUMBER')        AS "PACKAGES",
      details -> 'SHIPPING_CHARGES'                 AS "SHIPPING_CHARGES",
      details -> 'SHIPPING_DOCUMENTS'               AS "SHIPPING_DOCUMENTS",
      details ->> 'STATUS'                         AS "STATUS",
      details ->> 'TRACKING_STATUS'                 AS "TRACKING_STATUS"
    FROM public.shipments
    LEFT JOIN LATERAL
      jsonb_array_elements(details -> 'PACKAGES') p ON true
    WHERE details -> 'HEADER_INFO' ->> 'DOCUMENT_NUMBER' = ANY($1)
    GROUP BY
      details -> 'HEADER_INFO' ->> 'DOCUMENT_NUMBER',
      details -> 'SHIPPING_CHARGES',
      details -> 'SHIPPING_DOCUMENTS',
      details ->> 'STATUS',
      details ->> 'TRACKING_STATUS';
  `;

  const result  = await db.query(sql, [docNumbers]);
  return result;
}

async function getShipmentSummary(docNumbers) {
  const sql = `
    SELECT
      details -> 'HEADER_INFO' ->> 'DOCUMENT_NUMBER' AS "DOCUMENT_NUMBER",
      jsonb_agg(
        jsonb_build_object(
          'TRACKING_NUMBER', p ->> 'TRACKING_NUMBER'
        )
      ) FILTER (WHERE p ? 'TRACKING_NUMBER')        AS "PACKAGES",
      details -> 'SHIPPING_CHARGES'                 AS "SHIPPING_CHARGES",
      details -> 'SHIPPING_DOCUMENTS'               AS "SHIPPING_DOCUMENTS",
      details ->> 'STATUS'                         AS "STATUS",
      details ->> 'TRACKING_STATUS'                 AS "TRACKING_STATUS"
    FROM public.shipments
    LEFT JOIN LATERAL
      jsonb_array_elements(details -> 'PACKAGES') p ON true
    WHERE details -> 'HEADER_INFO' ->> 'DOCUMENT_NUMBER' = ANY($1)
    GROUP BY
      details -> 'HEADER_INFO' ->> 'DOCUMENT_NUMBER',
      details -> 'SHIPPING_CHARGES',
      details -> 'SHIPPING_DOCUMENTS',
      details ->> 'STATUS',
      details ->> 'TRACKING_STATUS';
  `;

  const result  = await db.query(sql, [docNumbers]);
  return result;
}



module.exports = router;
