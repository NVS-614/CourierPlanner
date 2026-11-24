'use strict';
/**
 * Uber Direct — shared helpers (rateAll, ship, void, track)
 * Spec: https://developer.uber.com/docs/deliveries/direct/api-reference
 *  - Quote:    POST /v1/customers/{customer_id}/delivery_quotes
 *  - Delivery: POST /v1/customers/{customer_id}/deliveries
 *  - Get:      GET  /v1/customers/{customer_id}/deliveries/{id}
 *  - Cancel:   POST /v1/customers/{customer_id}/deliveries/{id}/cancel
 *  - POD:      POST /v1/customers/{customer_id}/deliveries/{id}/proof-of-delivery
 * Money is in CENTS (manifest_total_value, fee). manifest_items weight = grams, dimensions = cm.
 *
 * Swagger tag mapping (CARRIER_DETAILS):
 *   USERID → client_id, PASSWORD → client_secret, SHIPPING_ACCOUNT → customer_id,
 *   TOKENURL / RATEURL / SHIPURL / VOIDURL / TRACKURL → endpoint overrides (CUSTOMERID placeholder allowed)
 */
const { getUberToken } = require('./uber_token_manager');

const CARRIER = 'UBER';
const BASE = 'https://api.uber.com/v1/customers/CUSTOMERID';

function getUrls(CD = {}) {
    const id = encodeURIComponent(CD.SHIPPING_ACCOUNT || '');
    const fill = (u) => String(u).replace('CUSTOMERID', id);
    const slash = (u) => String(u).replace(/\/?$/, '/');
    const deliveries = process.env.UBER_DELIVERY || `${BASE}/deliveries/`;
    return {
        token: CD.TOKENURL || process.env.UBER_TOKEN || 'https://auth.uber.com/oauth/v2/token',
        quote: fill(CD.RATEURL || process.env.UBER_RATE || `${BASE}/delivery_quotes`),
        ship: fill(CD.SHIPURL || process.env.UBER_SHIP || `${BASE}/deliveries`),
        voidBase: fill(slash(CD.VOIDURL || deliveries)),
        trackBase: fill(slash(CD.TRACKURL || deliveries))
    };
}

async function getToken(CD = {}) {
    if (!CD.SHIPPING_ACCOUNT) throw new Error('Uber customer_id missing (CARRIER_DETAILS.SHIPPING_ACCOUNT)');
    return getUberToken(getUrls(CD).token, CD.USERID, CD.PASSWORD, CD.SCOPE || 'eats.deliveries');
}

const authHeaders = (token) => ({
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${token}`
});

/** Swagger AddressInfo → JSON string, as Uber expects */
function normalizeAddress(a = {}) {
    return JSON.stringify({
        street_address: [a.ADDRESS_LINE1, a.ADDRESS_LINE2, a.ADDRESS_LINE3]
            .filter(s => typeof s === 'string' && s.trim())
            .map(s => s.trim()),
        city: String(a.CITY || '').trim(),
        state: String(a.STATE || '').trim(),
        zip_code: String(a.ZIPCODE || '').trim(),
        country: String(a.COUNTRY || 'US').trim()
    });
}

/** E.164-ish phone: keep digits and leading + ; add +1 for 10-digit US/CA numbers */
function normalizePhone(p) {
    if (!p) return undefined;
    let s = String(p).replace(/[^\d+]/g, '');
    if (/^\d{10}$/.test(s)) s = '+1' + s;
    else if (/^1\d{10}$/.test(s)) s = '+' + s;
    return s || undefined;
}

/** pickup_ready_dt: SHIP_DATE if it is in the future, else omit (Uber = ASAP). Past times are rejected by Uber. */
function pickupReady(shipDate) {
    if (!shipDate) return undefined;
    const d = new Date(shipDate);
    if (isNaN(+d) || d.getTime() <= Date.now() + 60 * 1000) return undefined;
    return d.toISOString();
}

const dollarsToCents = (v, fallback = 100) => Math.round((Number(v) || fallback) * 100);
const centsToDollars = (v) => Number(((Number(v) || 0) / 100).toFixed(2));

/** Total shipment value (USD) = sum of PACKAGES[].DECLARED_VALUE, falling back to INSURANCE_AMOUNT */
function totalValue(request = {}) {
    const sum = (request.PACKAGES || []).reduce((t, p) => t + (Number(p.DECLARED_VALUE) || 0), 0);
    return sum || Number(request.SHIPMENT_LVL_SPECIAL_SERVICES?.INSURANCE_AMOUNT) || 0;
}

/** Common quote body (used by rateAll and by ship step 1) */
function buildQuoteBody(request = {}) {
    const { SHIPPER = {}, SHIPTO = {}, HEADER_INFO = {} } = request;
    const q = {
        pickup_address: normalizeAddress(SHIPPER),
        dropoff_address: normalizeAddress(SHIPTO),
        pickup_phone_number: normalizePhone(SHIPPER.PHONE),
        dropoff_phone_number: normalizePhone(SHIPTO.PHONE),
        manifest_total_value: dollarsToCents(totalValue(request))
    };
    const ready = pickupReady(HEADER_INFO.SHIP_DATE);
    if (ready) q.pickup_ready_dt = ready;
    // Optional geo hints (not in swagger AddressInfo; used only if the caller sends them)
    if (SHIPPER.LATITUDE && SHIPPER.LONGITUDE) {
        q.pickup_latitude = Number(SHIPPER.LATITUDE);
        q.pickup_longitude = Number(SHIPPER.LONGITUDE);
    }
    if (SHIPTO.LATITUDE && SHIPTO.LONGITUDE) {
        q.dropoff_latitude = Number(SHIPTO.LATITUDE);
        q.dropoff_longitude = Number(SHIPTO.LONGITUDE);
    }
    if (HEADER_INFO.LOCATION) q.external_store_id = String(HEADER_INFO.LOCATION);
    Object.keys(q).forEach(k => q[k] === undefined && delete q[k]);
    return q;
}

/** Weight → grams, Uber manifest_items.weight */
function toGrams(weight, unit) {
    const w = Number(weight) || 0;
    const u = String(unit || 'LB').toUpperCase();
    if (u.startsWith('KG')) return Math.round(w * 1000);
    if (u.startsWith('G')) return Math.round(w);
    if (u.startsWith('OZ')) return Math.round(w * 28.3495);
    return Math.round(w * 453.592); // LB default
}

/** "LxWxH" → { length, depth, height } in cm */
function toDimensions(dim, unit) {
    if (!dim || String(dim).startsWith('0')) return null;
    const [l, w, h] = String(dim).toUpperCase().split('X').map(Number);
    if (![l, w, h].every(n => n > 0)) return null;
    const f = String(unit || 'IN').toUpperCase().startsWith('CM') ? 1 : 2.54;
    return { length: Math.round(l * f), depth: Math.round(w * f), height: Math.round(h * f) };
}

const SIZES = ['small', 'medium', 'large', 'xlarge'];
const itemSize = (s) => (SIZES.includes(String(s || '').toLowerCase()) ? String(s).toLowerCase() : 'small');

/** Uber error body: { code, message, kind:'error', metadata:{...} } → string[] */
function errMessages(error) {
    const d = error?.response?.data;
    if (!d) return [error?.message || String(error)];
    const msgs = [];
    if (d.code || d.message) msgs.push([d.code, d.message].filter(Boolean).join(' - '));
    if (d.metadata && typeof d.metadata === 'object') {
        Object.entries(d.metadata).forEach(([k, v]) => msgs.push(`${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`));
    }
    if (d.error) msgs.push([d.error, d.error_description].filter(Boolean).join(' - '));
    return msgs.length ? msgs : [typeof d === 'string' ? d : JSON.stringify(d)];
}

module.exports = {
    CARRIER, getUrls, getToken, authHeaders,
    normalizeAddress, normalizePhone, buildQuoteBody, totalValue,
    dollarsToCents, centsToDollars, toGrams, toDimensions, itemSize, errMessages
};
