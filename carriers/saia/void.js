
const axios = require('axios');
module.exports = async function Void(request) {
  return {
    STATUS: 'Success',
    TRACKING_NUMBER: request.PACKAGES?.[0]?.TRACKING_NUMBER,
    TRACKING_STATUS: 'Cancelled'
  };
};