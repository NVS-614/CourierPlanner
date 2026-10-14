// carriers/fedex/track.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildTrackResponse, buildEvent } = require('../../Reuse/trackResponseFormatter');


module.exports = async (request) => {
    const TRACK_RESPONSE = buildTrackResponse();

   
    return TRACK_RESPONSE;
};
