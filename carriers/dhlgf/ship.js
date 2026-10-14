// carriers/dhlgf/ship.js
//
// DHL Global Forwarding — API Ship handler.
// Calls DHL GF Shipment Booking API:
//   POST https://api-sandbox.dhl.com/dgff/transportation/shipment-booking   (sandbox)
//   POST https://api.dhl.com/dgff/transportation/shipment-booking            (prod)
//
// Spec: https://developer.dhl.com/api-reference/dgf-shipment-booking
//
// Same async signature as every other carrier:
//   module.exports = async (request, chargeCodes) => RESPONSE
//
// The controller calls this when CARRIER_DETAILS.INTEGRATION_TYPE != "EDI".
// Authentication:
//   Bearer token expected in:
//     CARRIER_DETAILS.ACCESS_KEY    (preferred — per-tenant)
//     CARRIER_DETAILS.BEARER_TOKEN
//     process.env.DHLGF_TOKEN
//
// Endpoint override:
//   CARRIER_DETAILS.SHIPURL  or  process.env.DHLGF_SHIP
//
// Author: SIG Shipping Engine

const axios = require('axios');
const { buildFinalResponse } = require('../../Reuse/responseBuilder');

const axiosInstance = axios.create({
    timeout: 30000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

const isTrue = (v) =>
    v === true ||
    (typeof v === 'string' && ['true', 'x', 'yes', '1'].includes(v.toLowerCase().trim()));

module.exports = async (request, chargeCodes) => {
    if (typeof request === 'string') request = JSON.parse(request);

    const FINALRESPONSE = buildFinalResponse(request);
    FINALRESPONSE.CARRIER = 'DHLGF';

    const CARRIER_DETAILS  = request?.CARRIER_DETAILS  || {};
    const HEADER_INFO      = request?.HEADER_INFO      || {};
    const INTL             = request?.INTERNATIONAL_DETAILS || {};
    const SLSS             = request?.SHIPMENT_LVL_SPECIAL_SERVICES || {};
    const SHIPPER          = request?.SHIPPER  || request?.SHIPFROM || {};
    const SHIPTO           = request?.SHIPTO   || {};
    const BILLTO           = request?.BILLTO   || request?.SOLDTO || {};
    const NOTIFY           = request?.NOTIFY   || request?.ALTERNATE_ADDRESS || null;
    const PACKAGES         = Array.isArray(request?.PACKAGES) ? request.PACKAGES : [];

    const shipUrl  = CARRIER_DETAILS.SHIPURL || process.env.DHLGF_SHIP
                   || 'https://api-sandbox.dhl.com/dgff/transportation/shipment-booking';

    const token    = CARRIER_DETAILS.ACCESS_KEY
                   || CARRIER_DETAILS.BEARER_TOKEN
                   || process.env.DHLGF_TOKEN;

    if (!token) {
        FINALRESPONSE.STATUS = 'Error';
        FINALRESPONSE.ERRORS.push(
            'DHL Global Forwarding Bearer token missing. Provide CARRIER_DETAILS.ACCESS_KEY or set DHLGF_TOKEN env.'
        );
        return FINALRESPONSE;
    }

    try {
        /* ===========================
           BUILD REQUEST
        =========================== */
        const bookReq = buildBookingRequest({
            CARRIER_DETAILS, HEADER_INFO, INTL, SLSS,
            SHIPPER, SHIPTO, BILLTO, NOTIFY, PACKAGES
        });

        console.log('[DHLGF] Booking Request:', JSON.stringify(bookReq));

        /* ===========================
           API CALL
        =========================== */
        const sres = await axiosInstance.post(shipUrl, bookReq, {
            headers: {
                'accept':        'application/json',
                'content-type':  'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        const data = sres?.data || {};
        console.log('[DHLGF] Booking Response:', JSON.stringify(data));

        /* ===========================
           MAP RESPONSE
        =========================== */
        FINALRESPONSE.STATUS         = 'Success';
        FINALRESPONSE.TRACKING_STATUS= data.status || 'BOOKED';
        FINALRESPONSE.SERVICE_NAME   = CARRIER_DETAILS?.SERVICE_NAME || bookReq.productCode;
        FINALRESPONSE.SERVICE_CODE   = CARRIER_DETAILS?.SERVICE_CODE || bookReq.serviceCode;
        FINALRESPONSE.CURRENCY       = data.currency || bookReq.valueOfGoodsCurrencyCode || 'USD';
        FINALRESPONSE.EXPECTED_DELIVERY_DATE =
            data.estimatedDeliveryDate || data.requestedDeliveryDate || bookReq.requestedDeliveryDate || '';

        const housebill = data.housebillNumber
                       || data.shipmentBookingNumber
                       || data.bookingNumber
                       || bookReq.housebillNumber;
        if (housebill) FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = housebill;

        // Per-package tracking (DHL GF returns one housebill; replicate to each PACKAGE slot)
        FINALRESPONSE.PACKAGES = PACKAGES.length
            ? PACKAGES.map(() => ({ TRACKING_NUMBER: housebill || '' }))
            : (housebill ? [{ TRACKING_NUMBER: housebill }] : []);

        // Charges if returned
        if (Array.isArray(data.charges)) {
            FINALRESPONSE.CHARGE_DETAILS = data.charges.map(c => ({
                CHARGE_CODE: c.code || c.chargeCode || '',
                SAP_CHARGE_CODE: null,
                DESCRIPTION: c.description || c.name || '',
                AMOUNT: Number(c.amount ?? c.value ?? 0),
                CURRENCY: c.currency || c.currencyCode || FINALRESPONSE.CURRENCY
            }));
        }

        // Documents (DHL GF may return labels / booking confirmation)
        const docs = data.documents || data.shipmentDocuments || [];
        if (Array.isArray(docs)) {
            docs.forEach(d => {
                FINALRESPONSE.SHIPPING_DOCUMENTS.push({
                    DOC_PROVIDER: 'DHLGF',
                    CONTENT_TYPE: d.contentType || d.imageFormat || 'PDF',
                    COPIES_TO_PRINT: 1,
                    DOC_NAME: d.name || d.documentName || `${d.typeCode || 'BOOKING'}.pdf`,
                    ENCODED_LABEL: d.content || d.encodedDocument || '',
                    DOC_TYPE: d.typeCode || d.documentType || 'BOOKING_CONFIRMATION'
                });
            });
        }

        return FINALRESPONSE;

    } catch (ex) {
        const apiErr = ex?.response?.data;
        console.error('[DHLGF] ship error:', apiErr || ex.message);
        FINALRESPONSE.STATUS = 'Error';

        if (apiErr) {
            // DHL Group APIs return RFC-7807 problem+json
            if (Array.isArray(apiErr.errors)) {
                apiErr.errors.forEach(e =>
                    FINALRESPONSE.ERRORS.push(`${e.code || ''} ${e.message || e.detail || ''}`.trim())
                );
            } else if (apiErr.detail || apiErr.title || apiErr.message) {
                FINALRESPONSE.ERRORS.push(
                    [apiErr.title, apiErr.detail || apiErr.message].filter(Boolean).join(' - ')
                );
            } else {
                FINALRESPONSE.ERRORS.push(JSON.stringify(apiErr));
            }
        } else {
            FINALRESPONSE.ERRORS.push(ex.message || 'Unknown DHLGF API ship error');
        }
        return FINALRESPONSE;
    }
};

/* =====================================================
   REQUEST BUILDER
===================================================== */

function buildBookingRequest(ctx) {
    const {
        CARRIER_DETAILS, HEADER_INFO, INTL, SLSS,
        SHIPPER, SHIPTO, BILLTO, NOTIFY, PACKAGES
    } = ctx;

    const insure = SLSS?.INSURANCE_AMOUNT ? Number(SLSS.INSURANCE_AMOUNT) : 0;

    const req = {
        housebillNumber:      CARRIER_DETAILS.HOUSE_BILL_NUMBER
                            || HEADER_INFO.MASTER_TRACKING_NUMBER
                            || HEADER_INFO.HOUSE_BILL_NUMBER
                            || '',
        externalBookingID:    HEADER_INFO.DOCUMENT_NUMBER
                            || CARRIER_DETAILS.REFERENCE1
                            || '',
        modeOfTransport:      (CARRIER_DETAILS.MODE_OF_TRANSPORT || 'AIR').toUpperCase(),
        shipmentBranchCode:   CARRIER_DETAILS.BRANCH_CODE || '',

        // Origin / Destination
        originLocationCode:        CARRIER_DETAILS.ORIGIN_LOCATION_CODE
                                || locCode(SHIPPER),
        originLocationName:        SHIPPER.CITY || '',
        originCountryCode:         SHIPPER.COUNTRY || '',
        destinationLocationCode:   CARRIER_DETAILS.DESTINATION_LOCATION_CODE
                                || locCode(SHIPTO),
        destinationLocationName:   SHIPTO.CITY || '',
        destinationCountryCode:    SHIPTO.COUNTRY || '',

        // Dates
        requestedPickupDate:   toISODate(HEADER_INFO.PICKUP_DATE   || HEADER_INFO.SHIP_DATE),
        requestedShippingDate: toISODate(HEADER_INFO.SHIP_DATE),
        requestedDeliveryDate: toISODate(HEADER_INFO.DELIVERY_DATE || HEADER_INFO.SHIP_DATE),

        // Shipment classification
        shipmentType:    CARRIER_DETAILS.SHIPMENT_TYPE   || HEADER_INFO.SHIPMENT_TYPE  || 'LSE',
        shipmentSubType: CARRIER_DETAILS.SHIPMENT_SUBTYPE|| 'STD',
        assembly:        isTrue(CARRIER_DETAILS.ASSEMBLY),
        deliveryMode:    CARRIER_DETAILS.DELIVERY_MODE   || 'DOOR/DOOR',
        serviceLevel:    CARRIER_DETAILS.SERVICE_LEVEL   || 'STD',
        serviceCode:     CARRIER_DETAILS.SERVICE_CODE    || 'AA1',
        productCode:     CARRIER_DETAILS.PRODUCT_CODE    || 'ALC',

        _DGFInsure:                isTrue(SLSS?.INSURANCE) || insure > 0,
        incoterms:                 INTL.INCOTERMS         || CARRIER_DETAILS.INCOTERMS || 'FCA',
        incotermsLocation:         INTL.INCOTERMS_LOCATION|| SHIPTO.CITY || '',
        releaseType:               CARRIER_DETAILS.RELEASE_TYPE || '',

        valueOfGoods:              Number(INTL.CUSTOMS_VALUE || INTL.VALUE_OF_GOODS || 0),
        valueOfGoodsCurrencyCode:  INTL.CUSTOMS_VALUE_CURRENCY || INTL.CURRENCY || HEADER_INFO.CURRENCY || 'USD',
        insuranceValue:            insure,
        insuranceValueCurrencyCode:SLSS?.INSURANCE_CURRENCY || INTL.CURRENCY || HEADER_INFO.CURRENCY || 'USD',

        customer:  mapParty(BILLTO),
        shipper:   mapParty(SHIPPER),
        consignee: mapParty(SHIPTO),
        notify:    NOTIFY ? mapParty(NOTIFY) : emptyParty(),

        goodsLines: PACKAGES.map(mapGoodsLine),

        references: buildReferences(HEADER_INFO, CARRIER_DETAILS),
        notes:      buildNotes(HEADER_INFO, SLSS),
        service:    buildServiceDates(HEADER_INFO, CARRIER_DETAILS),

        pickup:   buildPickup(CARRIER_DETAILS, SHIPPER),
        delivery: buildDelivery(CARRIER_DETAILS, SHIPTO),

        parties: buildParties(CARRIER_DETAILS)
    };

    return req;
}

/* =====================================================
   PARTY / ADDRESS MAPPERS
===================================================== */

function mapParty(p) {
    if (!p) return emptyParty();
    return {
        accountNumber: p.ACCOUNT_NO || p.ACCOUNT_NUMBER || p.AccountNo || '',
        name:          p.COMPANY    || p.NAME           || '',
        address: {
            addressLine1: p.ADDRESS_LINE1 || '',
            addressLine2: p.ADDRESS_LINE2 || '',
            postalCode:   p.ZIPCODE || p.POSTAL_CODE || p.ZipCode || '',
            city:         p.CITY    || '',
            stateProvince:p.STATE   || '',
            countryCode:  p.COUNTRY || ''
        },
        contact: {
            name:  p.CONTACT || '',
            phone: p.PHONE   || '',
            email: p.EMAIL   || ''
        }
    };
}

function emptyParty() {
    return {
        accountNumber: '',
        name: '',
        address: {
            addressLine1: '', addressLine2: '', postalCode: '',
            city: '', stateProvince: '', countryCode: ''
        },
        contact: { name: '', phone: '', email: '' }
    };
}

/* =====================================================
   GOODS LINE MAPPER  (PACKAGE → DHL GF goodsLine)
===================================================== */

function mapGoodsLine(pkg = {}) {
    const wIn = (pkg.WEIGHT_UNITS  || 'KG').toUpperCase();
    const dIn = (pkg.DIMENSION_UNITS || 'CM').toUpperCase();
    const weightUom = ({ LB: 'LBR', LBS: 'LBR', KG: 'KGM', KGS: 'KGM' })[wIn] || 'KGM';
    const dimUom    = ({ IN: 'INH', INCH: 'INH', CM: 'CMT', M: 'MTR', MTR: 'MTR' })[dIn] || 'CMT';
    const dims = parseDims(pkg.DIMENSION, dimUom);

    const line = {
        packageCount:       Number(pkg.QUANTITY || 1),
        packageType:        pkg.ITEM_PACKING_TYPE || pkg.HANDLING_UNIT_TYPE || 'PLT',
        packageID:          pkg.HU_NO || pkg.SNO || '',
        grossWeight:        Number(pkg.WEIGHT || 0),
        grossWeightUom:     weightUom,
        volume:             dims.volumeM3 || 0,
        volumeUom:          'MTQ',
        innerPackageCount:  Number(pkg.INNER_QUANTITY || pkg.QUANTITY || 1),
        loadingMeters:      Number(pkg.LOADING_METERS || 0),
        marksAndNumbers:    pkg.MARKS_NUMBERS || '',
        goodsDescription:   pkg.DESCRIPTION || 'General Cargo',
        commodityCode:      pkg.COMMODITY_CODE || 'GEN',
        originCountryCode:  pkg.COUNTRY_OF_MFR || pkg.ORIGIN_COUNTRY || '',
        customsClassification: Array.isArray(pkg.CUSTOMS_CLASSIFICATION) ? pkg.CUSTOMS_CLASSIFICATION : [],
        dimensions: {
            dimensionsUom: dimUom,
            length: dims.length,
            width:  dims.width,
            height: dims.height
        },
        temperatures: pkg.TEMPERATURE ? {
            requiresTemperatureControl: true,
            requiredMinimum: Number(pkg.TEMPERATURE.MIN || 0),
            requiredMaximum: Number(pkg.TEMPERATURE.MAX || 0),
            uom:            (pkg.TEMPERATURE.UOM || 'CEL').toUpperCase()
        } : {
            requiresTemperatureControl: false
        },
        hazardousMaterial: Array.isArray(pkg.HAZMAT) ? pkg.HAZMAT.map(mapHazmat) : []
    };

    return line;
}

function mapHazmat(h = {}) {
    return {
        _UNDGNumber:           h.UNID_NUMBER || h.UN_NUMBER || '',
        _IMOClassCode:         h.IMO_CLASS || h.HAZ_CLASS || '',
        flashpointTemperature: {
            uom:  (h.FLASHPOINT_UOM || 'CEL').toUpperCase(),
            text: h.FLASHPOINT || ''
        },
        properShippingname: h.PROPER_SHIPPING_NAME || h.DESCRIPTION || '',
        technicalName:      h.TECHNICAL_NAME      || '',
        marinePollutant:    isTrue(h.MARINE_POLLUTANT) ? 'Y' : 'N',
        packageCount:       Number(h.PACKAGE_COUNT || 0),
        packageType:        h.PACKAGE_TYPE || '',
        grossWeight:        Number(h.WEIGHT || 0),
        grossWeightUom:     (h.WEIGHT_UOM || 'KGM').toUpperCase(),
        volume:             Number(h.VOLUME || 0),
        volumeUom:          (h.VOLUME_UOM || 'MTQ').toUpperCase(),
        contact: {
            name:  h.CONTACT_NAME  || '',
            phone: h.CONTACT_PHONE || '',
            email: h.CONTACT_EMAIL || ''
        }
    };
}

/* =====================================================
   REFERENCES / NOTES / SERVICE / PICKUP / DELIVERY
===================================================== */

function buildReferences(HEADER_INFO, CD) {
    const refs = [];
    if (HEADER_INFO.CUSTOMER_REFERENCE) refs.push({ type: 'CRN', number: HEADER_INFO.CUSTOMER_REFERENCE });
    if (HEADER_INFO.PO_NUMBER)          refs.push({ type: 'POR', number: HEADER_INFO.PO_NUMBER });
    if (HEADER_INFO.INVOICE_NUMBER)     refs.push({ type: 'INR', number: HEADER_INFO.INVOICE_NUMBER });
    if (CD.REFERENCE1)                  refs.push({ type: 'CRN', number: CD.REFERENCE1 });
    if (CD.REFERENCE2)                  refs.push({ type: 'ZZ',  number: CD.REFERENCE2 });
    return refs;
}

function buildNotes(HEADER_INFO, SLSS) {
    const notes = [];
    if (HEADER_INFO.NOTES) notes.push({ type: 'CIN', text: HEADER_INFO.NOTES });
    if (SLSS?.SPECIAL_INSTRUCTIONS) notes.push({ type: 'SIN', text: SLSS.SPECIAL_INSTRUCTIONS });
    return notes;
}

function buildServiceDates(HEADER_INFO, CD) {
    const list = [];
    if (HEADER_INFO.CARGO_READY_DATE) list.push({ type: 'DKI', requestedDate: toISODate(HEADER_INFO.CARGO_READY_DATE) });
    if (CD.DELIVERY_REQUEST_DATE)     list.push({ type: 'DLV', requestedDate: toISODate(CD.DELIVERY_REQUEST_DATE) });
    return list;
}

function buildPickup(CD, SHIPPER) {
    const enabled = isTrue(CD.PICKUP_REQUESTED) || CD.PICKUP_TYPE === 'REQUEST_COURIER';
    const party = mapParty(SHIPPER);
    return { _DGFPickup: enabled, ...party };
}

function buildDelivery(CD, SHIPTO) {
    const enabled = isTrue(CD.DELIVERY_REQUESTED);
    const party = enabled ? mapParty(SHIPTO) : emptyParty();
    return { _DGFDeliver: enabled, ...party };
}

function buildParties(CD) {
    const parties = [];
    if (CD.DELIVERY_AGENT)   parties.push({ partyType: 'DeliveryAgent', accountNumber: CD.DELIVERY_AGENT });
    if (CD.PICKUP_AGENT)     parties.push({ partyType: 'PickupAgent',   accountNumber: CD.PICKUP_AGENT });
    if (CD.FORWARDING_AGENT) parties.push({ partyType: 'ForwardingAgent', accountNumber: CD.FORWARDING_AGENT });
    return parties;
}

/* =====================================================
   HELPERS
===================================================== */

function toISODate(s) {
    if (!s) return '';
    const d = (s instanceof Date) ? s : new Date(s);
    if (isNaN(d.getTime())) return String(s);
    // keep tz offset if present, else assume UTC
    return d.toISOString();
}

function parseDims(dimStr, dimUom = 'CMT') {
    if (!dimStr) return { length: 0, width: 0, height: 0, volumeM3: 0 };
    const parts = String(dimStr).toUpperCase().replace(/\s/g, '').split(/[X*]/).map(parseFloat);
    if (parts.length !== 3 || parts.some(isNaN)) return { length: 0, width: 0, height: 0, volumeM3: 0 };
    const [l, w, h] = parts;
    // DHL GF wants volume in m3 (MTQ). Convert based on dim UOM.
    const cubic = l * w * h;
    let volumeM3;
    switch (dimUom) {
        case 'MTR': volumeM3 = cubic;                break;   // m   → m^3
        case 'INH': volumeM3 = cubic * 0.0000163871; break;   // in  → m^3
        case 'CMT':
        default:    volumeM3 = cubic / 1_000_000;    break;   // cm  → m^3
    }
    return { length: l, width: w, height: h, volumeM3: Number(volumeM3.toFixed(4)) };
}

// 5-char DHL GF location code: try ZIP+country fallback, else countryCode+first3 of city
function locCode(addr) {
    const cc = (addr.COUNTRY || '').toUpperCase().slice(0, 2);
    const city = (addr.CITY || '').replace(/[^A-Za-z]/g, '').toUpperCase().slice(0, 3);
    if (!cc || !city) return '';
    return cc + city;
}

/* expose helper for tests */
module.exports.buildBookingRequest = buildBookingRequest;
