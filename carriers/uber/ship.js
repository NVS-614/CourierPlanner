'use strict';
/**
 * Uber Direct — Ship: Create Quote → Create Delivery (with quote_id)
 * Uber delivery id (del_...) is returned as PACKAGES[].TRACKING_NUMBER / HEADER_INFO.MASTER_TRACKING_NUMBER.
 */
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildFinalResponse } = require('../../Reuse/responseBuilder');
const uber = require('./uberCommon.js');

module.exports = async (request) => {
    const FINALRESPONSE = buildFinalResponse(request);
    const CD = request.CARRIER_DETAILS || {};
    FINALRESPONSE.CARRIER = uber.CARRIER;
    FINALRESPONSE.ACCOUNT_NUMBER = CD.SHIPPING_ACCOUNT || '';
    FINALRESPONSE.SERVICE_CODE = CD.SERVICE_CODE || 'UBER_DIRECT';
    FINALRESPONSE.SERVICE_NAME = CD.SERVICE_NAME || 'Uber Direct';

    try {
        if (!request.PACKAGES?.length) throw new Error('PACKAGES missing');

        const urls = uber.getUrls(CD);
        const token = await uber.getToken(CD);
        const headers = uber.authHeaders(token);

        // Step 1: Quote
        const quoteBody = uber.buildQuoteBody(request);
        console.log('UBER CreateQuote req', JSON.stringify(quoteBody));
        const { data: quote } = await axios.post(urls.quote, quoteBody, { headers, timeout: 20000 });

        // Step 2: Delivery
        const deliveryBody = createDeliveryReq(request, quoteBody, quote.id);
        console.log('UBER CreateDelivery req', JSON.stringify(deliveryBody));
        const { data: delivery } = await axios.post(urls.ship, deliveryBody, { headers, timeout: 30000 });
        console.log('UBER CreateDelivery res', JSON.stringify(delivery));

        const trackingNumber = request.HEADER_INFO?.PRO_TRACKING_NUMBER || delivery.id;
        request.PACKAGES.forEach(() => FINALRESPONSE.PACKAGES.push({ TRACKING_NUMBER: trackingNumber }));

        const amount = uber.centsToDollars(delivery.fee);
        const currency = (delivery.currency || 'USD').toUpperCase();

        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Shipped';
        FINALRESPONSE.DISCOUNTED_FREIGHT = amount.toString();
        FINALRESPONSE.PUBLISHED_FREIGHT = amount.toString();
        FINALRESPONSE.CURRENCY = currency;
        FINALRESPONSE.EXPECTED_DELIVERY_DATE = delivery.dropoff_eta || delivery.dropoff_deadline || '';
        FINALRESPONSE.TRANSIT_DAYS = '0';
        FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipRateRes('Delivery Fee', amount, currency, 'DELIVERY_FEE'));
        FINALRESPONSE.HEADER_INFO = {
            ...FINALRESPONSE.HEADER_INFO,
            MASTER_TRACKING_NUMBER: trackingNumber,
            QUOTE_ID: quote.id,
            TRACKING_URL: delivery.tracking_url || ''
        };
        return FINALRESPONSE;

    } catch (error) {
        console.error('UBER Ship Error:', error.response?.data || error.message);
        FINALRESPONSE.STATUS = 'Error';
        FINALRESPONSE.ERRORS = uber.errMessages(error);
        return FINALRESPONSE;
    }
};

function createDeliveryReq(request, quoteBody, quoteId) {
    const { SHIPPER = {}, SHIPTO = {}, HEADER_INFO = {}, PACKAGES = [] } = request;
    const d = {
        quote_id: quoteId,
        pickup_name: SHIPPER.CONTACT || SHIPPER.COMPANY || 'Pickup Contact',
        pickup_business_name: SHIPPER.COMPANY || '',
        pickup_phone_number: quoteBody.pickup_phone_number,
        pickup_address: quoteBody.pickup_address,
        dropoff_name: SHIPTO.CONTACT || SHIPTO.COMPANY || 'Dropoff Contact',
        dropoff_business_name: SHIPTO.COMPANY || '',
        dropoff_phone_number: quoteBody.dropoff_phone_number,
        dropoff_address: quoteBody.dropoff_address,
        dropoff_notes: HEADER_INFO.NOTES || '',
        manifest_reference: String(HEADER_INFO.PO_NUMBER || HEADER_INFO.CUSTOMER_REFERENCE || HEADER_INFO.DOCUMENT_NUMBER || ''),
        manifest_total_value: quoteBody.manifest_total_value,
        external_id: String(HEADER_INFO.DOCUMENT_NUMBER || ''),
        manifest_items: PACKAGES.map(p => {
            const info = p.ITEM_INFO?.[0] || {};
            const qty = Number(info.QUANTITY || p.QUANTITY || 1);
            const item = {
                name: info.DESCRIPTION || p.DESCRIPTION || 'Package',
                quantity: qty,
                price: uber.dollarsToCents((Number(p.DECLARED_VALUE) || 0) / qty, 1),
                size: uber.itemSize(p.ITEM_PACKING_TYPE || info.ITEM_PACKING_TYPE),
                weight: uber.toGrams(p.WEIGHT, p.WEIGHT_UNITS)
            };
            const dims = uber.toDimensions(p.DIMENSION, p.DIMENSION_UNITS);
            if (dims) item.dimensions = dims;
            return item;
        })
    };
    ['pickup_ready_dt', 'pickup_latitude', 'pickup_longitude', 'dropoff_latitude', 'dropoff_longitude', 'external_store_id']
        .forEach(k => { if (quoteBody[k] !== undefined) d[k] = quoteBody[k]; });
    Object.keys(d).forEach(k => (d[k] === '' || d[k] === undefined) && delete d[k]);
    return d;
}
