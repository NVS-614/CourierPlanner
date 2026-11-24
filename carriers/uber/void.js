'use strict';
/** Uber Direct — Void: POST /deliveries/{delivery_id}/cancel */
const axios = require('axios');
const uber = require('./uberCommon.js');

module.exports = async function uberVoid(request) {
    const CD = request.CARRIER_DETAILS || {};
    const trackingNumber = request?.PACKAGES?.[0]?.TRACKING_NUMBER || request?.HEADER_INFO?.MASTER_TRACKING_NUMBER;
    try {
        if (!trackingNumber) throw new Error('TRACKING_NUMBER (Uber delivery id) missing');

        const token = await uber.getToken(CD);
        const url = `${uber.getUrls(CD).voidBase}${encodeURIComponent(trackingNumber)}/cancel`;
        const { data } = await axios.post(url, {}, { headers: uber.authHeaders(token), timeout: 20000 });
        console.log('UBER Void Response:', JSON.stringify(data));

        if (data.status === 'canceled' || data.complete) {
            return { STATUS: 'Success', TRACKING_NUMBER: trackingNumber, TRACKING_STATUS: 'Cancelled' };
        }
        return {
            STATUS: 'Error',
            TRACKING_NUMBER: trackingNumber,
            ERRORS: [`Delivery not cancelled (status: ${data.status || 'unknown'})`]
        };
    } catch (error) {
        console.error('UBER Void Error:', error.response?.data || error.message);
        return { STATUS: 'Error', TRACKING_NUMBER: trackingNumber, ERRORS: uber.errMessages(error) };
    }
};
