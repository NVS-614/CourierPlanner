// factories/carrier.factory.js

const fs = require('fs');
const { STATUS_CODES } = require('http');
const path = require('path');

const carriers = {};
const carriersPath = path.join(__dirname, '../carriers');
/*
  Load all carriers at startup
  This runs only once when app boots
*/
fs.readdirSync(carriersPath).forEach(folder => {
    const carrierPath = path.join(carriersPath, folder);

    if (fs.statSync(carrierPath).isDirectory()) {
        carriers[folder.toUpperCase()] = require(carrierPath);
    }
});

exports.getCarrier = (carrierName, carrierDetails = {}) => {

    if (!carrierName) {
        return {
            rateAll: async () => ({
                status: 'Error',
                message: [{ MESSAGE: 'Carrier name missing' }]
            })
        };
    }

    const carrier = carriers[carrierName?.toUpperCase()];

    if (!carrier) {
        return {
            rateAll: async () => ({
                status: 'Error',
                message: [{ CARRIER: carrierName, MESSAGE: `Unsupported carrier or Integration not available`, STATUSCODE :'' }]
            })
        };
    }

     // Validate at least one credential
    const {
        USERID,
        SHIPPING_ACCOUNT,
        ACCESS_KEY,
         RATE_KEY
    } = carrierDetails;

    if (
        !USERID &&
        !SHIPPING_ACCOUNT &&
        !ACCESS_KEY &&
        !RATE_KEY
    ) {
        return {
            rateAll: async () => ({
                status: 'Error',
                message: [{
                    CARRIER: carrierName,
                    MESSAGE: 'Required credentials missing',
                    STATUSCODE: ''
                }]
            })
        };
    }

    return carrier;
};