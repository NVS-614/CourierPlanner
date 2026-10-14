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


exports.getCarrier = (carrierName) => {
    if (!carrierName) {
        carrierName = 'GENERIC';
    }
       let carrier;
    carrier = carriers[carrierName?.toUpperCase()];
    if (!carrier) {
        console.warn(`Carrier ${carrierName} not found. Falling back to GENERIC.`);
        carrier = carriers['GENERIC'];
    }
    return carrier;
};