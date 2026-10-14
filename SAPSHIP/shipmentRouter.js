const FedExShip = require("../CARRIER/FEDEX/SapFedEx.js");
const UPSShip = require("../CARRIER/UPS/SapUPS.js");
const DHLShip = require("../CARRIER/DHL/SapDHL.js");
const ABFShip = require("../CARRIER/ABF/SapABF.js");

const carrierHandlers = {
  FEDEX: FedExShip.SapFedEx,
  UPS: UPSShip.SapUPS,
  DHL: DHLShip.Sapdhl,
  ABF: ABFShip.SapABF
};

async function processShipment(shipment) {
  const carrier = shipment?.CARRIER_DETAILS?.Carrier?.toUpperCase();
  const handler = carrierHandlers[carrier];

  if (!handler) {
    throw new Error(`Unsupported carrier: ${carrier}`);
  }
  return await handler(shipment);
  
}

module.exports = { processShipment };
