const ship = require('./ship');
const returns = require('./return');
const track = require('./track');
const voidShipment = require('./void');
const rateAll = require('./rateAll');
const ipdchild = require('./ipdchild');
const ipdmaster = require('./ipdmaster');
const ipdclose = require('./ipdclose');

module.exports = {
  ship, returns,
  ipdmaster,ipdchild,ipdclose,
  track,
  void: voidShipment,
  rateAll
};