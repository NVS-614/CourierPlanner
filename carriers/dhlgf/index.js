// carriers/dhlgf/index.js
//
// DHL Global Forwarding carrier entry.
// Dispatches Ship calls to either the API flow (ship.js) or the EDI flow
// (ediship.js) based on CARRIER_DETAILS.INTEGRATION_TYPE in the request:
//
//   INTEGRATION_TYPE = "EDI"   →  ediship.js  (X12 4010 EDI 204 Motor Carrier Load Tender)
//   INTEGRATION_TYPE = "API"   →  ship.js     (REST API)
//
// Same pattern as carriers/fedex, carriers/ups etc — the carrier.factory
// auto-loads this folder by name, so CARRIER: "DHLGF" in the JSON request
// will resolve to this module.

const apiShip = require('./ship');
const ediShip = require('./ediship');

const isEDI = (req = {}) => {
    const cd = req.CARRIER_DETAILS || {};
    const flag = (cd.INTEGRATION_TYPE || cd.MODE || '').toString().toUpperCase();
    return flag === 'EDI' || flag === 'EDI204' || flag === 'X12' || cd.IS_EDI === true;
};

/**
 * Unified ship dispatcher.
 * Controller calls:  carrier.ship(req.body.REQUEST, chargeCodeData)
 */
const ship = async (request, chargeCodes) => {
    if (typeof request === 'string') request = JSON.parse(request);
    if (isEDI(request)) {
        return ediShip(request, chargeCodes);
    }
    return apiShip(request, chargeCodes);
};

module.exports = {
    ship,
    // expose individual handlers in case they need to be called directly
    apiShip,
    ediShip
};
