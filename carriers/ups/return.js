// carriers/fedex/return.js
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getupsToken } = require('../../Reuse/ups_token_manager.js');
const Getcode = require('../../Reuse/ServicesandCodes.js');
const pLimit = require("p-limit").default;

const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

module.exports = async (request) => {
    if (typeof request === 'string') {
        request = JSON.parse(request);
    }
    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER, INTERNATIONAL_DETAILS } = request;

    let FINALRESPONSE = {
        STATUS: '',
        TRACKING_STATUS: '',
        PACKAGES: [],
        CHARGE_DETAILS: [],
        SHIPPING_DOCUMENTS: [],
        ERRORS: [],
        HEADER_INFO
    };

    const { weightUnit, dimUnit } = getUnits(PACKAGES[0].WEIGHT_UNITS);

    let SHIPFROM = request.SHIPFROM ?? SHIPPER;
    let SOLDTO = request.SOLDTO ?? SHIPTO;

    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES;
    const shipperCountry = SHIPPER.COUNTRY?.toUpperCase();
    const shipToCountry = SHIPTO.COUNTRY?.toUpperCase();

    const isDomestic =
        shipperCountry === shipToCountry ||
        (shipperCountry === 'US' && shipToCountry === 'PR') ||
        (shipperCountry === 'PR' && shipToCountry === 'US');
    let strDCISType = ''
    if (!isDomestic && SLSS?.SIGNATURE_OPTION_TYPE) {
        strDCISType = SLSS.SIGNATURE_OPTION_TYPE === 'ADULT' ? '2' : '1'
    }

    const tokenurl = CARRIER_DETAILS.TOKENURL || process.env.UPS_TOKEN;
    const shipurl = CARRIER_DETAILS.SHIPURL || process.env.UPS_RETURN || process.env.UPS_SHIP;
    const shipDateStr = HEADER_INFO?.SHIP_DATE || new Date().toISOString();
    const [date, time] = shipDateStr.split('T')
    const invdate = (date || '').replace(/-/g, '');
    const token = await getupsToken(tokenurl, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD, CARRIER_DETAILS.SHIPPING_ACCOUNT);



    try {

        const limit = pLimit(5); // max 5 parallel shipments
        let totalCharges = {};

        const service = CARRIER_DETAILS?.SERVICE_CODE || CARRIER_DETAILS?.SERVICE_NAME;
        /* ---------- CREATE PACKAGE REQUEST FUNCTION ---------- */
        const shipPackage = async (element, index) => {

            const shiprequest = {
                ShipmentRequest: {
                    Request: {
                        SubVersion: '1801',
                        RequestOption: 'nonvalidate',
                        TransactionReference: {
                            CustomerContext: 'CustomerContext'
                        }
                    },

                    Shipment: {
                        Description: reuse.getOrDefault(PACKAGES[0]?.DESCRIPTION, 'package'),
                        ReturnService : {
                            Code: SLSS?.RETURN_SHIP?.RETURN_TYPE || '9'
                        },
                        Shipper: {
                            Name: SHIPPER.COMPANY,
                            AttentionName: SHIPPER.CONTACT,
                            Phone: buildPhone(SHIPPER.PHONE),
                            ShipperNumber: CARRIER_DETAILS.SHIPPING_ACCOUNT,
                            Address: buildAddress(SHIPPER)
                        },

                        ShipTo: {
                            Name: SHIPTO.COMPANY,
                            AttentionName: SHIPTO.CONTACT,
                            Phone: buildPhone(SHIPTO.PHONE),
                            Address: buildAddress(SHIPTO)
                        },

                        ShipFrom: {
                            Name: SHIPFROM.COMPANY,
                            Address: buildAddress(SHIPFROM)
                        },

                        ShipmentRatingOptions: {
                            NegotiatedRatesIndicator: 'X',
                            ...(SLSS?.GroundFreightPricing && { FRSShipmentIndicator: 'X' })
                        },

                        Service: {
                            Code: service,
                            Description: service
                        },

                        ShipmentServiceOptions: {}
                    }
                }
            };
            const shipment = shiprequest.ShipmentRequest.Shipment;

            if (SHIPPER.COUNTRY !== SHIPTO.COUNTRY) {
                shipment.InvoiceLineTotal = {
                    CurrencyCode: INTERNATIONAL_DETAILS?.CUSTOMS_VALUE_CURRENCY || currency,
                    MonetaryValue: String(INTERNATIONAL_DETAILS?.CUSTOMS_VALUE ?? 1)
                }
            }
            shipment.ShipmentServiceOptions = buildShipmentServiceOptions(SLSS, SHIPPER, strDCISType);
            if (SHIPPER.COUNTRY !== SHIPTO.COUNTRY) {
                shipment.ShipmentServiceOptions.InternationalForms =
                    buildInternationalForms({ SLSS, SHIPPER, SOLDTO, INTERNATIONAL_DETAILS, currency, invdate });
            }
            if (SLSS?.GroundFreightPricing) {
                shipment.FRSPaymentInformation = {
                    Type: { Code: CARRIER_DETAILS.PAYMENT_TYPE },
                    AccountNumber: CARRIER_DETAILS.SHIPPING_ACCOUNT,
                    Address: { PostalCode: '', CountryCode: '' }
                };
            } else {
                shipment.PaymentInformation = {
                    ShipmentCharge: { Type: '01' }
                };

                const charge = shipment.PaymentInformation.ShipmentCharge;

                if (/third|3rd/i.test(CARRIER_DETAILS.PAYMENT_TYPE)) {
                    charge.BillThirdParty = {
                        AccountNumber: CARRIER_DETAILS?.BILLING_ACCOUNT,
                        Address: {
                            PostalCode: CARRIER_DETAILS.BILLING_ZIPCODE || CARRIER_DETAILS.BillingZipCode,
                            CountryCode: CARRIER_DETAILS?.BILLING_COUNTRY
                        }
                    };
                } else if (CARRIER_DETAILS.PAYMENT_TYPE.toUpperCase() === 'RECIPIENT') {
                    charge.BillReceiver = {
                        AccountNumber: CARRIER_DETAILS?.BILLING_ACCOUNT,
                        Address: { PostalCode: CARRIER_DETAILS.BILLING_ZIPCODE || CARRIER_DETAILS.BillingZipCode }
                    };
                } else if (/Consignee/i.test(CARRIER_DETAILS.PAYMENT_TYPE)) {
                    charge.ConsigneeBilledIndicator = '';
                } else {
                    charge.BillShipper = {
                        AccountNumber: CARRIER_DETAILS.SHIPPING_ACCOUNT
                    };
                }
            }

            /* PACKAGE */
            shipment.Package = [];

            const PLSS = element?.PACKAGE_LVL_SPECIAL_SERVICES;
            shipment.Package = [{
                Description: reuse.getOrDefault(element.DESCRIPTION, 'package'),
                Packaging: { Code: '02', Description: 'SimpleRateDPackaging' },
                PackageWeight: {
                    UnitOfMeasurement: { Code: weightUnit },
                    Weight: String(element.WEIGHT)
                },
                ...buildDimensions(element.DIMENSION, dimUnit),

                PackageServiceOptions: buildPackageServiceOptions(PLSS, isDomestic),
            }];

            shiprequest.ShipmentRequest.LabelSpecification = {
                LabelImageFormat: { Code: CARRIER_DETAILS.LABELTYPE || 'GIF' },
                HTTPUserAgent: 'Mozilla/4.5',
                ...(CARRIER_DETAILS.LABELTYPE === 'ZPL' && {
                    LabelStockSize: { Height: '6', Width: '4' }
                })
            };

            console.log('UPS Ship Request is ..:');
            console.log(JSON.stringify(shiprequest))

            const res = await axiosInstance.post(
                shipurl,
                shiprequest,
                {
                    headers: {
                        'content-type': 'application/json',
                        'authorization': `Bearer ${token}`,//tdata.data.access_token,
                        'transId': '1' + HEADER_INFO.DOCUMENT_NUMBER,
                        'transactionSrc': 'testing'
                    }
                }
            );

            return res.data.ShipmentResponse.ShipmentResults;
        };

        /* ---------- RUN UPS CALLS IN PARALLEL ---------- */

        const responses = await Promise.all(
            PACKAGES.map((pkg, i) => limit(() => shipPackage(pkg, i)))
        );

        /* ---------- PROCESS RESPONSES ---------- */

        for (const shipment of responses) {
            const Currencycode = shipment?.ShipmentCharges?.TotalCharges?.CurrencyCode;
            const publishedFreight =
                shipment?.ShipmentCharges?.TotalCharges?.MonetaryValue || 0;
            const discountFreight =
                shipment?.NegotiatedRateCharges?.TotalCharge?.MonetaryValue ||
                publishedFreight;
            /* MERGE FREIGHT */
            totalCharges["Published Freight"] =
                (totalCharges["Published Freight"] || 0) + Number(publishedFreight);
            totalCharges["Discounted Freight"] =
                (totalCharges["Discounted Freight"] || 0) + Number(discountFreight);
            /* MERGE SHIPMENT LEVEL ACCESSORIALS */
            const itemizedCharges = shipment?.ShipmentCharges?.ItemizedCharges || [];
            itemizedCharges.forEach(({ Code, MonetaryValue }) => {
                const desc = Getcode.getUPSAccessorialName(Code);
                totalCharges[desc] =
                    (totalCharges[desc] || 0) + Number(MonetaryValue);
            });
            /* PACKAGE PROCESSING */
            for (piece of shipment.PackageResults) {
                FINALRESPONSE.PACKAGES.push({
                    RETURN_TRACKING_NUMBER: piece.TrackingNumber
                });
                if (piece.USPSPICNumber) {
                    FINALRESPONSE.PACKAGES.push({
                        USPS_RETURN_TRACKING_NUMBER: piece.USPSPICNumber
                    });
                }
                /* PACKAGE CHARGE_DETAILS */
                const itemizedCharges = piece.ItemizedCharges || [];

                itemizedCharges.forEach(surc => {
                    const desc = Getcode.getUPSAccessorialName(surc.Code);
                    totalCharges[desc] =
                        (totalCharges[desc] || 0) + Number(surc.MonetaryValue);
                });
                /* LABEL PROCESSING */
                try {
                    let docType =
                        piece.ShippingLabel.ImageFormat.Code === 'GIF'
                            ? 'PNG'
                            : piece.ShippingLabel.ImageFormat.Code;

                    let docName = `${piece.TrackingNumber}.${docType}`;
                    let encodedLabel = '';
                    if (docType === 'ZPL') {
                        const buffer = Buffer.from(
                            piece.ShippingLabel.GraphicImage,
                            'base64'
                        );
                        const zplString = buffer.toString('utf-8');
                        encodedLabel = zplString.replace('^POI', '');
                    } else {
                        try {
                            const rotatedBuffer =
                                await reuse.Rotatebase64Data(
                                    piece.ShippingLabel.GraphicImage
                                );
                            encodedLabel = rotatedBuffer.toString('base64');
                        } catch (error) {
                            encodedLabel = piece.ShippingLabel.GraphicImage;
                        }
                    }

                    const formatDoc = reuse.formatShipDoc(
                        'UPS',
                        'Label',
                        1,
                        docName,
                        encodedLabel,
                        docType
                    );

                    FINALRESPONSE.SHIPPING_DOCUMENTS.push(formatDoc);

                } catch (ex) {
                    console.log('rotate label ', ex.message);
                }
            }
        }

        /* ---------- BUILD FINAL CHARGES ---------- */

        Object.keys(totalCharges).forEach(key => {

            FINALRESPONSE.CHARGE_DETAILS.push(
                reuse.ShipRateRes(key, totalCharges[key], 'USD')
            );

        });

        /* ---------- FINAL STATUS ---------- */

        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Shipped';

        return FINALRESPONSE;
    }
    catch (ex) {
        console.error("FedEx Ship Error:", ex?.response?.data || ex.message);
        FINALRESPONSE.STATUS = 'Error';
        FINALRESPONSE.ERRORS = reuse.handleShipErrorRes(ex);
        return FINALRESPONSE;
    }
};



const getUnits = (w) => ({
    weightUnit: w?.toUpperCase().startsWith('K') ? 'KGS' : 'LBS',
    dimUnit: w?.toUpperCase().startsWith('K') ? 'CM' : 'IN'
});
const buildAddress = (obj) => ({
    AddressLine: [obj.ADDRESS_LINE1, obj.ADDRESS_LINE2, obj.ADDRESS_LINE3]
        .filter(Boolean)
        .map(l => l.substring(0, 35)),
    City: obj.CITY,
    StateProvinceCode: obj.STATE,
    CountryCode: obj.COUNTRY,
    PostalCode: obj.ZIPCODE
});

const buildPhone = (phone) => ({
    Number: reuse.validatePhNo(phone)
});
const buildShipmentServiceOptions = (SLSS, SHIPPER, strDCISType) => {
    const options = {};

    if (SLSS?.SATURDAY_DELIVERY) options.SATURDAY_DELIVERYIndicator = '';
    if (SLSS?.SATURDAY_PICKUP) options.SaturdayPickupIndicator = '';
    if (SLSS?.HOLD_AT_LOCATION) options.HoldForPickupIndicator = '';
    if (SLSS?.RemoveCommercialInvoice) options.CommercialInvoiceRemovalIndicator = '';
    if (SLSS?.NEUTRAL_DELIVERY) options.UPScarbonneutralIndicator = '';
    if (SLSS?.LIFT_GATE_PICKUP) options.LiftGateForPickUpIndicator = '';
    if (SLSS?.LIFT_GATE_DELIVERY) options.LiftGateForDeliveryIndicator = '';
    if (SLSS?.DROPOFF_AT_FACILITY) options.DropoffAtUPSFacilityIndicator = '';
    if (SLSS?.EXCHANGE_FORWARD_SHIPMENT) options.ExchangeForwardIndicator = '';

    if (strDCISType) {
        options.DeliveryConfirmation = {
            DCISType: strDCISType
        };
    }

    if (SLSS?.COD?.AMOUNT) {
        options.COD = {
            CODFundsCode: ['CASH'].includes(SLSS.COD?.COLLECTION_TYPE?.toUpperCase()) ? '1' : '9',
            CODAmount: {
                CurrencyCode: SLSS.COD.CURRENCY.toUpperCase(),
                MonetaryValue: SLSS.COD.AMOUNT
            }
        };
    }

    if (SLSS?.IMPORT_CONTROL?.CODE) {
        options.ImportControlIndicator = '';
        options.LabelMethod = {
            Code: SLSS.IMPORT_CONTROL.Code
        };
    }

    if (SLSS?.EMAIL_NOTIFICATION) {
        options.Notification = [{
            NotificationCode: SLSS.EMAIL_NOTIFICATION.EVENT_TYPE || '6',
            EMail: {
                EMailAddress: SLSS.EMAIL_NOTIFICATION.EMAIL || SHIPPER.EMAIL
            }
        }];
    }

    if (SLSS.RETURN_SHIP?.RETURN_TYPE === '8') {
        options.LabelDelivery = {
            LabelLinkIndicator: '',
            EMail: {
                EMailAddress: SLSS.RETURN_SHIP?.EMAIL || SHIPPER.EMAIL
            }
        }
        return options;
    };

    return options;
};

const buildPackageServiceOptions = (PLSS, isDomestic) => {
    const options = {};

    if (isDomestic && PLSS?.SIGNATURE_OPTION_TYPE) {
        options.DeliveryConfirmation = {
            DCISType:
                PLSS.SIGNATURE_OPTION_TYPE === 'ADULT' ? '3' :
                    PLSS.SIGNATURE_OPTION_TYPE === 'NO_SIGNATURE_REQUIRED' ? '1' : '2'
        };
    }

    if (PLSS?.COD?.AMOUNT) {
        options.COD = {
            CODFundsCode: ['CASH'].includes(PLSS.COD.COLLECTION_TYPE?.toUpperCase()) ? '0' : '8',
            CODAmount: {
                CurrencyCode: PLSS.COD.CURRENCY.toUpperCase(),
                MonetaryValue: PLSS.COD.AMOUNT
            }
        };
    }

    if (PLSS?.HAZMAT?.IDNumber) {
        options.PackageIdentifier = PLSS.HAZMAT.PACKAGE_IDENTIFIER;
        options.HAZMAT = [{
            PackagingTypeQuantity: PLSS.HAZMAT.PACKAGING_TYPE_QUANTITY,
            SubRiskClass: PLSS.HAZMAT.SUB_CLASS,
            TechnicalName: PLSS.HAZMAT.TECHNICAL_NAME,
            ClassDivisionNumber: PLSS.HAZMAT.HAZ_CLASS,
            Quantity: PLSS.HAZMAT.QUANTITY || 1,
            UOM: PLSS.HAZMAT.UOM,
            PackagingType: PLSS.HAZMAT.PACKING_TYPE,
            IDNumber: PLSS.HAZMAT.UNID_NUMBER,
            ProperShippingName: PLSS.HAZMAT.PROPER_SHIPPING_NAME,
            PackagingGroupType: PLSS.HAZMAT.PACKAGING_GROUP_TYPE,
            PackagingInstructionCode: PLSS.HAZMAT.PACKAGING_INSTRUCTION_CODE,
            EmergencyPhone: reuse.validatePhNo(PLSS.HAZMAT.EMERGENCY_PHONE),
            EmergencyContact: PLSS.HAZMAT.EMERGENCY_CONTACT,
            ReportableQuantity: PLSS.HAZMAT.REPORTABLE_QUANTITY,
            RegulationSet: PLSS.HAZMAT.REGULATION_SET,
            TransportationMode: PLSS.HAZMAT.TRANSPORTATION_MODE,
            CommodityRegulatedLevelCode: PLSS.HAZMAT.COMMODITY_REGULATED_LEVEL_CODE,
            TransportCategory: PLSS.HAZMAT.TRANSPORT_CATEGORY,
            ChemicalRecordIdentifier: PLSS.HAZMAT.CHEMICAL_RECORD_IDENTIFIER,
            HazardLabelRequired: 'Y'
        }];
    }

    if (PLSS?.DRY_ICE?.WEIGHT > 0) {
        options.DryIce = {
            RegulationSet: DRY_ICE.REGULATION_SET || 'CFR',
            DryIceWeight: {
                UnitOfMeasurement: {
                    Code: ['KGS', 'KG'].includes(PLSS.DRY_ICE?.WEIGHT_UNITS?.toUpperCase()) ? '00' : '01'
                },
                Weight: PLSS.DRY_ICE.WEIGHT
            }
        };
    }

    return options;
};

const buildInternationalForms = ({ SLSS, SHIPPER, SOLDTO, INTERNATIONAL_DETAILS, currency, invdate }) => {
    const forms = {
        FormType: SLSS?.ELECTRONIC_TRADE_DOCUMENT ? '07' : '01',
        Contacts: {
            UltimateConsignee: {
                CompanyName: SOLDTO.COMPANY,
                Address: {
                    AddressLine: [SOLDTO.ADDRESS_LINE1, SOLDTO.ADDRESS_LINE2, SOLDTO.ADDRESS_LINE3].filter(Boolean).map(l => l.substring(0, 35)),
                    City: SOLDTO.CITY,
                    StateProvinceCode: SOLDTO.STATE,
                    CountryCode: SOLDTO.COUNTRY,
                    PostalCode: SOLDTO.ZIPCODE
                },
                UltimateConsigneeType: { Code: 'D' }
            },
            SoldTo: {
                Name: SOLDTO.COMPANY,
                AttentionName: SOLDTO.COMPANY,
                Phone: {
                    Number: validatePhoneNumber(SOLDTO.PHONE)
                },
                Address: {
                    AddressLine: [SOLDTO.ADDRESS_LINE1, SOLDTO.ADDRESS_LINE2, SOLDTO.ADDRESS_LINE3].filter(Boolean).map(l => l.substring(0, 35)),
                    City: SOLDTO.CITY,
                    StateProvinceCode: SOLDTO.STATE,
                    CountryCode: SOLDTO.COUNTRY,
                    PostalCode: SOLDTO.ZIPCODE
                }
            }
        },
        Product: []
    };

    INTERNATIONAL_DETAILS?.ITEM_INFO?.forEach(item => {
        forms.Product.push({
            ...(item.DESCRIPTION && { Description: item.DESCRIPTION }),
            Unit: {
                Number: String(item.QUANTITY),
                UnitOfMeasurement: {
                    Code: item.UOM || 'LBS'
                },
                Value: String(item.UNIT_COST)
            },
            CommodityCode: item.HTS_CODE,
            PartNumber: item.PRODUCT_NO,
            OriginCountryCode: item.COUNTRY_OF_MFR || SHIPPER.COUNTRY
        });
    });
    forms.INVOICE_NUMBER = INTERNATIONAL_DETAILS?.INVOICE_NUMBER || '';
    forms.InvoiceDate = INTERNATIONAL_DETAILS?.INVOICE_DATE || `${invdate}`;
    forms.PurchaseOrderNumber = INTERNATIONAL_DETAILS?.ITEM_INFO?.[0]?.PRODUCT_NO || '';
    forms.TermsOfShipment = Getcode.getTermsOfSaleCode(INTERNATIONAL_DETAILS?.INCOTERMS) || '';
    forms.ReasonForExport = INTERNATIONAL_DETAILS?.REASON_FOR_EXPORT?.toUpperCase() || 'SALE';
    forms.CurrencyCode = INTERNATIONAL_DETAILS?.ITEM_INFO?.[0]?.CURRENCY || currency;
    return forms;
};

function buildDimensions(dimension, dimUnit) {
    if (!dimension || dimension.startsWith('0')) return {};
    const [L, W, H] = dimension.toUpperCase().split('X');
    return {
        Dimensions: {
            UnitOfMeasurement: { Code: dimUnit },
            Length: L,
            Width: W,
            Height: H
        }
    };
}

const isTrue = (val) =>
    val === true || (typeof val === 'string' && val.toLowerCase() === 'true');