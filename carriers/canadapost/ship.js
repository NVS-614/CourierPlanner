// carriers/CP/ship.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildFinalResponse } = require('../../Reuse/responseBuilder');
const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

module.exports = async (request) => {

    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER, INTERNATIONAL_DETAILS } = request;

    const shipurl = CARRIER_DETAILS.SHIPURL || process.env.CANADAPOST_SHIP;
    const rateurl = CARRIER_DETAILS.RATEURL || process.env.CANADAPOST_SHIP;

    const user = CARRIER_DETAILS.USERID;
    const password = CARRIER_DETAILS.PASSWORD;
    const account = CARRIER_DETAILS.SHIPPING_ACCOUNT;
    let currency = INTERNATIONAL_DETAILS?.CURRENCY || request.CARRIER_DETAILS?.CURRENCY || 'CAD';
    const basicAuth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
    let FINALRESPONSE = buildFinalResponse(request);

    let totalFreight = 0;

    try {

        /* ---------------- PARALLEL SHIPMENT ---------------- */

        const results = await Promise.all(
            PACKAGES.map((pkg, index) =>
                shipSinglePackage(
                    request,
                    pkg,
                    index,
                    shipurl,
                    rateurl,
                    user,
                    password,
                    account,
                    basicAuth, FINALRESPONSE, currency
                )
            )
        );

        /* ---------------- CONSOLIDATE RESULTS ---------------- */

        results.forEach(res => {
            // 👉 If errors exist, handle them and skip this record
            if (Array.isArray(res.ERRORS) && res.ERRORS.length > 0) {

                res.ERRORS.forEach(err => {
                    FINALRESPONSE.ERRORS = FINALRESPONSE.ERRORS || [];
                    FINALRESPONSE.ERRORS.push(err);
                });

                return; // ⛔ skip rest of this iteration
            }
            FINALRESPONSE.PACKAGES.push({
                TRACKING_NUMBER: res.tracking
            });

            totalFreight += res.freight;

            FINALRESPONSE.SHIPPING_DOCUMENTS.push(...res.docs);

        });
        if (FINALRESPONSE.PACKAGES[0]?.TRACKING_NUMBER) {
            FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = FINALRESPONSE.PACKAGES[0]?.TRACKING_NUMBER;
            FINALRESPONSE.STATUS = "Success";
            FINALRESPONSE.TRACKING_STATUS = "Shipped";
        } else {
            FINALRESPONSE.STATUS = "Error";
            FINALRESPONSE.TRACKING_STATUS = "Error";
        }


        FINALRESPONSE.DISCOUNTED_FREIGHT = totalFreight.toFixed(2);
        FINALRESPONSE.PUBLISHED_FREIGHT = totalFreight.toFixed(2);
        FINALRESPONSE.CURRENCY = currency;

        return FINALRESPONSE;

    }
    catch (error) {
        console.error('Error fetching purolator rates:', error.response?.data || error.message);
        FINALRESPONSE.STATUS = 'Error';
        if (error.response?.data) {
            error = reuse.parseAndCleanXML(error.response?.data || error.message);
            if (error.Envelope.Body["create-shipment-response"]?.messages) {
                FINALRESPONSE.ERRORS = [error.Envelope.Body["create-shipment-response"]?.messages.message.description];
            } else if (error.Envelope.Body.Fault.faultstring) {
                FINALRESPONSE.ERRORS = [error.Envelope.Body.Fault.faultstring];
            }
        } else {

            FINALRESPONSE.ERRORS = [error?.message || error];
        }
        return FINALRESPONSE;
    }

};

const handleErrorResponse = (parsedError) => {
    const fault = parsedError?.Envelope?.Body?.Fault;
    if (fault?.faultstring) {
        return fault.faultstring;
    }
    else {
        const errors = Array.isArray(parsedError)
            ? parsedError.map(err => err.Description || err.Code || 'Unknown error')
            : [parsedError.Description || parsedError.Code || 'Unknown error'];
        return errors;
    }
};
/* ---------------------------------------------------------- */
/*                 SHIP SINGLE PACKAGE FUNCTION                */
/* ---------------------------------------------------------- */

async function shipSinglePackage(request, pkg, index, shipurl, rateurl, user, password, account, basicAuth, FINALRESPONSE, currency) {
    const { SHIPPER, SHIPTO, INTERNATIONAL_DETAILS } = request;
    const intitemInfo = INTERNATIONAL_DETAILS?.ITEM_INFO || [];
    let shiprequest = '';

    shiprequest += '<?xml version="1.0" encoding="UTF-8"?>';
    shiprequest += '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v8="http://www.canadapost.ca/ws/soap/shipment/v8">';
    shiprequest += '<soapenv:Header>';
    shiprequest += '<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">';
    shiprequest += '<wsse:UsernameToken>';
    shiprequest += `<wsse:Username>${user}</wsse:Username>`;
    shiprequest += `<wsse:Password>${password}</wsse:Password>`;
    shiprequest += '</wsse:UsernameToken>';
    shiprequest += '</wsse:Security>';
    shiprequest += '</soapenv:Header>';

    shiprequest += '<soapenv:Body>';
    shiprequest += '<v8:create-shipment-request>';
    shiprequest += `<mailed-by>${account}</mailed-by>`;
    shiprequest += '<locale>EN</locale>';

    shiprequest += '<shipment>';
    shiprequest += '<v8:transmit-shipment>true</v8:transmit-shipment>';
    shiprequest += `<requested-shipping-point>${SHIPPER.ZIPCODE}</requested-shipping-point>`;

    shiprequest += '<delivery-spec>';
    shiprequest += `<service-code>${request.CARRIER_DETAILS.SERVICE_CODE}</service-code>`;

    /* ---------- SHIPPER ---------- */

    shiprequest += '<sender>';
    shiprequest += `<name>${reuse.escapeXml(SHIPPER.CONTACT)}</name>`;
    shiprequest += `<company>${reuse.escapeXml(SHIPPER.COMPANY)}</company>`;
    shiprequest += `<contact-phone>${SHIPPER.PHONE}</contact-phone>`;

    shiprequest += '<address-details>';
    shiprequest += `<address-line-1>${reuse.escapeXml(SHIPPER.ADDRESS_LINE1)}</address-line-1>`;
    shiprequest += `<city>${SHIPPER.CITY}</city>`;
    shiprequest += `<prov-state>${SHIPPER.STATE}</prov-state>`;
    shiprequest += `<country-code>${SHIPPER.COUNTRY}</country-code>`;
    shiprequest += `<postal-zip-code>${SHIPPER.ZIPCODE}</postal-zip-code>`;
    shiprequest += '</address-details>';

    shiprequest += '</sender>';

    /* ---------- DESTINATION ---------- */

    shiprequest += '<destination>';
    shiprequest += `<name>${reuse.escapeXml(SHIPTO.CONTACT)}</name>`;
    shiprequest += `<company>${reuse.escapeXml(SHIPTO.COMPANY)}</company>`;
    shiprequest += `<client-voice-number>${SHIPTO.PHONE}</client-voice-number>`;

    shiprequest += '<address-details>';
    shiprequest += `<address-line-1>${reuse.escapeXml(SHIPTO.ADDRESS_LINE1)}</address-line-1>`;
    shiprequest += `<city>${SHIPTO.CITY}</city>`;
    shiprequest += `<prov-state>${SHIPTO.STATE}</prov-state>`;
    shiprequest += `<country-code>${SHIPTO.COUNTRY}</country-code>`;
    shiprequest += `<postal-zip-code>${SHIPTO.ZIPCODE}</postal-zip-code>`;
    shiprequest += '</address-details>';

    shiprequest += '</destination>';

    /* ---------- PACKAGE ---------- */

    shiprequest += '<parcel-characteristics>';
    shiprequest += `<weight>${pkg.WEIGHT}</weight>`;

    if (pkg?.DIMENSION) {

        const dims = pkg.DIMENSION.toUpperCase().split('X');

        if (dims.length === 3) {

            shiprequest += '<dimensions>';
            shiprequest += `<length>${Number(dims[0])}</length>`;
            shiprequest += `<width>${Number(dims[1])}</width>`;
            shiprequest += `<height>${Number(dims[2])}</height>`;
            shiprequest += '</dimensions>';
        }
    }

    shiprequest += '</parcel-characteristics>';

    shiprequest += '<print-preferences>';
    shiprequest += '<output-format>4x6</output-format>';
    shiprequest += '</print-preferences>';

    shiprequest += '<preferences>';
    shiprequest += '<show-packing-instructions>true</show-packing-instructions>';
    shiprequest += '<show-postage-rate>true</show-postage-rate>';
    shiprequest += '<show-insured-value>true</show-insured-value>';
    shiprequest += '</preferences>';

    shiprequest += '<settlement-info>';
    if (request.CARRIER_DETAILS?.ACCESS_KEY) {
        shiprequest += '<contract-id>' + request.CARRIER_DETAILS?.ACCESS_KEY + '</contract-id>';
    }
    // 
    shiprequest += '<intended-method-of-payment>CreditCard</intended-method-of-payment>';
    shiprequest += '</settlement-info>';

    if (SHIPPER.COUNTRY !== SHIPTO.COUNTRY && intitemInfo.length > 0) {
        shiprequest += `
                <customs>
                    <currency>${currency}</currency>
                    <reason-for-export>${RFE(INTERNATIONAL_DETAILS?.REASON_FOR_EXPORT, 'SOG')}</reason-for-export>
                    <sku-list>`;

        intitemInfo.forEach(item => {
            shiprequest += `
                        <item>
                         <customs-number-of-units>${safeValue(item.QUANTITY, '1')}</customs-number-of-units>
                         <customs-description>${safeValue(item.DESCRIPTION)}</customs-description>
                         <country-of-origin>${safeValue(SHIPPER.COUNTRY)}</country-of-origin>
                         <customs-value-per-unit>${parseFloat(safeValue(item.UNIT_COST, '0'))}</customs-value-per-unit>
                         <unit-weight>${(safeValue(item.ITEM_WEIGHT, '1'))}</unit-weight>
                        </item>`;
        });

        shiprequest += `
                    </sku-list>
                 
                        <us-declaration-id>12345</us-declaration-id>
                     
                </customs>`;
    }
    shiprequest += '</delivery-spec>';
    shiprequest += '</shipment>';
    shiprequest += '</v8:create-shipment-request>';
    shiprequest += '</soapenv:Body>';
    shiprequest += '</soapenv:Envelope>';

    console.log('shiprequest', shiprequest)

    /* ---------- CALL SHIP API ---------- */

    const shipres = await axiosInstance.post(
        shipurl,
        shiprequest,
        {
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'SOAPAction': CARRIER_DETAILS.SHIP_ACTION || process.env.CANADAPOST_SHIP_ACTION,
                //'Authorization': basicAuth
            }
        }
    );

    const sres = reuse.parseAndCleanXML(shipres.data);
    if (sres?.Envelope?.Body?.["create-shipment-response"]?.messages) {
        FINALRESPONSE.ERRORS = [sres.Envelope.Body["create-shipment-response"].messages.message.description];
        return FINALRESPONSE;
    } else if (sres?.Envelope?.Body?.Fault?.faultstring) {
        FINALRESPONSE.ERRORS = [sres.Envelope.Body.Fault.faultstring];
        return FINALRESPONSE;
    }

    const tracking = sres.Envelope.Body["create-shipment-response"]["shipment-info"]["tracking-pin"];
    const shipid = sres.Envelope.Body["create-shipment-response"]["shipment-info"]["shipment-id"];
    /* ---------- DOWNLOAD LABEL ---------- */
    const artifacts = sres.Envelope.Body["create-shipment-response"]["shipment-info"].artifacts.artifact;
    const artifactList = Array.isArray(artifacts) ? artifacts : [artifacts];
    let docs = [];
    for (const item of artifactList) {
        const artifactId = item["artifact-id"];
        const url = `https://ct.soa-gw.canadapost.ca/ers/artifact/${user}/${artifactId}/0`;
        const { base64 } = await downloadLabel(url, basicAuth);
        let contentType = 'LABEL';
        if (item.$.type.toLowerCase().includes('commercial')) {
            contentType = 'INVOICE'

        }
        docs.push(reuse.formatShipDoc('CanadaPost', contentType, 1, `${tracking}.PDF`, base64, 'PDF')
        );
    }

    /* ---------- GET RATE ---------- */

    const freight = await getShipmentPrice(shipid, rateurl, user, password, account);
    return {
        tracking,
        docs,
        freight
    };
}


/* ---------------------------------------------------------- */
/*                 GET SHIPMENT PRICE                         */
/* ---------------------------------------------------------- */

async function getShipmentPrice(shipmentid, rateurl, user, password, account) {

    let raterequest = '';

    raterequest += '<?xml version="1.0" encoding="UTF-8"?>';
    raterequest += '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v8="http://www.canadapost.ca/ws/soap/shipment/v8">';
    raterequest += '<soapenv:Header>';
    raterequest += '<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">';
    raterequest += '<wsse:UsernameToken>';
    raterequest += '<wsse:Username>' + user + '</wsse:Username>';
    raterequest += '<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">' + password + '</wsse:Password>';
    raterequest += '</wsse:UsernameToken>';
    raterequest += '</wsse:Security>';
    raterequest += '</soapenv:Header>';
    raterequest += '<soapenv:Body>';
    raterequest += '<v8:get-shipment-price-request>';
    raterequest += '<locale>EN</locale>';
    raterequest += `<mailed-by>${account}</mailed-by>`;
    raterequest += `<shipment-id>${shipmentid}</shipment-id>`;
    raterequest += '</v8:get-shipment-price-request>';
    raterequest += '</soapenv:Body>';
    raterequest += '</soapenv:Envelope>';

    console.log(raterequest);

    const res = await axiosInstance.post(
        rateurl,
        raterequest,
        {
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'SOAPAction': CARRIER_DETAILS.PRICE_ACTION || process.env.CANADAPOST_PRICE_ACTION
            }
        }
    );

    const parsed = reuse.parseAndCleanXML(res.data);

    return parseFloat(
        parsed.Envelope.Body["get-shipment-price-response"]["shipment-price"]["due-amount"]
    );
}

const safeValue = (value, defaultValue = '') => {
    if (value === null || value === undefined || value === '') {
        return defaultValue;
    }
    return String(value);
};
const RFE = (value, defaultValue = '') => {
    if (value === null || value === undefined || value === '') {
        return defaultValue;
    } else if (value.toUpperCase().includes('SOLD') || value.toUpperCase().includes('SALE')) {
        return 'SOG';
    } else if (value.toLowerCase().includes('repair') || value.toLowerCase().includes('warranty')) {
        return 'REP';
    } else if (value.toLowerCase().includes('document') || value.toLowerCase().includes('doc')) {
        return 'SAM';
    } else if (value.toLowerCase().includes('commercial') || value.toLowerCase().includes('sample')) {
        return 'DOC';
    }
    return String(value);
};
/* ---------------------------------------------------------- */
/*                 DOWNLOAD LABEL                             */
/* ---------------------------------------------------------- */

async function downloadLabel(url, basicAuth) {

    const res = await axiosInstance.get(url, {
        responseType: "arraybuffer",
        headers: { Authorization: basicAuth }
    });

    const base64 = Buffer.from(res.data).toString("base64");

    return { base64 };
}