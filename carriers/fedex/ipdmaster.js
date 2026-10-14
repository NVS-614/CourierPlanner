const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getCSPFedexToken } = require('../../Reuse/fedex_csptoken_manager.js');
require('dotenv').config();
const { buildFinalResponse } = require('../../Reuse/responseBuilder.js');
const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

module.exports = async (request, response) => {
    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER, INTERNATIONAL_DETAILS } = request;

    const tokenurl = CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;
    // Note: original code used `MASTErURL` (typo). Honour both the typo'd and corrected
    // names to avoid breaking any caller already passing the typo.
    const masterurl = CARRIER_DETAILS.MASTERURL || CARRIER_DETAILS.MASTErURL || process.env.FEDEX_IPD_MASTER;
    const CSPuserId = CARRIER_DETAILS.CSP_USER || process.env.FEDEX_CSPUSER;
    const CSPpassword = CARRIER_DETAILS.CSP_PASSWORD || process.env.FEDEX_CSPPASSWORD;

    let SHIPFROM = request.SHIPFROM?.ZIPCODE ? request.SHIPFROM : SHIPPER;
    let SOLDTO = request.SOLDTO?.ZIPCODE ? request.SOLDTO : SHIPTO;
    let FINALRESPONSE = buildFinalResponse(request);
    const currency = INTERNATIONAL_DETAILS?.CURRENCY || HEADER_INFO?.CURRENCY || 'USD';
    const { weightUnit, dimUnit } = getUnits(HEADER_INFO?.WEIGHT_UNITS || PACKAGES?.[0]?.WEIGHT_UNITS);

    try {
        const token = await getCSPFedexToken(
            tokenurl, CSPuserId, CSPpassword,
            CARRIER_DETAILS.USERID,
            CARRIER_DETAILS.PASSWORD, CARRIER_DETAILS.SHIPPING_ACCOUNT
        );
        const totalValue = Number(
            INTERNATIONAL_DETAILS?.ITEM_INFO?.reduce(
                (sum, item) => sum + (item.QUANTITY * item.UNIT_COST),
                0
            ) || 0
        );

        const masterReq = {
            accountNumber: {
                value: CARRIER_DETAILS.SHIPPING_ACCOUNT
            },
            requestedConsolidation: {
                consolidationType: 'INTERNATIONAL_PRIORITY_DISTRIBUTION',

                // shipDate: HEADER_INFO.SHIP_DATE.split('T')[0],

                shipper: buildAddress(SHIPPER, '123456789'),

                origin: buildAddress(SHIPFROM),

                soldTo: {
                    ...buildAddress(SOLDTO),
                    accountNumber: {
                        value: CARRIER_DETAILS.SHIPPING_ACCOUNT
                    }
                },

                consolidationDataSources: [
                    {
                        consolidationDataType: "TOTAL_FREIGHT_CHARGES",
                        consolidationDataSourceType: "ACCUMULATED"
                    }
                ],

                shippingChargesPayment: {
                    paymentType: /third|3rd/i.test(CARRIER_DETAILS.PAYMENT_TYPE || '')
                        ? 'THIRD_PARTY'
                        : (CARRIER_DETAILS.PAYMENT_TYPE || 'SENDER').toUpperCase(),
                    payor: {
                        responsibleParty: {
                            address: {
                                countryCode: CARRIER_DETAILS?.BILLING_COUNTRY || SHIPPER.COUNTRY,
                                // postalCode: CARRIER_DETAILS?.BILLING_ZIPCODE
                            },
                            accountNumber: {
                                value: CARRIER_DETAILS.BILLING_ACCOUNT || CARRIER_DETAILS.SHIPPING_ACCOUNT
                            }
                        }
                    }

                },

                customsClearanceDetail: {
                    documentContent: INTERNATIONAL_DETAILS?.DOCUMENT_CONTENT || "NON_DOCUMENTS",

                    customsValue: {
                        amount: totalValue,
                        currency: currency
                    },

                    recipientCustomsId: {
                        type: "COMPANY",
                        value: "125"
                    },

                    dutiesPayment: {
                        paymentType: INTERNATIONAL_DETAILS?.DUTIES_PAYMENT_TYPE?.toUpperCase() || 'RECIPIENT',
                        payor: {
                            responsibleParty: {
                                address: {
                                    countryCode: CARRIER_DETAILS?.BILLING_COUNTRY || SHIPPER.COUNTRY
                                },
                                accountNumber: {
                                    value: INTERNATIONAL_DETAILS?.DUTIES_ACCOUNT || CARRIER_DETAILS?.BILLING_ACCOUNT || CARRIER_DETAILS?.SHIPPING_ACCOUNT
                                }
                            }
                        },
                        billingDetails: {
                            accountNumber: INTERNATIONAL_DETAILS?.DUTIES_ACCOUNT || CARRIER_DETAILS?.BILLING_ACCOUNT || CARRIER_DETAILS?.SHIPPING_ACCOUNT
                        }
                    },

                    ...(INTERNATIONAL_DETAILS?.IMPORTER_ADDRESS?.PHONE && {
                        importerOfRecord: {
                            address: buildAddress(INTERNATIONAL_DETAILS.IMPORTER_ADDRESS).address,
                            contact: buildAddress(INTERNATIONAL_DETAILS.IMPORTER_ADDRESS).contact
                        }
                    })
                },

                internationalDistributionDetail: {
                    dropOffType: HEADER_INFO?.DROPOFF_TYPE || "DROP_BOX",
                    totalDimensions: createDimensions(HEADER_INFO?.TOTAL_DIMENSION, dimUnit),
                    totalInsuredValue: {
                        amount: Number(INTERNATIONAL_DETAILS?.INSURANCE_AMOUNT || 1),
                        currency: INTERNATIONAL_DETAILS?.INSURANCE_CURRENCY || currency
                    },
                    unitSystem: "ENGLISH",
                    declarationCurrencies: [
                        {
                            currency: currency,
                            value: "CUSTOMS_VALUE"
                        }
                    ],
                    clearanceFacilityLocationId: HEADER_INFO.CLEARANCE_FACILITY_LOCATIONID || "MEMI"
                },

                labelSpecification: {
                    labelFormatType: 'COMMON2D',
                    // labelOrder: 'SHIPPING_LABEL_FIRST',
                    imageType: CARRIER_DETAILS.LABELTYPE || 'PNG',
                    labelStockType: 'PAPER_4X6'
                },

                specialServicesRequested: {
                    specialServiceTypes: [
                        "INTERNATIONAL_CONTROLLED_EXPORT_SERVICE"
                    ],
                    internationalControlledExportDetail: {
                        type: "DEA_486",
                        licenseOrPermitExpirationDate: "2026-02-18",
                        licenseOrPermitNumber: "123"
                    }
                },

                consolidationDocumentSpecification: buildConsolidationdoc(request.IPD_DOCS)
            },
            consolidationIndex: ""
        };

        console.log("FEDEX IPD MASTER REQUEST:", JSON.stringify(masterReq, null, 2));

        const sres = await axiosInstance.post(masterurl, masterReq, {
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${token}`
            }
        });

        console.log("FEDEX RESPONSE:", JSON.stringify(sres.data, null, 2));
        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Master Created';
        let transShip = sres.data.output;
        if (transShip.consolidationKey) {
            FINALRESPONSE.SERVICE_CODE = transShip.consolidationKey.type;
            FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = generateTrackingNumber(); // transShip.trackingId.trackingNumber;
            FINALRESPONSE.HEADER_INFO.INDEX = transShip.consolidationKey.index;
            FINALRESPONSE.HEADER_INFO.SHIP_DATE = transShip.consolidationKey.date;
        }
        return FINALRESPONSE;

    } catch (ex) {
        console.error("FedEx IPD Error:", ex?.response?.data || ex.message);
        FINALRESPONSE.STATUS = 'Error';
        let errordesc = reuse.handleShipErrorRes(ex);
        FINALRESPONSE.ERRORS = errordesc;
        return FINALRESPONSE;
    }
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

const getUnits = (u) =>
    (u || '').toUpperCase().startsWith('K') ? { weightUnit: 'KG', dimUnit: 'CM' } : { weightUnit: 'LB', dimUnit: 'IN' };

const buildConsolidationdoc = (DOCS = []) => {
    const documentTypes = [];
    const specification = {
        consolidationDocumentTypes: documentTypes,
    };

    const format = {
        docType: "PDF",
        stockType: "PAPER_LETTER"
    };

    const docConfig = {
        CONSOLIDATED_COMMERCIAL_INVOICE: () => {
            specification.consolidatedCommercialInvoiceDetail = { format };
        },
        CUSTOMS_PACKING_LIST: () => {
            specification.customsPackingListDetail = { format };
        },
        CRN_REPORT: () => {
            specification.crnReportDetail = { format };
        },
        COMMODITIES_BY_TRACKING_NUMBER_REPORT: () => {
            specification.commoditiesByTrackingNumberDetail = { format };
        },
        CONDENSED_CRN_REPORT: () => {
            specification.condensedCrnReportDetail = { format };
        },
        CONSOLIDATED_CUSTOMS_LINEHAUL_REPORT: () => {
            specification.consolidatedCustomsLinehaulReportDetail = { format };
        },
        CONSOLIDATED_PARTY_REPORT: () => {
            specification.consolidatedPartyReportDetail = { format };
        },
        CONSOLIDATED_SOLD_TO_SUMMARY_REPORT: () => {
            specification.consolidatedSoldToSummaryReportDetail = { format };
        },
        CUSTOM_CONSOLIDATION_DOCUMENT: () => {
            specification.customDocumentDetails = [format];
        }
    };

    DOCS.forEach(doc => {
        if (docConfig[doc]) {
            documentTypes.push(doc);
            docConfig[doc]();
        }
    });

    return specification;
};

const buildAddress = (data, TAXID) => ({
    address: {
        city: data.CITY,
        stateOrProvinceCode: data.STATE,
        countryCode: data.COUNTRY,
        postalCode: data.ZIPCODE,
        // BUGFIX: was [ADDRESS_LINE1, ADDRESS_LINE1] (duplicate) — now includes line2 and line3
        streetLines: [
            data.ADDRESS_LINE1,
            data.ADDRESS_LINE2,
            data.ADDRESS_LINE3
        ].filter(Boolean),
        residential: (data?.ADDRESS_TYPE || data?.AddressType)?.toUpperCase() === "RESIDENTIAL" ? "true" : "false"
    },
    contact: {
        companyName: data.COMPANY,
        personName: data.CONTACT,
        // emailAddress: data.EMAIL,
        phoneNumber: reuse.validatePhNo(data.PHONE)
    },
    ...(TAXID && {
        tins: [
            {
                tinType: "PERSONAL_NATIONAL",
                number: TAXID
            }
        ]
    })
});