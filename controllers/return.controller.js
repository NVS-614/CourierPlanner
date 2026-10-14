// controllers/return.controller.js
const dbCon = require("../database/dbsaveandupdate.js");
const carrierFactory = require('../factories/carrier.factory');

exports.return = async (req, res, next) => {
    try {
        const CarrierDetails = req.body?.CARRIER_DETAILS || req.body?.REQUEST?.CARRIER_DETAILS;
        const carrierName = CarrierDetails.CARRIER;
        if (!carrierName) {
            return res.status(400).json({
                STATUS: 'Error',
                MESSAGE: 'Carrier is required in request body'
            });
        }
        const service = CarrierDetails?.SERVICE_CODE || CarrierDetails?.SERVICE_NAME;
        if (!service) {
            return res.status(400).json({
                STATUS: 'Error',
                MESSAGE: 'Service code is required in request body'
            });
        }

        if (CarrierDetails?.PAYMENT_TYPE?.toUpperCase() === 'SENDER') { // FIX: added ?. to avoid crash when PAYMENT_TYPE is undefined
            if (!CarrierDetails?.SHIPPING_ACCOUNT) {
                return res.status(400).json({
                    STATUS: 'Error',
                    MESSAGE: `ShippingAccount is required when PaymentType is SENDER for ${carrierName}`
                });
            }
        } else {
            if (!CarrierDetails?.BILLING_ACCOUNT) {
                return res.status(400).json({
                    STATUS: 'Error',
                    MESSAGE: `BillingAccount is required when PaymentType is 3rd Party or Recipient for ${carrierName}.`
                });
            }
        }
        const carrier = carrierFactory.getCarrier(carrierName, CarrierDetails);

        if (!carrier.returns) {
            return res.status(400).json({
                STATUS: 'Error',
                MESSAGE: `Ship not supported for ${carrierName}`
            });
        }

        const RESPONSE = await carrier.returns(req.body.REQUEST);
        try {
            // FIX: await the async DB call so errors are caught.
            if (RESPONSE.STATUS === 'Success')
                await dbCon.dbShipsave(RESPONSE);
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