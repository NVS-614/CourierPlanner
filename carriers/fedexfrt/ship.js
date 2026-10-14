// carriers/fedex/ship.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getFedexToken } = require('../../Reuse/fedex_token_manager.js');
const { getCSPFedexToken } = require('../../Reuse/fedex_csptoken_manager.js');
const dbCon = require("../../database/dbsaveandupdate.js");
//const { uploadETD } = require('./FedExETD');
require('dotenv').config();

const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

module.exports = async (request, chargeCodes) => {
    if (typeof request === 'string') {
        request = JSON.parse(request);
    }
    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES } = request;

    let FINALRESPONSE = {
        STATUS: '',
        TRACKING_STATUS: '',
        PACKAGES: [],
        CHARGE_DETAILS: [],
        SHIPPING_DOCUMENTS: [],
        ERRORS: [],
        HEADER_INFO
    };
    let currency = 'USD';


    const tokenurl = CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;
    const shipurl = CARRIER_DETAILS.SHIPURL || process.env.FEDEX_FREIGHT_SHIP;
    const CSPuserId = CARRIER_DETAILS.CSPUserId || CARRIER_DETAILS.CSP_USER || process.env.FEDEX_CSPUSER;
    const CSPpassword = CARRIER_DETAILS.CSPPassword || CARRIER_DETAILS.CSP_PASSWORD || process.env.FEDEX_CSPPASSWORD;
    const strlabeltype = CARRIER_DETAILS?.LABELTYPE === 'ZPL' ? 'ZPLII' : CARRIER_DETAILS?.LABELTYPE || 'PNG'
    try {
      //  const token = await getFedexToken(CARRIER_DETAILS.SHIPPING_ACCOUNT, tokenurl, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD);
     const token = await getCSPFedexToken(tokenurl, CSPuserId, CSPpassword, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD, CARRIER_DETAILS.SHIPPING_ACCOUNT);
        let strHazMat = false
        const shiprequest = buildFedExFreightShipment(request)
        console.log("FedEx Freight Ship Request:")
        console.log(JSON.stringify(shiprequest))
        const sres = await axiosInstance.post(
            shipurl,
            shiprequest,
            {
                headers: {
                    'content-type': 'application/json',
                    'authorization': `Bearer ${token}`
                }
            }
        );
        console.log('FEDEX Ship Response is ..:');
        // console.log(JSON.stringify(sres.data.output))
        //  reuse.LogfileSave('Res_FedEx_' + request.body.CARRIER_DETAILS.SERVICE_CODE, sres.data.output)
        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Shipped';
        let actualRateType = ""
        actualRateType = sres.data.output.transactionShipments[0]?.completedShipmentDetail?.shipmentRating?.actualRateType;
        try {
            sres.data.output.transactionShipments[0].completedShipmentDetail.shipmentRating.shipmentRateDetails.forEach(element => {
                if (actualRateType === element.rateType) {
                    FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipRateRes('Discounted Freight', element.totalNetCharge, element.currency, 'DISC'));
                    try {
                        element.surcharges.forEach(subpack => {
                            FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipSurRateRes(subpack.description, subpack.amount, element.currency, subpack.surchargeType, 'FEDEX', chargeCodes));
                        })
                    } catch (ex) { console.log(ex.message) }
                }

                else {
                    FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipRateRes('Published Freight', element.totalNetCharge, element.currency, 'LIST'));
                }

            });
        } catch (ex) { console.log(ex.message) }
        try {
            sres.data.output.transactionShipments[0].pieceResponses.forEach((piece, index) => {
                FINALRESPONSE.PACKAGES.push({ TRACKING_NUMBER: piece.trackingNumber });
                FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = FINALRESPONSE.PACKAGES[0]?.TRACKING_NUMBER;
                for (const doc of piece.packageDocuments || []) {
                    try {
                        let docName = '';
                        let contentType = 'Label';
                        let encodedLabel = doc.encodedLabel;

                        if (doc.contentType === 'AUXILIARY') {
                            docName = `${piece.trackingNumber}_AUX.${doc.docType}`;
                        } else if (
                            ['HAZMAT_LABEL', 'OP_900', 'DANGEROUS_GOODS_SHIPPERS_DECLARATION']
                                .includes(doc.contentType)
                        ) {
                            docName = `${piece.trackingNumber}_Hazmat.${doc.docType}`;
                            contentType = 'HAZMAT Label';
                        } else {
                            docName = `${piece.trackingNumber}.${doc.docType}`;
                        }

                        if (doc.docType === 'ZPLII') {
                            const buffer = Buffer.from(encodedLabel, 'base64');
                            encodedLabel = buffer
                                .toString('utf-8')
                                .replace('^POI', '')
                                .replace(/\0/g, '');
                        }

                        const formatDoc = reuse.formatShipDoc(
                            'FEDEX',
                            contentType,
                            doc?.copiesToPrint,
                            docName,
                            encodedLabel,
                            doc.docType
                        );

                        FINALRESPONSE.SHIPPING_DOCUMENTS.push(formatDoc);

                    } catch (err) {
                        console.error("Label process error:", err.message);
                    }
                }


            })
        } catch (ex) { console.log(ex.message) }


        const shipmentDocs =
            sres?.data?.output?.transactionShipments?.[0]?.shipmentDocuments || [];

        for (const piece of shipmentDocs) {
            try {
                let contentType = piece.contentType;
                let docName = '';

                if (piece.contentType === 'BILL_OF_LADING') {
                    contentType = 'BILL_OF_LADING';
                    docName = `${FINALRESPONSE.PACKAGES[0]?.TRACKING_NUMBER}_CI.PDF`;
                }

                const formatDoc = reuse.formatShipDoc(
                    'FEDEX',
                    contentType,
                    piece.copiesToPrint,
                    docName,
                    piece.encodedLabel,
                    'PDF'
                );

                FINALRESPONSE.SHIPPING_DOCUMENTS.push(formatDoc);

            } catch (err) {
                console.error("Shipment doc error:", err.message);
            }
        }


        let docp = [];

        // docp.push(documentprocess.preparePackingSlip_pdfkit(FINALRESPONSE))

        /* ---------------------------
   Promise.all with timeout
----------------------------*/

        const promiseTimeout = (promise, ms) => {
            return Promise.race([
                promise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Document processing timeout")), ms)
                )
            ]);
        };
        try {
            if (docp.length > 0) {
                const data = await promiseTimeout(Promise.all(docp), 15000);

                data.forEach(docdata => {
                    try {
                        if (Array.isArray(docdata)) {
                            docdata.forEach(rdocdata =>
                                FINALRESPONSE.SHIPPING_DOCUMENTS.push(rdocdata)
                            );
                        } else if (docdata) {
                            FINALRESPONSE.SHIPPING_DOCUMENTS.push(docdata);
                        }
                    } catch (err) {
                        console.error("Document parse error:", err.message);
                    }
                });
            }
        } catch (docError) {
            console.error("Document processing failed:", docError.message);
            FINALRESPONSE.ERRORS.push(docError.message);
        }
        return FINALRESPONSE;

    } catch (ex) {
        console.error("FedEx Ship Error:", ex?.response?.data || ex.message);
        FINALRESPONSE.STATUS = 'Error';
        let errordesc = reuse.handleShipErrorRes(ex);
        FINALRESPONSE.ERRORS = errordesc;
        return FINALRESPONSE;
    }
};


const buildAddress = (data) => ({
    city: data.CITY,
    stateOrProvinceCode: data.STATE,
    countryCode: data.COUNTRY,
    postalCode: data.ZIPCODE,
    streetLines: [
        data.ADDRESS_LINE1,
        data.ADDRESS_LINE2,
        data.ADDRESS_LINE3
    ].filter(Boolean)
})

const buildContact = (data) => ({
    companyName: data.COMPANY,
    personName: data.CONTACT || 'CONTACT',
    emailAddress: data.EMAIL,
    phoneNumber: data.PHONE
})

const getWeightUnits = (unit) => {
    const u = unit?.toUpperCase()
    if (["LB", "LBS"].includes(u)) return { weight: "LB", dim: "IN" }
    if (["KG", "KGS"].includes(u)) return { weight: "KG", dim: "CM" }
    return { weight: "LB", dim: "IN" }
}

const buildDimensions = (dimension, unit) => {
    if (dimension && !dimension.startsWith("0") && dimension !== "") {
        const dims = dimension.toUpperCase().split('X');
        return {
            length: Number(dims[0]),
            width: Number(dims[1]),
            height: Number(dims[2]),
            units: unit
        }
    }
    return null
}

const buildLineItem = (pkg) => {

    const { weight, dim } = getWeightUnits(pkg.WEIGHT_UNITS)

    return {
        id: pkg?.ITEM_NO,
        freightClass: `CLASS_${(pkg?.LTL_CLASS || "50").toString().padStart(3, "0")}`,
        purchaseOrderNumber: pkg?.PO_NUMBER,
        handlingUnits: pkg?.HU_QUANTITY || 1,
        subPackagingType: pkg?.ITEM_PACKING_TYPE || "BOX",
        description: pkg?.DESCRIPTION || "FedEx Freight",
        pieces: Number(pkg.QUANTITY) || 1,

        weight: {
            value: Number(pkg.WEIGHT),
            units: weight
        },

        dimensions: buildDimensions(pkg.DIMENSION, dim)
    }
}

const buildPackage = (pkg, index) => {

    const { weight, dim } = getWeightUnits(pkg.WEIGHT_UNITS)

    const customerReferences = [
        {
            customerReferenceType: "INVOICE_NUMBER",
            value: pkg.INVOICE_NUMBER
        },
        {
            customerReferenceType: "CUSTOMER_REFERENCE",
            value: pkg.CUSTOMER_REFERENCE
        },
        {
            customerReferenceType: "P_O_NUMBER",
            value: pkg.PO_NUMBER
        }
    ]

    return {
        itemDescriptionForClearance: pkg.DESCRIPTION,
        weight: {
            value: Number(pkg.WEIGHT),
            units: weight
        },
        customerReferences,
        subPackagingType: pkg?.ITEM_PACKING_TYPE || "BUCKET",
        groupPackageCount: 1,
        sequenceNumber: index,
        dimensions: buildDimensions(pkg.DIMENSION, dim),
        physicalPackaging: pkg.PACKING_TYPE || "PALLET",
        associatedFreightLineItems: [
            { id: pkg.ITEM_NO }
        ],
        contentRecord: (pkg?.ITEM_INFO || []).map(item => ({
            itemNumber: item.ITEM_NO,  //package item number.
            receivedQuantity: Number(item.QUANTITY) || 1, //package item quantity.
            description: item.DESCRIPTION, //description of the package item.
            partNumber: item.SNO //part number.
        }))
    }
}

function buildFedExFreightShipment(request) {

    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER, BILLTO, INTERNATIONAL_DETAILS } = request;
    const strlabeltype = CARRIER_DETAILS?.LABELTYPE === 'ZPL' ? 'ZPLII' : CARRIER_DETAILS?.LABELTYPE || 'PNG'
    const shipDateStr = HEADER_INFO?.SHIP_DATE || new Date().toISOString();
    const [date, time] = shipDateStr.split('T')
    let SHIPFROM = request.SHIPFROM?.ZIPCODE ? request.SHIPFROM : SHIPPER;
    let SOLDTO = request.SOLDTO?.ZIPCODE ? request.SOLDTO : SHIPTO;
    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES;
    const shipment = {
        shipDatestamp: date,
        pickupType: HEADER_INFO.PICKUP_TYPE || "USE_SCHEDULED_PICKUP",
        serviceType: CARRIER_DETAILS?.SERVICE_CODE,
        packagingType: HEADER_INFO.PACKAGING_TYPE || 'YOUR_PACKAGING',
        totalPackageCount: PACKAGES.length,

        shipper: {
            address: buildAddress(SHIPPER),
            contact: buildContact(SHIPPER)
        },

        origin: {
            address: buildAddress(SHIPFROM),
            contact: buildContact(SHIPFROM)
        },

        recipient: {
            address: buildAddress(SHIPTO),
            contact: buildContact(SHIPTO)
        },

        soldTo: {
            address: buildAddress(SOLDTO),
            contact: buildContact(SOLDTO)
        },

        shippingChargesPayment: {

            paymentType: (CARRIER_DETAILS.PAYMENT_TYPE || 'SENDER').toUpperCase(),

            payor: {
                responsibleParty: {
                    accountNumber: {
                        value: CARRIER_DETAILS?.SHIPPING_ACCOUNT
                    }
                }
            }
        },

        freightShipmentDetail: {
            fedExFreightAccountNumber: {
                value: CARRIER_DETAILS?.BILLING_ACCOUNT
            },
            fedExFreightBillingContactAndAddress: {
                address: buildAddress(BILLTO),
                contact: buildContact(BILLTO)
            },
            role: CARRIER_DETAILS?.ROLE || "SHIPPER",
            collectTermsType: CARRIER_DETAILS?.PAYMENT_TERMS,
            totalHandlingUnits: PACKAGES.length,
            lineItem: PACKAGES.map(buildLineItem)
        },

        requestedPackageLineItems: PACKAGES.map(buildPackage),

        rateRequestType: ["LIST", "ACCOUNT"],
        freightShipmentSpecialServices: freightShipmentSpecialServices(SLSS),
        labelSpecification: {

            labelFormatType: "COMMON2D",

            labelOrder: "SHIPPING_LABEL_FIRST",

            labelStockType:
                ["PDF", "ZPL"].includes(CARRIER_DETAILS?.LABELTYPE)
                    ? "STOCK_4X6"
                    : "PAPER_4X6",

            imageType: strlabeltype,

            resolution: 200
        },

        shippingDocumentSpecification: {

            shippingDocumentTypes: [
                "FEDEX_FREIGHT_STRAIGHT_BILL_OF_LADING"
            ],

            freightBillOfLadingDetail: {
                format: {
                    stockType: "PAPER_LETTER",
                    docType: "PDF"
                }
            }
        },
        ...((HEADER_INFO.TOTAL_WEIGHT) && { totalWeight: Number(HEADER_INFO.TOTAL_WEIGHT) })

    }


    return {
        accountNumber: {
            value: CARRIER_DETAILS.SHIPPING_ACCOUNT
        },

        mergeLabelDocOption: "LABELS_AND_DOCS",

        labelResponseOptions: "LABEL",

        freightRequestedShipment: shipment
    }
}

const freightShipmentSpecialServices = (SLSS = {}) => {
    const ss = {
        specialServiceTypes: []
    };
    // ---------------- BASIC SPECIAL SERVICES ----------------
    // SLSS field name → FedEx Freight special service type
    const flagMap = {
        BROKER_SELECT: 'BROKER_SELECT_OPTION',
        INSIDE_DELIVERY: 'INSIDE_DELIVERY',
        INSIDE_PICKUP: 'INSIDE_PICKUP',
        DELIVERY_NOTIFICATION: 'CALL_BEFORE_DELIVERY',
        LIFTGATE_PICKUP: 'LIFTGATE_PICKUP',
        LIFTGATE_DELIVERY: 'LIFTGATE_DELIVERY',
        LIMITED_ACCESS_DELIVERY: 'LIMITED_ACCESS_DELIVERY',
        LIMITED_ACCESS_PICKUP: 'LIMITED_ACCESS_PICKUP',
        POISON: 'POISON',
        PROTECT_FROM_FREEZING: 'PROTECTION_FROM_FREEZING',
        FOOD: 'FOOD',
        DO_NOT_BREAK_DOWN_PALLETS: 'DO_NOT_BREAK_DOWN_PALLETS',
        DO_NOT_STACK_PALLETS: 'DO_NOT_STACK_PALLETS',
        HAZMAT: 'DANGEROUS_GOODS'
    };
    for (const [field, serviceType] of Object.entries(flagMap)) {
        if (isTrue(SLSS?.[field])) {
            ss.specialServiceTypes.push(serviceType);
        }
    }
    // ---------------- FREIGHT GUARANTEE ----------------
    if (SLSS?.FREIGHT_GUARANTEE?.TYPE) {

        ss.specialServiceTypes.push('FREIGHT_GUARANTEE');

        ss.freightGuaranteeDetail = {
            freightGuaranteeType: SLSS.FREIGHT_GUARANTEE.TYPE,
            guaranteeTimestamp: SLSS.FREIGHT_GUARANTEE.DATE
        };
    }

    // ---------------- FREIGHT DIRECT ----------------

    if (SLSS?.FREIGHT_DIRECT?.TYPE) {

        ss.specialServiceTypes.push('FREIGHT_DIRECT');

        ss.freightDirectDetail = {
            freightDirectDataDetails: []
        };

        const arrfreightDirect = {
            type: SLSS.FREIGHT_DIRECT.TYPE,
            transportationType: SLSS.FREIGHT_DIRECT.TRANSPORT_TYPE
        };

        if (SLSS.FREIGHT_DIRECT?.EMAIL) {
            arrfreightDirect.emailAddress = SLSS.FREIGHT_DIRECT.EMAIL;
        }

        if (SLSS.FREIGHT_DIRECT?.PHONE) {
            arrfreightDirect.phoneNumberDetails = [{
                phoneNumberType: 'MOBILE',
                phoneNumber: SLSS.FREIGHT_DIRECT.PHONE
            }];
        }

        ss.freightDirectDetail.freightDirectDataDetails.push(arrfreightDirect);
    }

    return ss;
};

// Shared boolean helper — accepts true / "true" / "x" / "yes" / "1" (case-insensitive)
const isTrue = (val) =>
    val === true ||
    (typeof val === 'string' && ['true', 'x', 'yes', '1'].includes(val.toLowerCase().trim()));