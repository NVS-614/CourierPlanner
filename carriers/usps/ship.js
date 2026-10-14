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
    let FINALRESPONSE = buildFinalResponse(request);

    try {
        const account = safeValue(CARRIER_DETAILS.SHIPPING_ACCOUNT);
        const password = safeValue(CARRIER_DETAILS.PASSWORD);
        const requesterID = safeValue(CARRIER_DETAILS.REQUESTER_ID, process.env.USPS_REQUESTER_ID);
        const url = safeValue(CARRIER_DETAILS.SHIPURL, process.env.USPS_SHIP);
        const shipAction = safeValue(CARRIER_DETAILS.SHIP_KEY, process.env.USPS_SHIP_ACTION);
        const labelType = safeValue(CARRIER_DETAILS.LABELTYPE, 'PNG');
        const service = CARRIER_DETAILS?.SERVICE_CODE || CARRIER_DETAILS?.SERVICE_NAME;
        const currency = INTERNATIONAL_DETAILS?.CURRENCY || CARRIER_DETAILS?.CURRENCY || 'USD';
        // Test mode flag — Endicia's <LabelRequest Test="YES|NO"> attribute.
        // Driven by env (CARRIER_TEST_MODE) but overridable via CARRIER_DETAILS.IS_TEST.
        const testMode = (() => {
            const explicit = CARRIER_DETAILS?.IS_TEST;
            if (explicit === true || explicit === 'YES' || explicit === 'true') return 'YES';
            if (explicit === false || explicit === 'NO' || explicit === 'false') return 'NO';
            return (process.env.CARRIER_TEST_MODE || 'YES').toUpperCase() === 'NO' ? 'NO' : 'YES';
        })();

        // Constants for USPS
        const IntegratedFormType = 'Form2976A';
        const ToDeliveryPoint = '00';
        const EntryFacility = 'Other';

        let totalPublishedFreight = 0.0;

        // Build a ship promise for each package (USPS requires one API call per package)
        const shipPromises = PACKAGES.map((pkg, index) => {
            return processSinglePackage({
                pkg,
                index,
                request,
                url,
                shipAction,
                account,
                password,
                requesterID,
                labelType,
                service,
                testMode,
                IntegratedFormType,
                ToDeliveryPoint,
                EntryFacility,
                FINALRESPONSE
            });
        });

        const results = await Promise.all(shipPromises);

        // Check if any package failed
        const failed = results.find(r => r && r.status === 'Error');
        if (failed) {
            FINALRESPONSE.STATUS = 'Error';
            FINALRESPONSE.ERRORS = handleErrorResponse(failed.error);
            return FINALRESPONSE;
        }

        // Consolidate package results
        results.forEach((r) => {
            if (r && r.status === 'Success') {
                FINALRESPONSE.PACKAGES.push({ TRACKING_NUMBER: r.trackingNumber || '' });
                if (r.shippingDoc) {
                    FINALRESPONSE.SHIPPING_DOCUMENTS.push(r.shippingDoc);
                }
                totalPublishedFreight += Number(r.finalPostage || 0);
            }
        });

        if (FINALRESPONSE.PACKAGES.length > 0) {
            FINALRESPONSE.STATUS = 'Success';
            FINALRESPONSE.TRACKING_STATUS = 'Shipped';
            FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = FINALRESPONSE.PACKAGES[0]?.TRACKING_NUMBER;

            // Consolidate rates
            try {
                FINALRESPONSE.DISCOUNTED_FREIGHT = totalPublishedFreight.toString();
                FINALRESPONSE.PUBLISHED_FREIGHT = totalPublishedFreight.toString();
                FINALRESPONSE.CURRENCY = currency;
                FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipRateRes('Base Charge', totalPublishedFreight, currency, 'Base'));
            } catch (rateErr) {
                console.error('Error consolidating USPS rates:', rateErr.message);
            }

            return FINALRESPONSE;
        } else {
            FINALRESPONSE.STATUS = 'Error';
            FINALRESPONSE.ERRORS = ['No tracking numbers received from USPS shipping service'];
            return FINALRESPONSE;
        }
    } catch (error) {
        console.error('Error fetching USPS rates:', error.response?.data || error.message);
        FINALRESPONSE.STATUS = 'Error';
        if (error.response?.data) {
            try {
                const parsedError = reuse.parseAndCleanXML(error.response.data);
                FINALRESPONSE.ERRORS = handleErrorResponse(parsedError);
            } catch (parseError) {
                FINALRESPONSE.ERRORS = handleErrorResponse(error.message);
            }
        } else {
            FINALRESPONSE.ERRORS = handleErrorResponse(error?.message);
        }
        return FINALRESPONSE;
    }
};

// Process a single package against the USPS Endicia label API
async function processSinglePackage(opts) {
    const {
        pkg,
        index,
        request,
        url,
        shipAction,
        account,
        password,
        requesterID,
        labelType,
        service,
        testMode,
        IntegratedFormType,
        ToDeliveryPoint,
        EntryFacility,
        FINALRESPONSE
    } = opts;

    const { HEADER_INFO, SHIPTO, SHIPPER, CARRIER_DETAILS } = request;

    try {
        // Convert weight to ounces (USPS Endicia requires WeightOz)
        // Fall back to HEADER_INFO/PACKAGES[0] if per-package WEIGHT_UNITS is missing.
        const pkgUnits = pkg.WEIGHT_UNITS
            || request.PACKAGES?.[0]?.WEIGHT_UNITS
            || HEADER_INFO?.WEIGHT_UNITS
            || 'LB';
        const weightOz = convertWeightToOz(pkg.WEIGHT, pkgUnits);

        // Parse dimensions safely
        const dims = parseDimensions(pkg.DIMENSION);

        // Clean phone numbers
        const shipToPhone = cleanPhone(SHIPTO.PHONE);
        const shipperPhone = cleanPhone(SHIPPER.PHONE);

        // Build XML request
        let shiprequest = '';
        shiprequest += '<?xml version="1.0" encoding="UTF-8"?>';
        shiprequest += '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="www.envmgr.com/LabelService">';
        shiprequest += '<soapenv:Header/>';
        shiprequest += '<soapenv:Body>';
        shiprequest += '<GetPostageLabel>';
        shiprequest += `<LabelRequest Test="${testMode}" LabelType="Default" LabelSize="4X6" ImageFormat="${labelType}">`;
        shiprequest += `<RequesterID>${requesterID}</RequesterID>`;
        shiprequest += `<AccountID>${account}</AccountID>`;
        shiprequest += `<PassPhrase>${password}</PassPhrase>`;
        shiprequest += `<MailClass>${safeValue(service)}</MailClass>`;
        shiprequest += '<DateAdvance>0</DateAdvance>';
        shiprequest += `<WeightOz>${weightOz}</WeightOz>`;

        if (dims) {
            shiprequest += '<MailpieceDimensions>';
            shiprequest += `<Length>${dims.length}</Length>`;
            shiprequest += `<Width>${dims.width}</Width>`;
            shiprequest += `<Height>${dims.height}</Height>`;
            shiprequest += '</MailpieceDimensions>';
        }

        shiprequest += '<Stealth>TRUE</Stealth>';
        shiprequest += '<ValidateAddress>FALSE</ValidateAddress>';
        shiprequest += '<Services InsuredMail="OFF" SignatureConfirmation="OFF"/>';
        // <Description> — use the package or header description (was previously read from
        // a non-existent HEADER_INFO.DocumentType field).
        const descText = safeValue(
            pkg.DESCRIPTION
            || HEADER_INFO?.DESCRIPTION
            || HEADER_INFO?.DOCUMENT_TYPE
        );
        shiprequest += `<Description>${reuse.escapeXml(descText)}</Description>`;
        shiprequest += `<PartnerCustomerID>${safeValue(HEADER_INFO.DOCUMENT_NUMBER)}</PartnerCustomerID>`;
        shiprequest += `<PartnerTransactionID>${safeValue(HEADER_INFO.DOCUMENT_NUMBER)}</PartnerTransactionID>`;
        shiprequest += `<ReferenceID>${reuse.escapeXml(safeValue(CARRIER_DETAILS.REFERENCE1))}</ReferenceID>`;
        shiprequest += `<ReferenceID2>${reuse.escapeXml(safeValue(CARRIER_DETAILS.REFERENCE2))}</ReferenceID2>`;

        // Ship-To
        shiprequest += `<ToName>${reuse.escapeXml(safeValue(SHIPTO.CONTACT))}</ToName>`;
        shiprequest += `<ToCompany>${reuse.escapeXml(safeValue(SHIPTO.COMPANY))}</ToCompany>`;
        shiprequest += `<ToAddress1>${reuse.escapeXml(safeValue(SHIPTO.ADDRESS_LINE1))}</ToAddress1>`;
        shiprequest += `<ToAddress2>${reuse.escapeXml(safeValue(SHIPTO.ADDRESS_LINE2))}</ToAddress2>`;
        shiprequest += `<ToCity>${reuse.escapeXml(safeValue(SHIPTO.CITY))}</ToCity>`;
        shiprequest += `<ToState>${safeValue(SHIPTO.STATE)}</ToState>`;
        shiprequest += `<ToPostalCode>${safeValue(SHIPTO.ZIPCODE).substring(0, 5)}</ToPostalCode>`;
        shiprequest += `<ToDeliveryPoint>${ToDeliveryPoint}</ToDeliveryPoint>`;
        shiprequest += `<ToPhone>${shipToPhone}</ToPhone>`;
        shiprequest += `<ToCountryCode>${safeValue(SHIPTO.COUNTRY)}</ToCountryCode>`;
        shiprequest += `<EntryFacility>${EntryFacility}</EntryFacility>`;
        shiprequest += `<IntegratedFormType>${IntegratedFormType}</IntegratedFormType>`;

        // Shipper (no second <Description> — Endicia rejects/overwrites duplicates)
        shiprequest += `<FromName>${reuse.escapeXml(safeValue(SHIPPER.COMPANY))}</FromName>`;
        shiprequest += `<ReturnAddress1>${reuse.escapeXml(safeValue(SHIPPER.ADDRESS_LINE1))}</ReturnAddress1>`;
        shiprequest += `<FromCity>${reuse.escapeXml(safeValue(SHIPPER.CITY))}</FromCity>`;
        shiprequest += `<FromState>${safeValue(SHIPPER.STATE)}</FromState>`;
        shiprequest += `<FromPostalCode>${safeValue(SHIPPER.ZIPCODE).substring(0, 5)}</FromPostalCode>`;
        shiprequest += `<FromPhone>${shipperPhone}</FromPhone>`;

        shiprequest += '</LabelRequest>';
        shiprequest += '</GetPostageLabel>';
        shiprequest += '</soapenv:Body>';
        shiprequest += '</soapenv:Envelope>';

        // console.log(`USPS Ship Request (pkg ${index + 1}):`, shiprequest);

        const shipRes = await axiosInstance.post(url, shiprequest, {
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'SOAPAction': shipAction
            }
        });

        // console.log(`USPS Ship Response (pkg ${index + 1}):`, shipRes.data);

        const parsedResponse = reuse.parseAndCleanXML(shipRes.data);
        const labelResponse = parsedResponse?.Envelope?.Body?.GetPostageLabelResponse?.LabelRequestResponse;

        if (!labelResponse || labelResponse.Status != '0') {
            return {
                status: 'Error',
                error: labelResponse?.ErrorMessage || 'Unknown USPS shipping error'
            };
        }

        const trackingNumber = labelResponse.TrackingNumber;
        const finalPostage = labelResponse.FinalPostage;
        const base64Label = labelResponse.Base64LabelImage;

        // Upload label
        let docName = trackingNumber + '.' + labelType;
        const formatDoc = reuse.formatShipDoc('USPS', 'Label', 1, docName, base64Label, labelType);
        return {
            status: 'Success',
            trackingNumber: trackingNumber,
            finalPostage: finalPostage,
            shippingDoc: formatDoc
        };
    } catch (error) {
        console.error(`Error processing USPS package ${index + 1}:`, error.response?.data || error.message);
        let errMsg = error?.message || 'Failed to process package';
        if (error.response?.data) {
            try {
                const parsedError = reuse.parseAndCleanXML(error.response.data);
                errMsg = parsedError?.Envelope?.Body?.Fault?.faultstring
                    || parsedError?.Envelope?.Body?.GetPostageLabelResponse?.LabelRequestResponse?.ErrorMessage
                    || errMsg;
            } catch (parseError) {
                // ignore parse error, use default message
            }
        }
        return {
            status: 'Error',
            error: errMsg
        };
    }
}

// Helper: handle error response
const handleErrorResponse = (parsedError) => {
    if (!parsedError) return ['Unknown error'];

    if (typeof parsedError === 'string') {
        return [parsedError];
    }

    const fault = parsedError?.Envelope?.Body?.Fault;
    if (fault?.faultstring) {
        return [fault.faultstring];
    }

    if (Array.isArray(parsedError)) {
        return parsedError.map(err => err.Description || err.Code || err.message || 'Unknown error');
    }

    return [parsedError.Description || parsedError.Code || parsedError.message || 'Unknown error'];
};

// Helper: get weight/dim units
const getUnits = (w) => ({
    weightUnit: w?.toUpperCase().startsWith('K') ? 'kg' : 'lb',
    dimUnit: w?.toUpperCase().startsWith('K') ? 'cm' : 'in'
});

// Helper: convert weight to ounces (USPS requires oz)
// 1 LB = 16 oz exactly; 1 KG ≈ 35.274 oz
const convertWeightToOz = (weight, unit) => {
    const w = Number(weight || 0);
    if (!unit) return w;
    const u = unit.toUpperCase();
    if (u === 'LBS' || u === 'LB') return Number((w * 16).toFixed(2));
    if (u === 'KGS' || u === 'KG') return Number((w * 35.274).toFixed(2));
    if (u === 'OZ' || u === 'OZS') return w;
    return w;
};

// Helper: safe value with default
const safeValue = (value, defaultValue = '') => {
    if (value === null || value === undefined || value === '') {
        return defaultValue;
    }
    return String(value);
};

// Helper: clean phone number (digits only)
const cleanPhone = (phone) => {
    if (!phone || typeof phone !== 'string') return '';
    return phone.replace(/[-() +]/g, '');
};

// Helper: parse phone number into structured object (kept for parity with Purolator)
const parsePhoneNumber = (phone) => {
    if (!phone || typeof phone !== 'string') {
        return {
            countryCode: '',
            areaCode: '',
            phoneNumber: '',
            extension: '0000'
        };
    }
    const cleanedPhone = phone.replace(/\D/g, '');
    return {
        countryCode: '001',
        areaCode: cleanedPhone.substring(0, 3),
        phoneNumber: cleanedPhone.substring(3).padEnd(7, '0'),
        extension: '0000'
    };
};

// Helper: parse dimensions safely
const parseDimensions = (dimension) => {
    if (!dimension || typeof dimension !== 'string' ||
        dimension.toLowerCase() === '0' ||
        dimension.toLowerCase().startsWith('0') ||
        dimension.trim() === '') {
        return null;
    }
    const dims = dimension.toUpperCase().split('X').map(d => {
        const num = Number(d.trim());
        return isNaN(num) ? 0 : num;
    });
    if (dims.length < 3) return null;
    return {
        length: dims[0],
        width: dims[1],
        height: dims[2]
    };
};

// Helper: build boolean option (kept for parity with Purolator)
const buildBooleanOption = (value, optionName) => {
    if (String(value).toUpperCase() === 'TRUE') {
        return {
            id: optionName,
            value: 'TRUE'
        };
    }
    return null;
};