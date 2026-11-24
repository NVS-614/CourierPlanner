
/**| FedEx Field             | Actual Meaning                |
| ----------------------- | ----------------------------- |
| `totalBaseCharge`       | Base transportation price     |
| `totalFreightDiscounts` | Discount on transportation    |
| `totalNetFreight`       | Transportation after discount |
| `totalSurcharges`       | Fuel, DAS, residential etc    |
| `totalNetCharge`        | Final shipping cost           |
Freight = cost to transport goods
totalNetCharge = totalNetFreight + totalSurcharges **/

const carrierFactory = require('../factories/carrier.ratefactory');
const carrierApiLogging = require('../middleware/carrierApiLogging');

exports.rateAll = async (req, res) => {
    const rateResponse = {
        RESPONSE: {
            RATE_SERVICES: [],
            ERRORS: []
        }
    };

    try {
        const chargeCodeData = null;
        const carrierDetailsList = req.body.REQUEST.CARRIER_DETAILS;

        if (!Array.isArray(carrierDetailsList) || carrierDetailsList.length === 0) {
            return res.status(200).json({
                RESPONSE: {
                    RATE_SERVICES: [],
                    ERRORS: [{ "CARRIER": "", MESSAGE: 'CARRIER_DETAILS is required' }]
                }
            });
        }
        console.log('Rate Request to SIG is', JSON.stringify(req.body))
        // 🚀 Run all carriers in parallel
        const ratePromises = carrierDetailsList.map(async (carrierDetails) => {
            try {
                const carrier = carrierFactory.getCarrier(carrierDetails.CARRIER, carrierDetails);

                if (!carrier.rateAll) {
                    return {
                        status: 'Error',
                        message: [{ "CARRIER": carrier.rateAll, MESSAGE: `${carrierDetails.Carrier} RateAll not supported` }]
                    };
                }

                const requestClone = {
                    ...req.body.REQUEST,
                    CARRIER_DETAILS: carrierDetails,
                    chargeCodeData
                };

                return await carrierApiLogging.runWithCarrier(
                    carrierDetails.CARRIER,
                    () => carrier.rateAll(requestClone)
                );

            } catch (err) {
                return {
                    status: 'Error',
                    message: [{ message: err.message }]
                };
            }
        });

        const results = await Promise.all(ratePromises);

        results.forEach(result => {
            if (result?.status?.toUpperCase() === 'SUCCESS') {
                rateResponse.RESPONSE.RATE_SERVICES.push(...(result.rates || []));
            } else if (result?.status?.toUpperCase() === 'ERROR') { // FIX: added optional chaining to prevent crash on undefined status
                rateResponse.RESPONSE.ERRORS.push(...(result.message || []));
            }
        });

        return res.status(200).json(rateResponse);

    } catch (error) {
        rateResponse.RESPONSE.ERRORS.push({ MESSAGE: error.message });
        return res.status(200).json(rateResponse);
    }
};