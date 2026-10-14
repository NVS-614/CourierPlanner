const ship = require('./ship');
const track = require('./track');
const voidShipment = require('./void');
const rateAll = require('./rateAll');

module.exports = {
  ship,
  track,
  void: voidShipment,
  rateAll
};