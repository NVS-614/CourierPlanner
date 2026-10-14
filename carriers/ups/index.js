const ship = require('./ship');
const returns = require('./return');
const track = require('./track');
const voidShipment = require('./void');
const rateAll = require('./rateAll');

module.exports = {
  ship,returns,
  track,
  void: voidShipment,
  rateAll
};