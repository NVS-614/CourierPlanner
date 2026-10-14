// Monetary/Customs Value = Actual product price
//🎯 Declared/Carriage Value = What carrier will pay if lost
//🎯 Insured Value = What YOU want to insure additionally
//🎯 Total Value = Invoice total amount
//shippingDocumentSpecification ==> mandatory for ETD special option..... optional for Normal International.
//"etdDetail": {"requestedDocumentTypes": ["COMMERCIAL_INVOICE"]}] ==> FedEx return CI when we pass this block +ETD..
//FedEx also discounts surcharges internally, but they do not show surcharge discounts separately.

// carriers/fedex/ship.js
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getFedexToken } = require('../../Reuse/fedex_token_manager.js');
const { getCSPFedexToken } = require('../../Reuse/fedex_csptoken_manager.js');
const { uploadETD, uploadEncodedMultiETD, uploadMultiETD } = require('./etduploads');
const Getcode = require('../../Reuse/ServicesandCodes.js');
const { buildFinalResponse } = require('../../Reuse/responseBuilder');
//const FedExIncludeReturn = require('../FedEx/FedExIncludeReturn.js');
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
    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER, INTERNATIONAL_DETAILS } = request;
    let SHIPFROM = request.SHIPFROM?.ZIPCODE ? request.SHIPFROM : SHIPPER;
    let holdaddress = request.HOLD_AT_LOCATION?.ZIPCODE ? request.HOLD_AT_LOCATION : SHIPTO;
    let brokeraddress = request?.INTERNATIONAL_DETAILS?.BROKER_ADDRESS || request?.BROKER_ADDRESS;
    let FINALRESPONSE = buildFinalResponse(request);
    let currency = INTERNATIONAL_DETAILS?.CURRENCY || HEADER_INFO?.CURRENCY || 'USD';
    const { weightUnit, dimUnit } = getUnits(PACKAGES?.[0]?.WEIGHT_UNITS);
    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES || {};
    const hasETD = isTrue(SLSS?.ELECTRONIC_TRADE_DOCUMENT);
    const hasBase64Docs = Array.isArray(SLSS?.ETD_DOCUMENTS)
        && SLSS.ETD_DOCUMENTS.length > 0
        && !!SLSS.ETD_DOCUMENTS[0]?.ENCODED_DOC;
    const hasUploadedFiles = Array.isArray(request.files) && request.files.length > 1;
    const tokenurl = CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;
    const shipurl = CARRIER_DETAILS.SHIPURL || process.env.FEDEX_SHIP;
    const ETDfileurl = CARRIER_DETAILS.ETDFILEURL || process.env.FEDEX_ETD_FILE; //multiupload
    const ETDbase64url = CARRIER_DETAILS.ETDBASE64URL || process.env.FEDEX_ETD_BASE64;
    const labelType = CARRIER_DETAILS?.LABELTYPE || 'PDF';
    const CSPuserId = CARRIER_DETAILS.CSP_USER || process.env.FEDEX_CSPUSER;
    const CSPpassword = CARRIER_DETAILS.CSP_PASSWORD || process.env.FEDEX_CSPPASSWORD;
    try {
        //const token = await getFedexToken(CARRIER_DETAILS.SHIPPING_ACCOUNT, tokenurl, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD);
        const token = await getCSPFedexToken(tokenurl, CSPuserId, CSPpassword, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD, CARRIER_DETAILS.SHIPPING_ACCOUNT);
       // console.log(token)
        if (SLSS?.HOME_DELIVERY?.PREMIUM_TYPE) {
            SHIPTO.ADDRESS_TYPE = "RESIDENTIAL";
        };
        if (isTrue(SLSS?.RESIDENTIAL_DELIVERY)) {
            SHIPTO.ADDRESS_TYPE = "RESIDENTIAL";
        };
        const service = CARRIER_DETAILS?.SERVICE_CODE || CARRIER_DETAILS?.SERVICE_NAME;

        let strHazMat = !!PACKAGES[0]?.PACKAGE_LVL_SPECIAL_SERVICES?.HAZMAT?.UNID_NUMBER;
        let documentId = null;

        let documentIds = [];


        if (hasETD) {
            if (hasBase64Docs) {
                // 🔵 Encoded Multi Upload
                const documentsArray = SLSS.ETD_DOCUMENTS.map((doc, index) => ({
                    contentType: doc?.CONTENT_TYPE || 'application/pdf',
                    documentType: doc?.DOC_TYPE || 'COMMERCIAL_INVOICE',
                    base64: doc.ENCODED_DOC
                }));

                const uploadResult = await uploadEncodedMultiETD(ETDbase64url,
                    token,
                    documentsArray,
                    {
                        origin: SHIPPER.COUNTRY,
                        destination: SHIPTO.COUNTRY
                    }
                );

                const docResponses = uploadResult?.output?.documentResponses;
                if (Array.isArray(docResponses)) {
                    docResponses.forEach(r => {
                        if (r?.metaData?.docId) documentIds.push(r.metaData.docId);
                    });
                } else if (docResponses?.metaData?.docId) {
                    documentIds.push(docResponses.metaData.docId);
                }

            } else if (hasUploadedFiles) {
                // 🟢 Multipart Multi Upload
                const documentMeta = {
                    workflowName: "ETDPreshipment",
                    carrierCode: "FDXE",
                    originCountryCode: SHIPPER.COUNTRY,
                    destinationCountryCode: SHIPTO.COUNTRY,
                    shipmentDate: new Date().toISOString(),
                    metaData: request.files.map((file, index) => ({
                        fileName: file.originalname,
                        fileReferenceId: `REF_${index}`,
                        contentType: file.mimetype,
                        shipDocumentType: "COMMERCIAL_INVOICE"
                    }))
                };

                const uploadResult = await uploadMultiETD(ETDfileurl, token, documentMeta, request.files);

                documentIds = uploadResult.output.documents.map(d => d.documentId);
            } else if (Array.isArray(request.files) && request.files.length > 0) {
                const file = request.files[0]; // only first file
                const documentMeta = {
                    workflowName: "ETDPreshipment",
                    carrierCode: "FDXE",
                    contentType: file.mimetype,
                    name: file.originalname,
                    meta: {
                        originCountryCode: SHIPPER.COUNTRY,
                        destinationCountryCode: SHIPTO.COUNTRY,
                        shipDocumentType: "COMMERCIAL_INVOICE"
                    }
                };
                const uploadResult = await uploadETD(ETDfileurl, token, documentMeta, file);
                const docId = uploadResult?.output?.meta?.docId;
                if (docId) documentIds.push(docId);
            }
        }

        // Shipment request
        const shiprequest = {
            accountNumber: { value: CARRIER_DETAILS.SHIPPING_ACCOUNT },
            shipAction: 'CONFIRM',
            processingOptionType: 'ALLOW_ASYNCHRONOUS',
            oneLabelAtATime: false,
            mergeLabelDocOption: 'LABELS_AND_DOCS',
            labelResponseOptions: 'LABEL',
            requestedShipment: {
                shipDatestamp: HEADER_INFO?.SHIP_DATE
                    ? HEADER_INFO.SHIP_DATE.split('T')[0]
                    : new Date().toISOString().split('T')[0],
                shipper: buildAddress(SHIPPER),
                origin: buildAddress(SHIPFROM),
                recipients: [buildAddress(SHIPTO)],
                //residential: service.toUpperCase() === "FEDEX_GROUND" ? false : shipmentData.SHIPTO?.ADDRESS_TYPE === "RESIDENTIAL"
                pickupType: CARRIER_DETAILS.PICKUP_TYPE || 'USE_SCHEDULED_PICKUP',
                serviceType: service,
                packagingType: HEADER_INFO?.PACKAGING_TYPE || 'YOUR_PACKAGING',
                totalWeight: HEADER_INFO?.TOTAL_WEIGHT,
                shippingChargesPayment: {
                    // Condition for shippingChargesPayment
                    paymentType: /third|3rd/i.test(CARRIER_DETAILS.PAYMENT_TYPE || '') ? 'THIRD_PARTY' :
                        (CARRIER_DETAILS.PAYMENT_TYPE || '').toUpperCase() === 'RECIPIENT' ? 'RECIPIENT' :
                            (CARRIER_DETAILS.PAYMENT_TYPE || '').toUpperCase() === 'COLLECT' ? 'COLLECT' :
                                (CARRIER_DETAILS.PAYMENT_TYPE || 'SENDER').toUpperCase(),
                    // Condition for payor details by spread operator
                    ...(/third|3rd|RECIPIENT|COLLECT/i.test(CARRIER_DETAILS.PAYMENT_TYPE || '') && {
                        payor: {
                            responsibleParty: {
                                address: {
                                    countryCode: CARRIER_DETAILS?.BILLING_COUNTRY,
                                    postalCode: CARRIER_DETAILS?.BILLING_ZIPCODE
                                },
                                accountNumber: {
                                    value: CARRIER_DETAILS.BILLING_ACCOUNT
                                }
                            }
                        }
                    })
                },
                ...((CARRIER_DETAILS.HUBID) && {
                    smartPostInfoDetail: {
                        hubId: CARRIER_DETAILS.HUBID,
                        indicia: SLSS?.INDICIA || 'PARCEL_SELECT'
                    }
                }),
                ...((INTERNATIONAL_DETAILS?.BOOKING_CONFIRM_NUMBER) && {
                    expressFreightDetail: {
                        bookingConfirmationNumber: INTERNATIONAL_DETAILS.BOOKING_CONFIRM_NUMBER,
                        shippersLoadAndCount: INTERNATIONAL_DETAILS?.SHIPPER_LOAD_COUNT || 1
                    }
                }),
                ...(SLSS?.EMAIL_NOTIFICATION?.EVENT_TYPE?.length && {
                    emailNotificationDetail: {
                        aggregationType: "PER_PACKAGE",
                        emailNotificationRecipients: [
                            {
                                name: SLSS.EMAIL_NOTIFICATION.CONTACT || SHIPTO.CONTACT,
                                emailNotificationRecipientType: SLSS.EMAIL_NOTIFICATION.RECIPIENT_TYPES || 'RECIPIENT',
                                emailAddress: SLSS.EMAIL_NOTIFICATION.EMAIL || SHIPTO.EMAIL,
                                notificationFormatType: 'HTML',
                                notificationType: 'EMAIL',
                                locale: 'en_US',
                                notificationEventType: SLSS.EMAIL_NOTIFICATION.EVENT_TYPE
                            }
                        ]
                    }
                }),

                ...(SHIPPER.COUNTRY !== SHIPTO.COUNTRY && {
                    customsClearanceDetail: {
                        // Broker details
                        ...(brokeraddress?.COUNTRY && {
                            brokers: [{
                                broker: {
                                    address: {
                                        streetLines: [
                                            brokeraddress.ADDRESS_LINE1,
                                            brokeraddress.ADDRESS_LINE2,
                                            brokeraddress.ADDRESS_LINE3
                                        ].filter(line => line),
                                        city: brokeraddress.CITY,
                                        stateOrProvinceCode: brokeraddress.STATE,
                                        postalCode: brokeraddress.ZIPCODE,
                                        countryCode: brokeraddress.COUNTRY
                                    },
                                    contact: {
                                        personName: brokeraddress.CONTACT,
                                        emailAddress: brokeraddress.EMAIL,
                                        phoneNumber: reuse.validatePhNo(brokeraddress.PHONE),
                                        companyName: brokeraddress.COMPANY
                                    }
                                },
                                type: 'IMPORT'
                            }]
                        }),

                        // Commercial invoice
                        commercialInvoice: {
                            originatorName: '',
                            comments: ['commercialInvoice'],
                            customerReferences: [
                                {
                                    customerReferenceType: 'CUSTOMER_REFERENCE',
                                    value: 'CUSTOMER_REFERENCE'
                                },
                                {
                                    customerReferenceType: 'P_O_NUMBER',
                                    value: 'P_O_NUMBER'
                                }
                            ],
                            specialInstructions: INTERNATIONAL_DETAILS?.SPL_INSTRUCTIONS,
                            shipmentPurpose: INTERNATIONAL_DETAILS?.REASON_FOR_EXPORT?.toUpperCase() || 'SOLD',
                            termsOfSale: Getcode.getTermsOfSaleCode(INTERNATIONAL_DETAILS?.INCOTERMS) || 'DDP'
                        },

                        // Duties payment
                        dutiesPayment: {
                            paymentType: INTERNATIONAL_DETAILS?.DUTIES_PAYMENT_TYPE?.toUpperCase() || 'RECIPIENT',
                            ...(INTERNATIONAL_DETAILS?.DUTIES_PAYMENT_TYPE && {
                                payor: {
                                    responsibleParty: {
                                        accountNumber: {
                                            value: INTERNATIONAL_DETAILS.DUTIES_ACCOUNT
                                        }
                                    }
                                }
                            })
                        },

                        // Commodities
                        commodities: INTERNATIONAL_DETAILS.ITEM_INFO?.map(item => ({
                            unitPrice: {
                                amount: Number(item.UNIT_COST),
                                currency: INTERNATIONAL_DETAILS?.CURRENCY || currency
                            },
                            numberOfPieces: Number(item.PIECES || 1),
                            quantity: Number(item.QUANTITY),
                            quantityUnits: item.UOM || 'EA',
                            customsValue: {
                                amount: Number(item.QUANTITY * item.UNIT_COST),
                                currency: INTERNATIONAL_DETAILS?.CURRENCY || currency
                            },
                            countryOfManufacture: item?.COUNTRY_OF_MFR || SHIPPER.COUNTRY,
                            harmonizedCode: item.HTS_CODE,
                            description: item.DESCRIPTION,
                            weight: {
                                units: weightUnit,
                                value: Number(item.ITEM_WEIGHT || 1)
                            },
                            partNumber: item.PRODUCT_NO
                        })) || [],

                        // Importer of record
                        ...(INTERNATIONAL_DETAILS?.IMPORTER_ADDRESS?.PHONE && {
                            importerOfRecord: {
                                address: {
                                    streetLines: [
                                        INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.ADDRESS_LINE1,
                                        INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.ADDRESS_LINE2,
                                        INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.ADDRESS_LINE3
                                    ].filter(line => line),
                                    city: INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.CITY,
                                    stateOrProvinceCode: INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.STATE,
                                    postalCode: INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.ZIPCODE,
                                    countryCode: INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.COUNTRY
                                },
                                contact: {
                                    personName: INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.CONTACT,
                                    emailAddress: INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.EMAIL,
                                    phoneNumber: reuse.validatePhNo(INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.PHONE),
                                    companyName: INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.COMPANY
                                },
                                ...(INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.TIN_NUMBER && {
                                    tins: [{
                                        number: INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.TIN_NUMBER,
                                        tinType: INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.TIN_TYPE
                                    }]
                                }),
                                accountNumber: {
                                    value: INTERNATIONAL_DETAILS.IMPORTER_ADDRESS.ACCOUNT_NUMBER
                                }
                            }
                        }),

                        // Total customs value
                        totalCustomsValue: {
                            amount: Number(INTERNATIONAL_DETAILS.ITEM_INFO?.reduce(
                                (sum, item) => sum + (item.QUANTITY * item.UNIT_COST), 0
                            ) || 0),
                            currency: INTERNATIONAL_DETAILS?.CURRENCY || currency
                        },

                        // Export details
                        ...(INTERNATIONAL_DETAILS.B13_FILING_OPTION && {
                            exportDetail: {
                                b13AFilingOption: INTERNATIONAL_DETAILS.B13_FILING_OPTION.toUpperCase(),
                                exportComplianceStatement: INTERNATIONAL_DETAILS?.EXPORT_STATEMENT,
                                permitNumber: INTERNATIONAL_DETAILS.ITN
                            }
                        }),
                        isDocumentOnly: false,
                        // Insurance
                        ...(SLSS?.INSURANCE_AMOUNT > 0 && {
                            insuranceCharge: {
                                amount: Number(SLSS.INSURANCE_AMOUNT),
                                currency: SLSS?.INSURANCE_CURRENCY || currency
                            }
                        })
                    }
                }),
                labelSpecification: {
                    labelFormatType: 'COMMON2D',
                    labelOrder: 'SHIPPING_LABEL_FIRST',
                    customerSpecifiedDetail: {
                        maskedData: [
                            'TERMS_AND_CONDITIONS'
                        ]
                    },
                    imageType: labelType === 'ZPL' ? 'ZPLII' : labelType,
                    labelStockType: ['PDF', 'ZPL'].includes(labelType) ? 'STOCK_4X6' : 'PAPER_4X6',
                    ...(labelType === 'ZPL' && { resolution: 200 })
                },
                shippingDocumentSpecification: {
                    shippingDocumentTypes: [
                        ...(SHIPPER.COUNTRY !== SHIPTO.COUNTRY
                            ? ['COMMERCIAL_INVOICE']
                            : []),
                        ...(strHazMat
                            ? service.toUpperCase() === 'FEDEX_GROUND'
                                ? ['OP_900']
                                : ['DANGEROUS_GOODS_SHIPPERS_DECLARATION']
                            : [])
                    ],
                    ...(SHIPPER.COUNTRY !== SHIPTO.COUNTRY && {
                        commercialInvoiceDetail: {
                            documentFormat: {
                                stockType: 'PAPER_LETTER',
                                docType: 'PDF'
                            }
                        }
                    }),
                    ...(strHazMat && {
                        ...(service.toUpperCase() === 'FEDEX_GROUND'
                            ? {
                                op900Detail: {
                                    documentFormat: {
                                        stockType: 'PAPER_LETTER',
                                        docType: 'PDF',
                                        provideInstructions: true
                                    },
                                    signatureName: '',
                                    customerImageUsages: [{
                                        id: 'IMAGE_1',
                                        type: 'SIGNATURE',
                                        provideImageType: 'SIGNATURE'
                                    }]
                                }
                            }
                            : {
                                dangerousGoodsShippersDeclarationDetail: {
                                    documentFormat: {
                                        stockType: 'PAPER_LETTER',
                                        docType: 'PDF',
                                        provideInstructions: true
                                    }
                                }
                            })
                    })
                }

            }

        };
        shiprequest.requestedShipment.rateRequestType = ["LIST", "ACCOUNT"];
        shiprequest.requestedShipment.requestedPackageLineItems = PACKAGES.map((element, index) => {

            // is equivalent to:
            //const result = getUnits(weightUnits);
            //const weightUnit = result.weightUnit;
            //const dimUnit = result.dimUnit;
            const xpackage = {
                itemDescription: element?.DESCRIPTION,
                weight: {
                    value: Number(element.WEIGHT),
                    units: weightUnit
                },
                customerReferences: createCustomerReferences(HEADER_INFO),
                ...((element.ITEM_PACKING_TYPE) && { subPackagingType: element.ITEM_PACKING_TYPE }),
                //contentRecord: createContentRecords(element.ItemsInfo || []),
                sequenceNumber: index,
                dimensions: createDimensions(element.DIMENSION, dimUnit)
            };


            xpackage.packageSpecialServices = createPackageSpecialServices(element.PACKAGE_LVL_SPECIAL_SERVICES, SLSS)


            return xpackage;
        });

        //shipmentSpecialServices
        // Always initialise so downstream assignments (etdDetail) cannot crash.
        shiprequest.requestedShipment.shipmentSpecialServices = { specialServiceTypes: [] };
        try {
            shiprequest.requestedShipment.shipmentSpecialServices = createShipmentSpecialServices(SLSS, holdaddress);
        } catch (ex) {
            console.error('Error processing shipment special services:', ex.message);
        }
        // Attach ETD documents dynamically
        if (hasETD) {
            shiprequest.requestedShipment.shipmentSpecialServices.etdDetail = {
                requestedDocumentTypes: ['COMMERCIAL_INVOICE'],
                ...((Array.isArray(documentIds) && documentIds.length > 0) && {
                    attachedDocuments: documentIds.map(id => ({
                        documentType: "COMMERCIAL_INVOICE",
                        description: "COMMERCIAL INVOICE",
                        documentId: id
                    }))
                })
            };

        }
        console.log(JSON.stringify(shiprequest));


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
        //  reuse.LogfileSave('Res_FedEx_' + request.CARRIER_DETAILS.SERVICE_CODE, sres.data.output)

        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Shipped';
        let transShip = sres.data.output.transactionShipments[0];
        if (transShip.serviceName) {
            FINALRESPONSE.SERVICE_NAME = transShip.serviceName;
        }
        if (transShip.masterTrackingNumber) {
            FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = transShip.masterTrackingNumber;
        }
        try {
            let rates = transShip?.completedShipmentDetail?.shipmentRating?.shipmentRateDetails || [];
            let accountRate = rates.find(r => r?.rateType?.includes("ACCOUNT"));
            let listRate = rates.find(r => r?.rateType?.includes("LIST"));
            /* -------- ACCOUNT RATE (Customer Price) -------- */
            if (accountRate) {
                FINALRESPONSE.DISCOUNTED_FREIGHT = accountRate?.totalNetCharge?.toString();
                FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipSurRateRes('Base Transportation', accountRate.totalNetFreight, accountRate.currency, 'BASE', 'FEDEX', chargeCodes));
                if (accountRate.surcharges) {
                    accountRate.surcharges.forEach(s => {
                        FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipSurRateRes(s.description, s.amount, accountRate.currency, s.surchargeType, 'FEDEX', chargeCodes))
                    });
                }
                FINALRESPONSE.CURRENCY = accountRate.currency;
            }
            /* -------- PUBLISHED RATE -------- */
            if (listRate) {
                FINALRESPONSE.PUBLISHED_FREIGHT = listRate?.totalNetCharge?.toString();
                if (!FINALRESPONSE.CURRENCY) FINALRESPONSE.CURRENCY = listRate.currency;
            }
        } catch (error) {
            console.log(error.message)
        }

        try {
            transShip.pieceResponses.forEach((piece, index) => {
                FINALRESPONSE.PACKAGES.push({ TRACKING_NUMBER: piece.trackingNumber });

                for (const doc of piece.packageDocuments || []) {
                    try {
                        let docName = '';
                        let contentType = 'LABEL';
                        let encodedLabel = doc.encodedLabel;

                        if (doc.contentType === 'AUXILIARY') {
                            contentType = 'AUXILIARY LABEL';
                            docName = `${piece.trackingNumber}_AUX.${doc.docType}`;
                        } else if (
                            ['HAZMAT_LABEL', 'OP_900', 'DANGEROUS_GOODS_SHIPPERS_DECLARATION']
                                .includes(doc.contentType)
                        ) {
                            docName = `${piece.trackingNumber}_Hazmat.${doc.docType}`;
                            contentType = 'HAZMAT FORM';
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


        if (SHIPPER.COUNTRY != SHIPTO.COUNTRY) {
            const shipmentDocs =
                sres?.data?.output?.transactionShipments?.[0]?.shipmentDocuments || [];

            for (const piece of shipmentDocs) {
                try {
                    let contentType = piece.contentType;
                    let docName = '';

                    if (piece.contentType === 'COMMERCIAL_INVOICE') {
                        contentType = 'INVOICE';
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
        }

        let docp = [];
        // try {
        //     if (SLSS.RETURN_SHIP?.RETURN_TYPE) {
        //         try {
        //             docp.push(FedExIncludeReturn.ReturnShip(request, token))
        //         }
        //         catch (ex) {
        //             console.log(ex.message)
        //             FINALRESPONSE.STATUS = 'Error';
        //             FINALRESPONSE.ERRORS.push(ex.message);
        //         }
        //     }
        // } catch (error) {
        // }
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

        // ✅ Now this throw WILL be caught by controller
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
    address: {
        city: data.CITY,
        stateOrProvinceCode: data.STATE,
        countryCode: data.COUNTRY,
        postalCode: data.ZIPCODE,
        streetLines: [data.ADDRESS_LINE1, data.ADDRESS_LINE2, data.ADDRESS_LINE3].filter(Boolean),
        ...((data?.ADDRESS_TYPE) && { residential: data?.ADDRESS_TYPE.toUpperCase() === "RESIDENTIAL" })
    },
    contact: {
        companyName: data.COMPANY,
        personName: data.CONTACT,
        emailAddress: data.EMAIL,
        phoneNumber: reuse.validatePhNo(data.PHONE)
    }
});
const createCustomerReferences = (ref) => {
    return [
        { customerReferenceType: 'INVOICE_NUMBER', value: ref.INVOICE_NUMBER },
        { customerReferenceType: 'CUSTOMER_REFERENCE', value: ref.CUSTOMER_REFERENCE },
        { customerReferenceType: 'P_O_NUMBER', value: ref.PO_NUMBER },
        { customerReferenceType: 'DEPARTMENT_NUMBER', value: ref?.NOTES }
    ];
};
const getUnits = (weightUnits) => {
    if (['LBS', 'LB'].includes(weightUnits?.toUpperCase())) {
        return { weightUnit: 'LB', dimUnit: 'IN' };
    } else if (['KGS', 'KG'].includes(weightUnits?.toUpperCase())) {
        return { weightUnit: 'KG', dimUnit: 'CM' };
    }
    return { weightUnit: 'LB', dimUnit: 'IN' }; // Default to LB and IN
};

const createContentRecords = (itemsInfo) => {
    return itemsInfo.map(item => ({
        itemNumber: item.ItemNo,
        receivedQuantity: Number(item.QUANTITY) || 0,
        description: item.DESCRIPTION,
        partNumber: item.PRODUCT_NO
    }));
};

const createDimensions = (dimension, dimUnit) => {
    if (dimension && !dimension.startsWith("0") && dimension !== "") {
        const dims = dimension.toUpperCase().split('X');
        return {
            length: Number(dims[0]),
            width: Number(dims[1]),
            height: Number(dims[2]),
            units: dimUnit
        };
    }
    return null;
};


const createShipmentSpecialServices = (SLSS, holdaddress) => {
    const shipmentSpecialServices = {
        specialServiceTypes: [],
        ...(SLSS?.HOLD_AT_LOCATION && {
            holdAtLocationDetail: {
                locationId: holdaddress?.LOCATION_ID,
                locationType: holdaddress?.LOCATION_TYPE,
                locationContactAndAddress: {
                    contact: {
                        companyName: holdaddress.COMPANY,
                        personName: holdaddress.CONTACT,
                        emailAddress: holdaddress.EMAIL,
                        phoneNumber: reuse.validatePhNo(holdaddress.PHONE)
                    },
                    address: {
                        streetLines: [holdaddress.ADDRESS_LINE1, holdaddress.ADDRESS_LINE2, holdaddress.ADDRESS_LINE3].filter(Boolean),
                        city: holdaddress.CITY,
                        stateOrProvinceCode: holdaddress.STATE,
                        postalCode: holdaddress.ZIPCODE,
                        countryCode: holdaddress.COUNTRY
                    }
                }
            }
        }),
        ...(SLSS?.DRY_ICE?.WEIGHT > 0 && {
            shipmentDryIceDetail: {
                packageCount: Number(SLSS.DRY_ICE.QUANTITY) || 1,
                totalWeight: {
                    units: SLSS.DRY_ICE?.WEIGHT_UNITS?.toUpperCase() || 'KG',
                    value: Number(SLSS.DRY_ICE.WEIGHT)
                }
            }
        }),

        ...(SLSS?.HOME_DELIVERY?.PREMIUM_TYPE?.trim() && {
            homeDeliveryPremiumDetail: {
                phoneNumber: {
                    areaCode: SLSS.HOME_DELIVERY?.AREA_CODE || '',
                    localNumber: reuse.validatePhNo(SLSS.HOME_DELIVERY.PHONE)
                },
                deliveryDate: SLSS.HOME_DELIVERY.DELIVERY_DATE,
                homedeliveryPremiumType: SLSS.HOME_DELIVERY?.PREMIUM_TYPE || 'APPOINTMENT'
            }
        })

    };

    // Add special service types based on conditions
    // First 3 → validate required fields properly

    if (SLSS.HOLD_AT_LOCATION) {
        shipmentSpecialServices.specialServiceTypes.push('HOLD_AT_LOCATION');
    }
    if (!isNaN(SLSS?.DRY_ICE?.WEIGHT) &&
        Number(SLSS.DRY_ICE.WEIGHT) > 0) {
        shipmentSpecialServices.specialServiceTypes.push('DRY_ICE');
    }
    if (typeof SLSS?.HOME_DELIVERY?.PREMIUM_TYPE === 'string' &&
        SLSS.HOME_DELIVERY.PREMIUM_TYPE.trim() !== '') {
        shipmentSpecialServices.specialServiceTypes.push('HOME_DELIVERY_PREMIUM');
    }


    // Remaining → accept true / "true" / "TRUE"

    if (SLSS?.EMAIL_NOTIFICATION?.EVENT_TYPE?.length)
        shipmentSpecialServices.specialServiceTypes.push('EVENT_NOTIFICATION');
    // if (isTrue(SLSS?.RESIDENTIAL_DELIVERY))
    //     shipmentSpecialServices.specialServiceTypes.push('RESIDENTIAL_DELIVERY');
    if (isTrue(SLSS?.FEDEX_ONE_RATE))
        shipmentSpecialServices.specialServiceTypes.push('FEDEX_ONE_RATE');
    if (isTrue(SLSS?.BROKER_SELECT))
        shipmentSpecialServices.specialServiceTypes.push('BROKER_SELECT_OPTION');
    if (isTrue(SLSS?.SATURDAY_PICKUP))
        shipmentSpecialServices.specialServiceTypes.push('SATURDAY_PICKUP');
    if (isTrue(SLSS?.SATURDAY_DELIVERY))
        shipmentSpecialServices.specialServiceTypes.push('SATURDAY_DELIVERY');
    if (isTrue(SLSS?.THIRD_PARTY_CONSIGNEE))
        shipmentSpecialServices.specialServiceTypes.push('THIRD_PARTY_CONSIGNEE');
    if (isTrue(SLSS?.ELECTRONIC_TRADE_DOCUMENT))
        shipmentSpecialServices.specialServiceTypes.push('ELECTRONIC_TRADE_DOCUMENTS');
    if (isTrue(SLSS?.PHARMACY_DELIVERY))
        shipmentSpecialServices.specialServiceTypes.push('PHARMACY_DELIVERY');
    if (isTrue(SLSS?.INSIDE_DELIVERY))
        shipmentSpecialServices.specialServiceTypes.push('INSIDE_DELIVERY');
    if (isTrue(SLSS?.INSIDE_PICKUP))
        shipmentSpecialServices.specialServiceTypes.push('INSIDE_PICKUP');
    return shipmentSpecialServices;
};


const createPackageSpecialServices = (PLSS, SLSS) => {
    const specialServices = {
        specialServiceTypes: [],

        ...((SLSS?.SIGNATURE_OPTION_TYPE || PLSS?.SIGNATURE_OPTION_TYPE) && {
            signatureOptionType: SignatureMap(SLSS?.SIGNATURE_OPTION_TYPE || PLSS?.SIGNATURE_OPTION_TYPE)
        }),
        ...(PLSS?.ALCOHOL?.RECIPIENT_TYPE && {
            alcoholDetail: {
                alcoholRecipientType: PLSS.ALCOHOL?.RECIPIENT_TYPE,
                shipperAgreementType: PLSS.ALCOHOL?.SHIPPER_AGREEMENT_TYPE
            }
        }),
        ...(PLSS?.DRY_ICE?.WEIGHT > 0 && {
            dryIceWeight: {
                units: PLSS.DRY_ICE.WEIGHT_UNITS?.toUpperCase() || 'KG',
                value: PLSS.DRY_ICE.WEIGHT
            }
        }),
        ...(PLSS?.BATTERY?.MATERIAL_TYPE && {
            batteryDetails: [{
                batteryPackingType: PLSS.BATTERY.PACKING_TYPE,
                batteryMaterialType: PLSS.BATTERY.MATERIAL_TYPE,
                batteryRegulatoryType: PLSS.BATTERY?.REGULATORY_TYPE
            }]
        }),
        ...(PLSS?.HAZMAT?.UNID_NUMBER && {
            dangerousGoodsDetail: {
                accessibility: PLSS.HAZMAT?.ACCESSIBILITY || "ACCESSIBLE",
                options: ["HAZARDOUS_MATERIALS"],
                cargoAircraftOnly: PLSS.HAZMAT.CARGO_AIRCRAFT,
                containers: [{
                    hazardousCommodities: [{
                        quantity: {
                            amount: PLSS.HAZMAT.QUANTITY,
                            units: PLSS.HAZMAT.UOM
                        },
                        description: {
                            packingGroup: PLSS.HAZMAT.PACKAGING_GROUP_TYPE,
                            subsidiaryClasses: [PLSS.HAZMAT.SUB_CLASS],
                            technicalName: PLSS.HAZMAT.TECHNICAL_NAME,
                            packingDetails: {
                                cargoAircraftOnly: PLSS.HAZMAT.CARGO_AIRCRAFT,
                                packingInstructions: PLSS.HAZMAT.PACKAGING_INSTRUCTION_CODE
                            },
                            id: PLSS.HAZMAT.UNID_NUMBER,
                            properShippingName: PLSS.HAZMAT.PROPER_SHIPPING_NAME,
                            hazardClass: PLSS.HAZMAT.HAZ_CLASS
                        }
                    }],
                    numberOfContainers: Number(PLSS.HAZMAT.CONTAINERS_QUANTITY),
                    containerType: PLSS.HAZMAT.CONTAINER_TYPE
                }],
                packaging: {
                    count: Number(PLSS.HAZMAT.QUANTITY),
                    units: PLSS.HAZMAT.UOM
                },
                signatory: {
                    contactName: PLSS.HAZMAT.EMERGENCY_CONTACT,
                    title: "Tester",
                    place: "Test Place"
                },
                emergencyContactNumber: reuse.validatePhNo(PLSS.HAZMAT.EMERGENCY_PHONE)
            }
        })
    };
    const isPriorityAlert = isTrue(PLSS?.PRIORITY_ALERT) || isTrue(SLSS?.PRIORITY_ALERT);
    const isPriorityAlertPlus = isTrue(PLSS?.PRIORITY_ALERT_PLUS) || isTrue(SLSS?.PRIORITY_ALERT_PLUS);
    const priorityAlertPlusContent = PLSS?.PRIORITY_ALERT_PLUS_CONTENT || SLSS?.PRIORITY_ALERT_PLUS_CONTENT || '';
    // Build object
    const priorityAlertDetail = isPriorityAlertPlus
        ? {
            enhancementTypes: ['PRIORITY_ALERT_PLUS'],
            content: [priorityAlertPlusContent]
        }
        : isPriorityAlert
            ? {}
            : undefined;
    // Assign to request
    if (priorityAlertDetail) {
        specialServices.priorityAlertDetail = priorityAlertDetail;
    }

    // Push service type
    if (isPriorityAlert || isPriorityAlertPlus) {
        specialServices.specialServiceTypes.push('PRIORITY_ALERT');
    }
    // Add special service types based on conditions
    if (SLSS?.SIGNATURE_OPTION_TYPE || PLSS?.SIGNATURE_OPTION_TYPE) specialServices.specialServiceTypes.push('SIGNATURE_OPTION');
    if (PLSS?.ALCOHOL?.RECIPIENT_TYPE) specialServices.specialServiceTypes.push('ALCOHOL');
    if (PLSS?.DRY_ICE?.WEIGHT > 0) specialServices.specialServiceTypes.push('DRY_ICE');
    if (PLSS?.BATTERY?.MATERIAL_TYPE) specialServices.specialServiceTypes.push('BATTERY');
    if (isTrue(PLSS?.SATURDAY_PICKUP)) specialServices.specialServiceTypes.push('SATURDAY_PICKUP');
    if (PLSS?.HAZMAT?.UNID_NUMBER) specialServices.specialServiceTypes.push('DANGEROUS_GOODS');
    return specialServices;
};
function SignatureMap(name) {
    if (name.toUpperCase().includes('INDIRECT')) {
        return 'INDIRECT';
    } else if (name.toUpperCase().includes('DIRECT')) {
        return 'DIRECT';
    } else if (name.toUpperCase().includes('ADULT')) {
        return 'ADULT';
    } else if (name.toUpperCase().includes('NO')) {
        return 'NO_SIGNATURE_REQUIRED';
    } else {
        return name;
    }
}



const isTrue = (val) =>
    val === true ||
    (typeof val === 'string' && ['true', 'x', 'yes', '1'].includes(val.toLowerCase().trim()));