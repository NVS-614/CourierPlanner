const ship = require('./ship');
const track = require('./track');
const voidShipment = require('./void');

module.exports = {
  ship,
  track,
  void: voidShipment,
};