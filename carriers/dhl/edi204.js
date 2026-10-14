// carriers/dhl/edi204.js
//
// DEPRECATED — moved to carriers/dhlgf/ediship.js.
// DHL Global Forwarding is now a separate carrier folder (DHLGF) and
// dispatching between API ship and EDI 204 ship is driven by
// CARRIER_DETAILS.INTEGRATION_TYPE in the standard /api/ship request.
//
// This file is kept as a thin re-export so any older import paths keep
// working until they can be cleaned up.

module.exports = require('../dhlgf/ediship');
