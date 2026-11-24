'use strict';
/**
 * Uber Direct — Track: GET /deliveries/{delivery_id}
 * When delivered, also pulls POD (POST /deliveries/{id}/proof-of-delivery) into POD (base64).
 */
const axios = require('axios');
const { buildTrackResponse, buildEvent } = require('../../Reuse/trackResponseFormatter');
const uber = require('./uberCommon.js');

const STATUS_TEXT = {
    pending: 'Delivery created',
    pickup: 'Courier en route to pickup',
    pickup_complete: 'Picked up',
    dropoff: 'Out for delivery',
    delivered: 'Delivered',
    canceled: 'Cancelled',
    returned: 'Returned to sender'
};

function parseAddr(a) {
    if (!a) return null;
    let o = a;
    if (typeof a === 'string') { try { o = JSON.parse(a); } catch { return null; } }
    return { CITY: o.city || null, STATE: o.state || null, POSTAL_CODE: o.zip_code || null, COUNTRY: o.country || null };
}

module.exports = async (request) => {
    const CD = request.CARRIER_DETAILS || {};
    const packages = request.PACKAGES?.length ? request.PACKAGES : [{}];

    let token;
    try { token = await uber.getToken(CD); } catch (e) { token = null; var tokenErr = e; }
    const base = uber.getUrls(CD).trackBase;

    return Promise.all(packages.map(async (pkg) => {
        const TRACK_RESPONSE = buildTrackResponse();
        const id = pkg.TRACKING_NUMBER;
        TRACK_RESPONSE.TRACKING_NUMBER = id || null;
        try {
            if (!token) throw tokenErr;
            if (!id) throw new Error('TRACKING_NUMBER (Uber delivery id) missing');
            const headers = uber.authHeaders(token);
            const { data: d } = await axios.get(`${base}${encodeURIComponent(id)}`, { headers, timeout: 20000 });
            console.log('UBER Track Response:', JSON.stringify(d));

            TRACK_RESPONSE.EXPECTED_DELIVERY_DATE = d.dropoff_eta || d.dropoff_deadline || null;
            TRACK_RESPONSE.ORIGIN = parseAddr(d.pickup?.address);
            TRACK_RESPONSE.DESTINATION = parseAddr(d.dropoff?.address);
            TRACK_RESPONSE.CURRENT_STATUS = STATUS_TEXT[d.status] || d.status || null;
            TRACK_RESPONSE.TRACKING_URL = d.tracking_url || null;

            const loc = d.courier?.location;
            TRACK_RESPONSE.EVENTS.push(buildEvent({
                trackingNumber: id,
                status: TRACK_RESPONSE.CURRENT_STATUS,
                statusCode: d.status,
                dateTime: d.updated || d.created,
                location: loc ? { latitude: String(loc.lat), longitude: String(loc.lng) } : null
            }));

            if (d.status === 'delivered') {
                try {
                    const { data: pod } = await axios.post(`${base}${encodeURIComponent(id)}/proof-of-delivery`,
                        { waypoint: 'dropoff', type: CD.POD_TYPE || 'picture' }, { headers, timeout: 20000 });
                    TRACK_RESPONSE.POD = pod.document || '';
                } catch (podErr) {
                    console.warn('UBER POD not available:', podErr.response?.data || podErr.message);
                }
            }
        } catch (error) {
            console.error('UBER Track Error:', error?.response?.data || error?.message);
            TRACK_RESPONSE.ERRORS.push(...uber.errMessages(error));
        }
        return TRACK_RESPONSE;
    }));
};
