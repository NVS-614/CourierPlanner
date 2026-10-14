// carriers/dhl/ship.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildFinalResponse } = require('../../Reuse/responseBuilder');

const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});
const isTrue = (val) =>
    val === true ||
    (typeof val === 'string' && ['true', 'x', 'yes', '1'].includes(val.toLowerCase().trim()));

module.exports = async (request) => {

    if (typeof request === 'string') {
        request = JSON.parse(request);
    }
    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER, INTERNATIONAL_DETAILS } = request;
    let IsDutiable = false;
    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES || {};
    if (request.HEADER_INFO?.IS_DUTIABLE != null && request.HEADER_INFO.IS_DUTIABLE !== "") {
        IsDutiable = request.HEADER_INFO.IS_DUTIABLE;
    } else {
        IsDutiable = request.SHIPPER.COUNTRY !== request.SHIPTO.COUNTRY;
    }
    let FINALRESPONSE = buildFinalResponse(request);
    const hasETD = isTrue(SLSS?.ELECTRONIC_TRADE_DOCUMENT);
    const hasBase64Docs = Array.isArray(SLSS?.ETD_DOCUMENTS)
        && SLSS.ETD_DOCUMENTS.length > 0
        && !!SLSS.ETD_DOCUMENTS[0]?.ENCODED_DOC;
    const shipDateStr = request.HEADER_INFO?.SHIP_DATE || new Date().toISOString();
    const [datePart1] = shipDateStr.split('T');
    let currency = request.HEADER_INFO?.CURRENCY || 'USD';
    const shipurl = CARRIER_DETAILS.SHIPURL || process.env.DHL_SHIP;
    try {
        /* ===========================
           BUILD REQUEST
        =========================== */

        const shipReq = buildDHLShipRequest(request);

        if (CARRIER_DETAILS.PAYMENT_TYPE.toUpperCase() !== 'SENDER') {
            shipReq.accounts.push({
                typeCode: "payer",
                number: CARRIER_DETAILS.BILLING_ACCOUNT
            });
        }
        // if (req.body.CarrierDetails?.DutiesAccount) {
        //     daccount = {}
        //     daccount['typeCode'] = 'duties-taxes'
        //     daccount['number'] = req.body.CarrierDetails.DutiesAccount;
        //     shipReq.accounts.push(daccount);
        // }
        if (IsDutiable === true) {
            shipReq.content.isCustomsDeclarable = true;
            shipReq.content.declaredValue = INTERNATIONAL_DETAILS?.CUSTOMS_VALUE;
            shipReq.content.declaredValueCurrency =
                INTERNATIONAL_DETAILS?.CUSTOMS_VALUE_CURRENCY || currency;

            shipReq.content.exportDeclaration = {};
            shipReq.content.exportDeclaration.lineItems = [];

            INTERNATIONAL_DETAILS?.ITEM_INFO?.forEach(item => {

                const commidity = {
                    number: Number(item.ITEM_NO),
                    description: item.DESCRIPTION,
                    price: Number(item.UNIT_COST),
                    quantity: {
                        unitOfMeasurement: item?.UOM,
                        value: Number(item.QUANTITY)
                    },
                    commodityCodes: [{
                        typeCode: 'outbound',
                        value: item?.HTS_CODE
                    }],
                    exportReasonType: INTERNATIONAL_DETAILS?.REASON_FOR_EXPORT,
                    manufacturerCountry: item?.COUNTRY_OF_MFR || request.SHIPPER.COUNTRY,
                    weight: {
                        netValue: Number(item.ITEM_WEIGHT || 1),
                        grossValue: Number(item.ITEM_WEIGHT || 1)
                    },
                    isTaxesPaid: item?.IS_TAX_PAID,
                    additionalInformation: [item?.DESCRIPTION]
                };

                shipReq.content.exportDeclaration.lineItems.push(commidity);
            });

            // Invoice
            shipReq.content.exportDeclaration.invoice = {
                number: INTERNATIONAL_DETAILS?.INVOICE_NUMBER,
                date: INTERNATIONAL_DETAILS?.INVOICE_DATE || datePart1,
                termsOfPayment: INTERNATIONAL_DETAILS?.PAYMENT_TERMS
            };

            // Remarks
            if (INTERNATIONAL_DETAILS?.EXPORT_STATEMENT) {
                shipReq.content.exportDeclaration.remarks = [{
                    value: INTERNATIONAL_DETAILS.EXPORT_STATEMENT
                }];
            }
            shipReq.content.exportDeclaration.placeOfIncoterm = INTERNATIONAL_DETAILS?.INCOTERMS_LOCATION;
            shipReq.content.exportDeclaration.exportReason = INTERNATIONAL_DETAILS?.REASON_FOR_EXPORT;
            shipReq.content.exportDeclaration.exportReasonType = INTERNATIONAL_DETAILS?.REASON_FOR_EXPORT;
            shipReq.content.incoterm = INTERNATIONAL_DETAILS.INCOTERMS;
            if (hasETD) {
                if (hasBase64Docs) {
                    shipReq.documentImages = [];
                    // 🔵 Encoded Multi Upload
                    shipReq.documentImages = SLSS.ETD_DOCUMENTS.map((doc, index) => ({
                        imageFormat: doc?.CONTENT_TYPE || 'PDF',
                        content: doc.ENCODED_DOC,
                        typeCode: 'INV'
                    }));
                }
            }
        } else {
            shipReq.content.isCustomsDeclarable = false;
        }
        shipReq.valueAddedServices = [];

        // helper function
        const addService = (code, extra = {}) => {
            shipReq.valueAddedServices.push({
                serviceCode: code,
                ...extra
            });
        };

        // simple boolean services
        if (isTrue(SLSS?.GO_GREEN_PLUS)) addService('FT');
        if (isTrue(SLSS?.NEUTRAL_DELIVERY)) addService('NN');
        if (isTrue(SLSS?.ELECTRONIC_TRADE_DOCUMENT)) addService('WY');

        // insurance
        if (SLSS?.INSURANCE_AMOUNT) {
            addService('II', {
                value: SLSS.INSURANCE_AMOUNT,
                currency: SLSS.INSURANCE_CURRENCY || currency
            });
        }

        // hazmat — read structured object: SLSS.HAZMAT.{UNID_NUMBER, DESCRIPTION}
        if (SLSS?.HAZMAT?.UNID_NUMBER) {
            addService('HE', {
                contentId: SLSS.HAZMAT.UNID_NUMBER,
                customDescription: SLSS.HAZMAT.DESCRIPTION || SLSS.HAZMAT.DESC
            });
        }


        // ---------- outputImageProperties ----------
        shipReq.outputImageProperties = {
            encodingFormat: 'pdf',
            imageOptions: [
                {
                    typeCode: 'label',
                    templateName: 'ECOM26_84_001'
                }
            ]
        };

        if (IsDutiable) {
            shipReq.outputImageProperties.imageOptions.push({
                typeCode: 'invoice',
                templateName: 'COMMERCIAL_INVOICE_P_10',
                isRequested: true
            });
        }


        // ---------- customerReferences ----------
        shipReq.customerReferences = [
            {
                typeCode: 'CU',
                value: request.HEADER_INFO?.CUSTOMER_REFERENCE || "test"
            },
        ];
        console.log('DHL Ship Request:', JSON.stringify(shipReq));

        /* ===========================
           API CALL
        =========================== */

        const sres = await axiosInstance.post(shipurl, shipReq, {
            headers: {
                'content-type': 'application/json',
                authorization:
                    'Basic ' +
                    Buffer.from(
                        `${CARRIER_DETAILS.USERID}:${CARRIER_DETAILS.PASSWORD}`
                    ).toString('base64')
            }
        });

        console.log('DHL Ship Response:', JSON.stringify(sres.data));

        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Shipped';
        FINALRESPONSE.SERVICE_NAME = CARRIER_DETAILS?.SERVICE_NAME;
        FINALRESPONSE.SERVICE_CODE = CARRIER_DETAILS?.SERVICE_CODE;
        if (sres?.data?.shipmentTrackingNumber) {
            FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = sres.data.shipmentTrackingNumber;
        }
        if (sres?.data?.estimatedDeliveryDate) {
            FINALRESPONSE.HEADER_INFO.EXPECTED_DELIVERY_DATE = sres?.data?.estimatedDeliveryDate.estimatedDeliveryDate;
        }

        /* ===========================
      SHIPPING CHARGES
   =========================== */

        try {
            // Find the charge entry with currencyType = "BASEC"
            const charges = sres?.data?.shipmentCharges ?? [];
            const charge = charges.find((c) => c.currencyType === 'BILLC') ?? charges[0];
            if (charge) {
                FINALRESPONSE.DISCOUNTED_FREIGHT = charge.price;
                FINALRESPONSE.PUBLISHED_FREIGHT = charge.price;
                FINALRESPONSE.CURRENCY = charge.priceCurrency;

                charge?.serviceBreakdown?.forEach((sur) => {
                    FINALRESPONSE.CHARGE_DETAILS.push(
                        reuse.ShipRateRes(
                            sur.name,
                            sur.price,
                            charge.priceCurrency
                        )
                    );
                });
            }
        } catch (err) {
            console.error('Charge parsing error:', err.message);
        }

        /* ===========================
           TRACKING NUMBERS
        =========================== */

        try {
            sres?.data?.packages?.forEach((pkg) => {
                FINALRESPONSE.PACKAGES.push({ TRACKING_NUMBER: pkg.trackingNumber });
            });

        } catch (err) {
            console.error('Tracking parse error:', err.message);
        }

        /* ===========================
           DOCUMENTS
        =========================== */

        try {
            for (const doc of sres?.data?.documents || []) {
                let contentType = '';
                let docName = '';

                if (doc.typeCode === 'label') {
                    contentType = 'LABEL';
                    docName = `${FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER}.pdf`;
                }

                if (doc.typeCode === 'invoice') {
                    contentType = 'INVOICE';
                    docName = `${FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER}_CI.pdf`;
                }

                if (!doc.content) continue;
                const formattedDoc = reuse.formatShipDoc('DHL', contentType, 1, docName, doc.content, 'PDF');
                FINALRESPONSE.SHIPPING_DOCUMENTS.push(formattedDoc);
            }
        } catch (err) {
            console.error('Document parse error:', err.message);
        }



        return FINALRESPONSE;

    } catch (ex) {
        console.error(
            'DHL Ship Error:',
            ex?.response?.data || ex.message
        );
        FINALRESPONSE.STATUS = 'Error';
        FINALRESPONSE.ERRORS.push(
            ex?.response?.data?.detail || ex.message
        );
        // Guard against network/timeout errors where ex.response is undefined.
        if (Array.isArray(ex?.response?.data?.additionalDetails)) {
            ex.response.data.additionalDetails.forEach((er) => {
                FINALRESPONSE.ERRORS.push(er);
            });
        }
        if (Array.isArray(ex?.response?.data?.reasons)) {
            ex.response.data.reasons.forEach((er) => {
                FINALRESPONSE.ERRORS.push(er.msg);
            });
        }
        return FINALRESPONSE;
    }
};

/* ======================================
   REQUEST BUILDER
====================================== */

function buildDHLShipRequest(req) {
    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER } = req;
    // Build planned date with timezone offset. Allow CARRIER_DETAILS.TIMEZONE override
    // (e.g. "GMT+05:30"); fall back to the local Node-process timezone offset.
    const baseDateStr = (HEADER_INFO?.SHIP_DATE || new Date().toISOString()).split('.')[0];
    const tzOffset = (() => {
        if (CARRIER_DETAILS?.TIMEZONE) return CARRIER_DETAILS.TIMEZONE;
        const offMin = -new Date().getTimezoneOffset();
        const sign = offMin >= 0 ? '+' : '-';
        const abs = Math.abs(offMin);
        const hh = String(Math.floor(abs / 60)).padStart(2, '0');
        const mm = String(abs % 60).padStart(2, '0');
        return `GMT${sign}${hh}:${mm}`;
    })();
    const plannedDate = baseDateStr + tzOffset;
    const service = CARRIER_DETAILS?.SERVICE_CODE || CARRIER_DETAILS?.SERVICE_NAME;
    return {
        plannedShippingDateAndTime: plannedDate,
        pickup: { isRequested: false },
        productCode: service,
        accounts: [
            {
                typeCode: 'shipper',
                number: CARRIER_DETAILS.SHIPPING_ACCOUNT
            }
        ],
        customerDetails: {
            shipperDetails: buildParty(SHIPPER),
            receiverDetails: buildParty(SHIPTO)
        },
        content: {
            packages: PACKAGES.map(buildPackage),
            description: HEADER_INFO?.DESCRIPTION || 'Shipment',

            unitOfMeasurement: 'metric'
        },

        outputImageProperties: {
            encodingFormat: 'pdf',
            imageOptions: [
                { typeCode: 'label', templateName: 'ECOM26_84_001' }
            ]
        },
        getTransliteratedResponse: true,
        estimatedDeliveryDate: { isRequested: true }
    };
}

function buildParty(data = {}) {
    const postalAddress = {
        cityName: data.CITY,
        provinceCode: data.STATE,
        countryCode: data.COUNTRY,
        postalCode: data.ZIPCODE,
        addressLine1: data.ADDRESS_LINE1
    };

    if (data.ADDRESS_LINE2) postalAddress.addressLine2 = data.ADDRESS_LINE2;
    if (data.ADDRESS_LINE3) postalAddress.addressLine3 = data.ADDRESS_LINE3;

    const contactInformation = {};

    if (data.COMPANY) contactInformation.companyName = data.COMPANY;
    if (data.CONTACT) contactInformation.fullName = data.CONTACT;
    if (data.EMAIL) contactInformation.email = data.EMAIL;
    if (data.PHONE) contactInformation.phone = data.PHONE;

    return {
        postalAddress,
        contactInformation
    };
}

function buildPackage(pkg = {}) {
    const result = {
        weight: Number(pkg.WEIGHT)
    };

    // Dimensions
    if (pkg?.DIMENSION && pkg.DIMENSION !== "" && !pkg.DIMENSION.startsWith("0")) {
        const dims = pkg.DIMENSION.toUpperCase().replace(/\s/g, '').split('X');
        if (dims.length === 3) {
            result.dimensions = {
                length: Number(dims[0]),
                width: Number(dims[1]),
                height: Number(dims[2])
            };
        }
    }

    // Customer References
    result.customerReferences = [];

    const ref1 = {
        typeCode: 'CU',
        value: pkg.CARRIER_DETAILS?.REFERENCE1 || 'test'
    };

    const ref2 = {
        typeCode: 'IBC',
        value: pkg.CARRIER_DETAILS?.REFERENCE2 || 'test'
    };

    result.customerReferences.push(ref1, ref2);

    if (pkg.CARRIER_DETAILS?.REFERENCE3) {
        result.customerReferences.push({
            typeCode: 'PRN',
            value: pkg.CARRIER_DETAILS.REFERENCE3
        });
    }

    // Description
    if (pkg?.DESCRIPTION) {
        result.description = pkg.DESCRIPTION;
        result.labelDescription = pkg.DESCRIPTION;
    }

    return result;
}