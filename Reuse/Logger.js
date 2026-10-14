const EventEmitter = require('events');
class Emitter extends EventEmitter {}
const logEmitter = new Emitter();

module.exports = logEmitter;