const express = require("express");
const router = express.Router();
const pLimit = require("p-limit").default;
const { processShipment } = require("./shipmentRouter");

// Global concurrency limit
const limit = pLimit(5); // max 5 parallel shipments

router.post("/", async (req, res) => {
  try {
    const shipments = req.body; // ✅ FIX 1

    if (!Array.isArray(shipments)) {
      return res.status(400).json({ error: "Request body must be an array" });
    }

    const tasks = shipments.map(shipment =>
      limit(async () => {
        try {
          const result = await processShipment(shipment); // ✅ FIX 2
          return {
            documentNumber: shipment.HEADER_INFO?.DocumentNumber,
            carrier: shipment.CARRIER_DETAILS?.Carrier,
            response: result
          };
        } catch (error) {
          return {
            documentNumber: shipment.HEADER_INFO?.DocumentNumber,
            carrier: shipment.CARRIER_DETAILS?.Carrier,
            success: false,
            error: error.message
          };
        }
      })
    );

    const results = await Promise.all(tasks); // ✅ FIX 3
    res.json(results);

  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
