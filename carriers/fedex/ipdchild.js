const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getCSPFedexToken } = require('../../Reuse/fedex_csptoken_manager.js');
require('dotenv').config();
const { buildFinalResponse } = require('../../Reuse/responseBuilder');
const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

module.exports = async (request) => {

    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER, INTERNATIONAL_DETAILS } = request;
    let SHIPFROM = request.SHIPFROM?.ZIPCODE ? request.SHIPFROM : SHIPPER;
    let FINALRESPONSE = buildFinalResponse(request);
    const currency = HEADER_INFO.CURRENCY || 'USD';

    const tokenurl = CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;
    const shipurl = CARRIER_DETAILS.CHILDURL || process.env.FEDEX_IPD_CHILD;
    const CSPuserId = CARRIER_DETAILS.CSP_USER || process.env.FEDEX_CSPUSER;
    const CSPpassword = CARRIER_DETAILS.CSP_PASSWORD || process.env.FEDEX_CSPPASSWORD;
    try {
        const token = await getCSPFedexToken(
            tokenurl, CSPuserId, CSPpassword,
            CARRIER_DETAILS.USERID,
            CARRIER_DETAILS.PASSWORD, CARRIER_DETAILS.SHIPPING_ACCOUNT
        );

        let masterdata = {
            shipDate: (HEADER_INFO?.SHIP_DATE || new Date().toISOString()).split('T')[0],
            index: HEADER_INFO.MASTER_TRACKING_NUMBER
        }
        let childReq = buildIPDChildShipment(request, masterdata, currency)

        console.log("FEDEX IPD MASTER REQUEST:", JSON.stringify(childReq, null, 2));

        const sres = await axiosInstance.post(shipurl, childReq, {
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${token}`
            }
        });

        // console.log("FEDEX RESPONSE:", JSON.stringify(sres.data, null, 2));
        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Shipped';
        let transShip = sres.data.output.transactionShipments[0];
        if (transShip.serviceName) {
            FINALRESPONSE.SERVICE_NAME = transShip.serviceName;
            FINALRESPONSE.SERVICE_CODE = transShip?.completedShipmentDetail?.shipmentConsolidationdetail?.type;
        }
        const packageCount = PACKAGES?.length || 0;
        try {
            transShip?.pieceResponses
                ?.slice(0, packageCount)
                ?.forEach((piece) => {
                    FINALRESPONSE.PACKAGES.push({ TRACKING_NUMBER: generateTrackingNumber() }); //piece.trackingNumber

                    for (const doc of piece.packageDocuments || []) {
                        try {
                            let docName = '';
                            let contentType = 'LABEL';
                            let encodedLabel = doc.encodedLabel;
                            docName = `${FINALRESPONSE.PACKAGES[0].TRACKING_NUMBER}.${doc.docType}`;
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

        return FINALRESPONSE;

    } catch (ex) {
        console.error("FedEx IPD Error:", ex?.response?.data || ex.message);
        FINALRESPONSE.STATUS = 'Error';
        let errordesc = reuse.handleShipErrorRes(ex);
        FINALRESPONSE.ERRORS = errordesc;
        return FINALRESPONSE;

    }
};
const buildIPDChildShipment = (data, master, currency) => {

    const {
        HEADER_INFO,
        SHIPPER,
        SHIPTO,
        PACKAGES,
        INTERNATIONAL_DETAILS,
        CARRIER_DETAILS
    } = data;
    const { weightUnit, dimUnit } = getUnits(PACKAGES?.[0]?.WEIGHT_UNITS);
    let SHIPFROM = data.SHIPFROM?.ZIPCODE ? data.SHIPFROM : SHIPPER;
    let ALTERNATE = data.ALTERNATE_ADDRESS?.ZIPCODE ? data.ALTERNATE_ADDRESS : SHIPTO;
    let totCustValue = 0;

    return {
        accountNumber: {
            value: CARRIER_DETAILS.SHIPPING_ACCOUNT
        },

        openShipmentAction: "CONFIRM",
        labelResponseOptions: "LABEL",

        consolidationKey: {
            date: master.shipDate,                 // from master response/request
            index: master.index,                   // consolidationIndex
            type: "INTERNATIONAL_PRIORITY_DISTRIBUTION"
        },

        requestedShipment: {
            serviceType: "INTERNATIONAL_PRIORITY_DISTRIBUTION",
            shipper: buildAddressStrict(SHIPPER),
            origin: buildAddressStrict(SHIPFROM),
            recipients: [
                buildAddressStrict(SHIPTO, 'recipients')
            ],
            labelSpecification: {
                labelFormatType: "COMMON2D",
                labelStockType: "PAPER_4X6",
                imageType: "PDF",
                printedLabelOrigin: {
                    address: {
                        // BUGFIX: was [ADDRESS_LINE1, ADDRESS_LINE1] (duplicate)
                        streetLines: [
                            ALTERNATE.ADDRESS_LINE1,
                            ALTERNATE.ADDRESS_LINE2,
                            ALTERNATE.ADDRESS_LINE3
                        ].filter(Boolean),
                        city: ALTERNATE.CITY,
                        postalCode: ALTERNATE.ZIPCODE,
                        stateOrProvinceCode: ALTERNATE.STATE,
                        countryCode: ALTERNATE.COUNTRY
                    },
                    phoneExtension: "010",
                    contact: {
                        companyName: ALTERNATE.COMPANY,
                        personName: ALTERNATE.CONTACT,
                        emailAddress: ALTERNATE.CONTACT,
                        phoneNumber: ALTERNATE.PHONE
                    }
                }
            },

            customerReferences: [
                {
                    customerReferenceType: "CUSTOMER_REFERENCE",
                    value: HEADER_INFO?.CUSTOMER_REFERENCE || "REF"
                },
                {
                    customerReferenceType: "INVOICE_NUMBER",
                    value: HEADER_INFO?.INVOICE_NUMBER || "REF"
                }
            ],
            requestedPackageLineItems: PACKAGES.map((element, index) => {
                // requestedPackageLineItems: PACKAGES.map((element, index) => {
                const packtotalValue = Number(
                    element.ITEM_INFO?.reduce(
                        (sum, item) => sum + (item.QUANTITY * item.UNIT_COST), 0
                    ) || 0
                );
                totCustValue = totCustValue + packtotalValue;
                const xpackage = {
                    groupPackageCount: 1,
                    declaredValue: {
                        amount: packtotalValue,
                        currency: currency
                    },
                    weight: {
                        units: weightUnit,
                        value: Number(element.WEIGHT)
                    },
                    commodities: element.ITEM_INFO.slice(0, 1).map(item => ({
                        unitPrice: {
                            amount: Number(item.UNIT_COST),
                            currency: currency
                        },
                        numberOfPieces: Number(item.PIECES),
                        quantity: Number(item.QUANTITY),
                        quantityUnits: item.UOM || "PC",
                        customsValue: {
                            amount: Number(item.QUANTITY * item.UNIT_COST),
                            currency: currency
                        },
                        countryOfManufacture: item.COUNTRY_OF_MFR || SHIPPER.COUNTRY,
                        harmonizedCode: item.HTS_CODE,
                        description: item.DESCRIPTION,
                        weight: {
                            units: weightUnit,
                            value: Number(item.ITEM_WEIGHT || element.WEIGHT)
                        },
                        commodityId: item.PRODUCT_NO

                    }))
                }

                return xpackage;

            }),



            customsClearanceDetail: {
                dutiesPayment: {
                    payor: {
                        responsibleParty: {
                            address: {
                                countryCode: SHIPTO.COUNTRY
                            },
                            accountNumber: {
                                value: INTERNATIONAL_DETAILS?.DUTIES_ACCOUNT || CARRIER_DETAILS?.BILLING_ACCOUNT || CARRIER_DETAILS?.SHIPPING_ACCOUNT
                            }
                        }
                    },
                    paymentType: INTERNATIONAL_DETAILS?.DUTIES_PAYMENT_TYPE?.toUpperCase() || 'THIRD_PARTY',
                    billingDetails: {
                        accountNumber: INTERNATIONAL_DETAILS?.DUTIES_ACCOUNT || CARRIER_DETAILS?.BILLING_ACCOUNT || CARRIER_DETAILS?.SHIPPING_ACCOUNT
                    }
                },

                totalCustomsValue: {
                    amount: totCustValue,
                    currency: currency
                },

                isDocumentOnly: "false"
            },

            shipTimestamp: HEADER_INFO.SHIP_DATE,
            pickupType: "USE_SCHEDULED_PICKUP",
            shippingChargesPayment: {
                payor: {
                    responsibleParty: {
                        address: {
                            countryCode: SHIPPER.COUNTRY
                        },
                        accountNumber: {
                            value: CARRIER_DETAILS.SHIPPING_ACCOUNT
                        }
                    }
                },
                paymentType: "SENDER"
            },
            specialServicesRequested: {
                specialServiceTypes: [
                    "INTERNATIONAL_CONTROLLED_EXPORT_SERVICE"
                ],
                internationalControlledExportDetail: {
                    internationalControlledExportType: "DEA_486",
                    licenseOrPermitExpirationDate: "2026-02-28",
                    licenseOrPermitNumber: "123"
                }
            },
            processingOption: {
                options: [
                    "PACKAGE_LEVEL_COMMODITIES"
                ]
            },

            packagingType: "YOUR_PACKAGING"
        }
    };
};


function generateTrackingNumber() {
    const now = new Date();

    const MM = String(now.getMonth() + 1).padStart(2, '0'); // Month
    const DD = String(now.getDate()).padStart(2, '0');      // Day
    const HH = String(now.getHours()).padStart(2, '0');     // Hours
    const mm = String(now.getMinutes()).padStart(2, '0');   // Minutes
    const SS = String(now.getSeconds()).padStart(2, '0');   // Seconds

    const trackingNumber = `79${MM}${DD}${HH}${mm}${SS}`;

    return trackingNumber;
}

const getUnits = (u) =>
    (u || '').toUpperCase().startsWith('K') ? { weightUnit: 'KG', dimUnit: 'CM' } : { weightUnit: 'LB', dimUnit: 'IN' };


const buildAddressStrict = (data, type) => ({
    address: {
        // BUGFIX: was [ADDRESS_LINE1, ADDRESS_LINE1] (duplicate)
        streetLines: [
            data.ADDRESS_LINE1,
            data.ADDRESS_LINE2,
            data.ADDRESS_LINE3
        ].filter(Boolean),
        city: data.CITY,
        ...(type === 'recipients' && { stateOrProvinceCode: data.STATE }),
        postalCode: data.ZIPCODE,
        countryCode: data.COUNTRY,
        residential: "false"
    },
    contact: {
        companyName: data.COMPANY,
        personName: data.CONTACT,
        phoneNumber: data.PHONE
    }
});