// controllers/void.controller.js
const dbCon = require("../database/dbsaveandupdate.js");
const carrierFactory = require('../factories/carrier.factory');
exports.void = async (req, res) => {
    try {
       const CarrierDetails = req.body?.CARRIER_DETAILS || req.body?.REQUEST?.CARRIER_DETAILS;
        const carrierName = CarrierDetails?.CARRIER;

        if (!carrierName) {
            return res.status(400).json({
                STATUS: 'Error',
                MESSAGE: 'Carrier is required in request body'
            });
        }
        const trackingNumber = req.body?.PACKAGES?.[0]?.TRACKING_NUMBER || req.body?.REQUEST?.PACKAGES?.[0]?.TRACKING_NUMBER;
        if (!trackingNumber) {
            return res.status(400).json({
                STATUS: 'Error',
                MESSAGE: 'TrackingNumber is required'
            });
        }
        const carrier = carrierFactory.getCarrier(carrierName,CarrierDetails);

        if (!carrier.void) {
            return res.status(400).json({
                STATUS: 'Error',
                MESSAGE: `Ship not supported for ${carrierName}`
            });
        }

        const RESPONSE = await carrier.void(req.body.REQUEST);
        try {
            // FIX: await the async DB call so errors are caught.
            if (RESPONSE.STATUS === 'Success')
                await dbCon.dbShipdelete(req.body.REQUEST);
        } catch (error) {
            console.log(error.message)
        }
        return res.status(200).json({ RESPONSE });

    } catch (err) {
        return res.status(500).json({
            STATUS: 'Error',
            MESSAGE: err.message
        });
    }
};