// controllers/track.controller.js

const carrierFactory = require('../factories/carrier.factory');

exports.track = async (req, res) => {
    try {
        const CarrierDetails = req.body?.CARRIER_DETAILS || req.body?.REQUEST?.CARRIER_DETAILS;
        const carrierName = CarrierDetails?.CARRIER;

        if (!carrierName) {
            return res.status(400).json({
                status: 'Error',
                message: 'Carrier is required in request body'
            });
        }

        const carrier = carrierFactory.getCarrier(carrierName, CarrierDetails);

        if (!carrier.track) {
            return res.status(400).json({
                status: 'Error',
                message: `track not supported for ${carrierName}`
            });
        }

        const RESPONSE = await carrier.track(req.body.REQUEST);

        return res.status(200).json({ RESPONSE });

    } catch (err) {
        return res.status(500).json({
            STATUS: 'Error',
            MESSAGE: err.message
        });
    }
};