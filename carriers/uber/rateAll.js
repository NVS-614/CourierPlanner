'use strict';
/**
 * Uber Direct — RateAll (Create Quote)
 * POST /v1/customers/{customer_id}/delivery_quotes
 * Response: { id:'dqt_...', fee (cents), currency, expires, duration, pickup_duration, dropoff_eta, dropoff_deadline }
 * Returns { status:'Success', rates:[RATE_SERVICE] } | { status:'Error', message:[{CARRIER,STATUSCODE,MESSAGE}] }
 */
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const uber = require('./uberCommon.js');

module.exports = async function UBERRateAll(request) {
    const CD = request.CARRIER_DETAILS || {};
    const HI = request.HEADER_INFO || {};
    try {
        const urls = uber.getUrls(CD);
        const token = await uber.getToken(CD);
        const quoteBody = uber.buildQuoteBody(request);
        console.log('UBER Rate Request:', JSON.stringify(quoteBody));

        const { data: q } = await axios.post(urls.quote, quoteBody, { headers: uber.authHeaders(token), timeout: 20000 });
        console.log('UBER Rate Response:', JSON.stringify(q));

        const amount = uber.centsToDollars(q.fee);
        const currency = (q.currency_type || q.currency || 'USD').toUpperCase();

        const rate = reuse.handleRateRes(
            uber.CARRIER,
            CD.SHIPPING_ACCOUNT,
            CD.SERVICE_CODE || 'UBER_DIRECT',
            CD.SERVICE_NAME || 'Uber Direct',
            amount,                       // DISCOUNTED_FREIGHT
            amount,                       // PUBLISHED_FREIGHT (Uber returns a single price)
            q.dropoff_eta || q.dropoff_deadline || '',
            '0',                          // same-day courier
            currency,
            HI.ShippingPoint, HI.SalesOrderDate
        );
        rate.CHARGE_DETAILS = [
            reuse.handlesurCharRes(uber.CARRIER, 'DELIVERY_FEE', 'Delivery Fee', amount, currency, request.chargeCodeData)
        ];
        rate.QUOTE_ID = q.id;
        rate.QUOTE_EXPIRES_ON = q.expires || '';

        return { status: 'Success', rates: [rate] };
    } catch (error) {
        console.error('UBER Rate Error:', error.response?.data || error.message);
        return {
            status: 'Error',
            message: uber.errMessages(error).map(m => ({
                CARRIER: uber.CARRIER,
                STATUSCODE: error?.response?.status || '',
                MESSAGE: m
            }))
        };
    }
};
