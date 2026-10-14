//As UPS response ==>TransportationCharges = BaseServiceCharge + ItemizedCharges
//TotalCharges = TransportationCharges + ServiceOptionsCharges
// carriers/UPS/ship.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getupsToken } = require('../../Reuse/ups_token_manager.js');
const Getcode = require('../../Reuse/ServicesandCodes.js');
const { buildFinalResponse } = require('../../Reuse/responseBuilder');

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
    const service = CARRIER_DETAILS?.SERVICE_CODE || CARRIER_DETAILS?.SERVICE_NAME;

    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES || {};

    const hasETD = isTrue(SLSS?.ELECTRONIC_TRADE_DOCUMENT);
    const hasBase64Docs = Array.isArray(SLSS?.ETD_DOCUMENTS)
        && SLSS.ETD_DOCUMENTS.length > 0
        && !!SLSS.ETD_DOCUMENTS[0]?.ENCODED_DOC;
    const ETDbase64url = CARRIER_DETAILS.ETDBASE64URL || process.env.UPS_ETD_BASE64;



    // Single source of truth — both success and error paths mutate this same object.
    let FINALRESPONSE = buildFinalResponse(request);
    let SHIPFROM = request.SHIPFROM?.ZIPCODE ? request.SHIPFROM : SHIPPER;
    let SOLDTO = request.SOLDTO?.ZIPCODE ? request.SOLDTO : SHIPTO;
    let holdaddress = request.HOLD_AT_LOCATION?.ZIPCODE ? request.HOLD_AT_LOCATION : SHIPTO;
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
    try {
        const tokenurl = CARRIER_DETAILS.TOKENURL || process.env.UPS_TOKEN;
        const shipurl = CARRIER_DETAILS.SHIPURL || process.env.UPS_SHIP;
        const shipDate = HEADER_INFO?.SHIP_DATE || new Date().toISOString();
        const [date /*, time */] = shipDate.split('T');
        const invdate = (date || '').replace(/-/g, '');
        const token = await getupsToken(tokenurl, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD, CARRIER_DETAILS.SHIPPING_ACCOUNT);

        let documentIds = [];

        if (hasETD) {
            if (hasBase64Docs) {
                // 🔵 Encoded Multi Upload
                const documentsArray = SLSS.ETD_DOCUMENTS.map((doc, index) => ({
                    UserCreatedFormFileName: "TestFile.pdf",
                    UserCreatedFormFileFormat: doc?.CONTENT_TYPE || 'pdf',
                    UserCreatedFormDocumentType: getUpsDocType(doc?.DOC_TYPE),
                    UserCreatedFormFile: doc.ENCODED_DOC
                }));
                const uploadResult = await uploadEncodedMultiETD(ETDbase64url, token, documentsArray);
                documentIds.push(uploadResult.UploadResponse.Response.FormsHistoryDocumentID.DocumentID[0]);

            }
        }

        let surchargesary = []
        let Hazmat = false;
        let currency = 'USD'

        // declared with `let` because service '92' (Mail Innovations) overwrites weightUnit below
        let { weightUnit, dimUnit } = getUnits(PACKAGES?.[0]?.WEIGHT_UNITS);

        let shiprequest = {};

        shiprequest = {
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

                    Shipper: {
                        Name: SHIPPER.COMPANY,
                        AttentionName: SHIPPER.CONTACT,
                        Phone: buildPhone(SHIPPER.PHONE),
                        ShipperNumber: CARRIER_DETAILS.SHIPPING_ACCOUNT,
                        Address: buildAddress(SHIPPER)
                    },

                    ShipTo: {
                        Name: SHIPTO.COMPANY,
                        AttentionName: SHIPTO.CONTACT || 'ShipTo contact',
                        Phone: buildPhone(SHIPTO.PHONE),
                        Address: buildAddress(SHIPTO)
                    },
                    AlternateDeliveryAddress: {
                        Name: holdaddress.COMPANY,
                        AttentionName: holdaddress.CONTACT || 'holdaddress contact',
                        // Phone: buildPhone(holdaddress.PHONE),
                        Address: buildAddress(holdaddress)
                    },
                    ShipFrom: {
                        Name: SHIPFROM.COMPANY,
                        AttentionName: SHIPPER.CONTACT || 'Shipper contact',
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
                MonetaryValue: String(INTERNATIONAL_DETAILS?.CUSTOMS_VALUE)
            }
        }
        // Pass SHIPTO — the function reads SHIPTO.EMAIL for hold-at-location notifications
        shipment.ShipmentServiceOptions = buildShipmentServiceOptions(SLSS, SHIPTO, strDCISType);
        if (SHIPPER.COUNTRY !== SHIPTO.COUNTRY) {
            shipment.ShipmentServiceOptions.InternationalForms =
                buildInternationalForms({ SLSS, SHIPPER, SOLDTO, INTERNATIONAL_DETAILS, currency, invdate, documentIds });
        }
        if (SLSS?.GroundFreightPricing) {
            shipment.FRSPaymentInformation = {
                Type: { Code: CARRIER_DETAILS.PAYMENT_TYPE },
                AccountNumber: CARRIER_DETAILS.SHIPPING_ACCOUNT,
                Address: { PostalCode: '', CountryCode: '' }
            };
        } else {
            shipment.PaymentInformation = {
                ShipmentCharge: []
            };

            // --- Type 01: Transportation (required) ---
            const transportCharge = { Type: '01' };
            const paymentType = (CARRIER_DETAILS.PAYMENT_TYPE || '').toString();

            if (/third|3rd/i.test(paymentType)) {
                transportCharge.BillThirdParty = {
                    AccountNumber: CARRIER_DETAILS?.BILLING_ACCOUNT,
                    Address: {
                        PostalCode: CARRIER_DETAILS?.BILLING_ZIPCODE,
                        CountryCode: CARRIER_DETAILS?.BILLING_COUNTRY
                    }
                };
            } else if (/recipient/i.test(paymentType)) {
                transportCharge.BillReceiver = {
                    AccountNumber: CARRIER_DETAILS?.BILLING_ACCOUNT,
                    Address: { PostalCode: CARRIER_DETAILS?.BILLING_ZIPCODE }
                };
            } else if (/consignee/i.test(paymentType)) {
                transportCharge.ConsigneeBilledIndicator = '';
            } else {
                transportCharge.BillShipper = {
                    AccountNumber: CARRIER_DETAILS.SHIPPING_ACCOUNT
                };
            }

            shipment.PaymentInformation.ShipmentCharge.push(transportCharge);

            // --- Type 02: Duties and Taxes (only if DUTIES_ACCOUNT provided) ---
            if (CARRIER_DETAILS.DUTIES_ACCOUNT) {
                const dutiesCharge = { Type: '02' };
                const dutiesType = (CARRIER_DETAILS.DUTIES_PAYMENT_TYPE || '').toString();

                if (/third|3rd/i.test(dutiesType)) {
                    dutiesCharge.BillThirdParty = {
                        AccountNumber: CARRIER_DETAILS.DUTIES_ACCOUNT,
                        Address: {
                            PostalCode: CARRIER_DETAILS?.BILLING_ZIPCODE,
                            CountryCode: CARRIER_DETAILS?.BILLING_COUNTRY
                        }
                    };
                } else if (/recipient/i.test(dutiesType)) {
                    dutiesCharge.BillReceiver = {
                        AccountNumber: CARRIER_DETAILS.DUTIES_ACCOUNT,
                        Address: { PostalCode: CARRIER_DETAILS?.BILLING_ZIPCODE }
                    };
                } else {
                    // SENDER or any other value
                    dutiesCharge.BillShipper = {
                        AccountNumber: CARRIER_DETAILS.DUTIES_ACCOUNT
                    };
                }

                shipment.PaymentInformation.ShipmentCharge.push(dutiesCharge);
            }
        }
        if (SLSS?.HOLD_AT_LOCATION) {
            shipment.ShipmentIndicationType = [
                {
                    Code: "01",
                    Description: "Hold for Pickup at UPS Access Point"
                }
            ]
        }
        shipment.Package = [];

        PACKAGES.forEach(pkg => {
            const PLSS = pkg?.PACKAGE_LVL_SPECIAL_SERVICES;
            if (service === '92') {
                weightUnit = 'OZS';
                pkg.WEIGHT = (pkg.WEIGHT * 16).toFixed(2);
            }

            const xpackage = {
                Description: reuse.getOrDefault(pkg.DESCRIPTION, 'package'),
                Packaging: { Code: '02', Description: 'SimpleRateDPackaging' },
                PackageWeight: {
                    UnitOfMeasurement: { Code: weightUnit },
                    Weight: String(pkg.WEIGHT)
                },
                PackageServiceOptions: {}
            };

            xpackage.PackageServiceOptions = buildPackageServiceOptions(PLSS, isDomestic, SLSS);

            if (pkg.DIMENSION && !pkg.DIMENSION.startsWith('0')) {
                const [L, W, H] = pkg.DIMENSION.toUpperCase().split('X');
                xpackage.Dimensions = {
                    UnitOfMeasurement: { Code: dimUnit },
                    Length: L,
                    Width: W,
                    Height: H
                };
            }

            shipment.Package.push(xpackage);
        });

        shiprequest.ShipmentRequest.LabelSpecification = {
            LabelImageFormat: { Code: CARRIER_DETAILS.LABELTYPE || 'GIF' },
            HTTPUserAgent: 'Mozilla/4.5',
            ...(CARRIER_DETAILS.LABELTYPE === 'ZPL' && {
                LabelStockSize: { Height: '6', Width: '4' }
            })
        };

        console.log('UPS Ship Request is ..:');
        console.log(JSON.stringify(shiprequest))


        const sres = await axiosInstance.post(
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
        console.log('UPS Ship Response is ..:');
        // console.log(JSON.stringify(sres.data.output))
        //  reuse.LogfileSave('Res_UPS_' + request.body.CARRIER_DETAILS.SERVICE_CODE, sres.data.output)
        const ShipResponse = sres.data.ShipmentResponse;
        let listcharge = ShipResponse?.ShipmentResults?.ShipmentCharges || {};
        let discountcharge = ShipResponse?.ShipmentResults?.NegotiatedRateCharges || listcharge;
        const Currencycode = discountcharge?.TotalCharges?.CurrencyCode || '';
        let TransportationCharges = discountcharge?.TransportationCharges?.MonetaryValue;

        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Shipped';
        FINALRESPONSE.PUBLISHED_FREIGHT = listcharge?.TotalCharges?.MonetaryValue;
        FINALRESPONSE.DISCOUNTED_FREIGHT = discountcharge?.TotalCharges?.MonetaryValue;
        FINALRESPONSE.CURRENCY = Currencycode;
        FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = ShipResponse.ShipmentResults?.ShipmentIdentificationNumber;

        FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipSurRateRes('Base Transportation', 'N/A', Currencycode, 'BASE', 'UPS', chargeCodes));
        //FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipRateRes('Published Freight', publishedFreight, Currencycode, 'LIST'));
        //FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipRateRes('Discounted Freight', discountFreight, Currencycode, 'DISC'));

        try {
            const itemizedCharges = discountcharge?.ItemizedCharges || [];
            if (itemizedCharges.length > 0) {
                for (const { Code, MonetaryValue, CurrencyCode } of itemizedCharges) {
                    FINALRESPONSE.CHARGE_DETAILS.push(
                        reuse.ShipSurRateRes(Getcode.getUPSAccessorialName(Code), MonetaryValue, CurrencyCode, Code, 'UPS', chargeCodes));
                }
            }
        } catch (ex) { }

        // UPS returns a single object (not an array) when only one package exists.
        const rawPackageResults = ShipResponse?.ShipmentResults?.PackageResults;
        const packageResults = Array.isArray(rawPackageResults)
            ? rawPackageResults
            : (rawPackageResults ? [rawPackageResults] : []);

        if (packageResults.length > 0) {
            try {
                let index = 0;
                for (const piece of packageResults) {
                    // FIX: USPS tracking was pushed as a separate package object.
                    // Merge it into the same package entry as UPS tracking.
                    FINALRESPONSE.PACKAGES.push({
                        TRACKING_NUMBER: piece.TrackingNumber,
                        ...(piece.USPSPICNumber && { USPS_TRACKING_NUMBER: piece.USPSPICNumber })
                    });
                    try {
                        const itemizedCharges = piece?.NegotiatedCharges?.ItemizedCharges || piece?.ItemizedCharges || [];
                        itemizedCharges.forEach(surc => {
                            surchargesary.push({
                                //  description: Getcode.getUPSAccessorialName(surc.Code),
                                amount: surc.MonetaryValue,
                                currency: surc.CurrencyCode,
                                type: surc.Code
                            });
                        });
                    } catch (ex) {
                        console.log(ex.message);
                    }
                    try {
                        let docType = piece.ShippingLabel.ImageFormat.Code === 'GIF' ? 'PNG' : piece.ShippingLabel.ImageFormat.Code;
                        let docName = piece.TrackingNumber + '.' + docType, docNamenew = '', encodedLabel = '';

                        if (docType === 'ZPL') {
                            let buffer = Buffer.from(piece.ShippingLabel.GraphicImage, 'base64');
                            let zplString = buffer.toString('utf-8');
                            encodedLabel = zplString.replace('^POI', ''); //(remove null bytes if present)
                        } else {
                            try {
                                let rotatedBuffer = await reuse.Rotatebase64Data(piece.ShippingLabel.GraphicImage);
                                encodedLabel = rotatedBuffer.toString('base64');
                            } catch (error) {

                            }
                        }
                        const formatDoc = reuse.formatShipDoc('UPS', 'LABEL', 1, docName, encodedLabel, docType);

                        FINALRESPONSE.SHIPPING_DOCUMENTS.push(formatDoc);
                    } catch (ex) { console.log('rotate label ', ex.message) }
                    index = index + 1;
                }
            } catch (ex) { }
            try {
                const uniquesurcDescIDSet = new Set(surchargesary.map(item => item.type));
                let uniquesurcArray = Array.from(uniquesurcDescIDSet)
                uniquesurcArray.forEach(type => {
                    let totalsurc = 0
                    const scrcobjs = surchargesary.filter((surobj) => { if (surobj.type == type) return surobj; })
                    scrcobjs.forEach(surc => {
                        totalsurc = totalsurc + Number(surc.amount);
                    });
                    FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipSurRateRes(Getcode.getUPSAccessorialName(type), totalsurc, Currencycode, type, 'UPS', chargeCodes));
                });
            } catch (ex) { console.log(ex) }




        }

        try {
            if (SHIPPER.COUNTRY !== SHIPTO.COUNTRY) {
                let docName = PACKAGES[0]?.TRACKING_NUMBER + '_CI.PDF', docNamenew = '';
                const formatDoc = reuse.formatShipDoc('UPS', 'INVOICE', 1, docNamenew, ShipResponse.ShipmentResults.Form.Image.GraphicImage, 'PDF');
                FINALRESPONSE.SHIPPING_DOCUMENTS.push(formatDoc);
            }
        } catch (ex) { }

        let docp = [];
        // Return-shipping support — re-enable once UPSIncludeReturn module is available.
        // try {
        //     if (SLSS?.RETURN_SHIP?.RETURN_TYPE) {
        //         try {
        //             docp.push(UPSIncludeReturn.ReturnShip(request, token))
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
        console.log('Ship Exception:', JSON.stringify(ex.response?.data) || ex.message);
        FINALRESPONSE.STATUS = 'Error';
        let errordesc = ex.message;
        if (ex?.response?.data?.response) {
            errordesc = ex.response.data.response.errors.map(er => `${er.code} - ${er.message}`);
        }
        FINALRESPONSE.ERRORS = errordesc;
        return FINALRESPONSE;
    }
};

function getUpsDocType(docType) {
    if (!docType) return '002'; // default to Commercial Invoice

    return UPS_DOC_TYPE_MAP[docType] || '008'; // fallback to "Other Document"
}
const UPS_DOC_TYPE_MAP = {
    // Core documents
    COMMERCIAL_INVOICE: '002',
    CERTIFICATE_OF_ORIGIN: '003',
    PRO_FORMA_INVOICE: '002', // usually treated as commercial invoice

    // USMCA / NAFTA related
    USMCA_CERTIFICATION_OF_ORIGIN: '007',
    USMCA_COMMERCIAL_INVOICE_CERTIFICATION_OF_ORIGIN: '007',

    // Generic / fallback
    OTHER: '008',
    ETD_LABEL: '008', // no direct UPS equivalent

    // Optional mappings (if you ever pass these)
    PACKING_LIST: '010',
    SHIPPERS_LETTER: '012',
    DECLARATION: '013'
};
const isTrue = (val) =>
    val === true ||
    (typeof val === 'string' && ['true', 'x', 'yes', '1'].includes(val.toLowerCase().trim()));

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
const buildShipmentServiceOptions = (SLSS, SHIPTO, strDCISType) => {
    const options = {};

    if (isTrue(SLSS?.SATURDAY_DELIVERY)) options.SaturdayDeliveryIndicator = '';
    if (isTrue(SLSS?.SATURDAY_PICKUP)) options.SaturdayPickupIndicator = '';
    //if (isTrue(SLSS?.HOLD_FOR_PICKUP)) options.HoldForPickupIndicator = '';
    if (isTrue(SLSS?.RemoveCommercialInvoice)) options.CommercialInvoiceRemovalIndicator = '';
    if (isTrue(SLSS?.NEUTRAL_DELIVERY)) options.UPScarbonneutralIndicator = '';
    if (isTrue(SLSS?.LIFT_GATE_PICKUP)) options.LiftGateForPickUpIndicator = '';
    if (isTrue(SLSS?.LIFT_GATE_DELIVERY)) options.LiftGateForDeliveryIndicator = '';
    if (isTrue(SLSS?.DROPOFF_AT_FACILITY)) options.DropoffAtUPSFacilityIndicator = '';
    if (isTrue(SLSS?.EXCHANGE_FORWARD_SHIPMENT)) options.ExchangeForwardIndicator = '';

    if (strDCISType) {
        options.DeliveryConfirmation = {
            DCISType: strDCISType
        };
    }
    if (isTrue(SLSS?.HOLD_AT_LOCATION)) {

    }
    if (SLSS?.COD?.AMOUNT > 0) {
        options.COD = {
            CODFundsCode: ['CASH'].includes(SLSS.COD?.COLLECTION_TYPE?.toUpperCase()) ? '1' : '9',
            CODAmount: {
                CurrencyCode: SLSS.COD.CURRENCY?.toUpperCase(),
                MonetaryValue: SLSS.COD.AMOUNT
            }
        };
    }

    if (SLSS?.IMPORT_CONTROL?.CODE) {
        options.ImportControlIndicator = '';
        options.LabelMethod = {
            Code: SLSS.IMPORT_CONTROL.CODE
        };
    }

    let notifications = [];

    // Existing email notification logic
    if (SLSS?.EMAIL_NOTIFICATION?.EVENT_TYPE?.length) {
        const email = SLSS.EMAIL_NOTIFICATION.EMAIL || SHIPTO.EMAIL;

        notifications = [
            ...new Set(SLSS.EMAIL_NOTIFICATION.EVENT_TYPE.map(e => upsEventMap[e]))
        ]
            .filter(Boolean)
            .map(code => ({
                NotificationCode: code,
                EMail: { EMailAddress: email },
                Locale: { Language: 'ENG' }
            }));
    }

    // Hold at Location logic (force 012)
    if (isTrue(SLSS?.HOLD_AT_LOCATION)) {
        const email = SHIPTO.EMAIL;

        // Ensure notification array exists
        notifications = notifications || [];

        // Add 012 only if not already present
        const has012 = notifications.some(n => n.NotificationCode === '012');

        if (!has012) {
            notifications.push({
                NotificationCode: '012',
                EMail: { EMailAddress: email },
                Locale: { Language: 'ENG', Dialect: 'US' }
            });
        }
    }

    // Assign to options only if we have notifications
    if (notifications.length) {
        options.Notification = notifications;
    }
    return options;
};

const upsEventMap = {
    ON_SHIPMENT: '6',              // Ship Notification
    SHIP: '6',
    ON_DELIVERY: '8',              // Delivery Notification
    DELIVERED: '8',
    ON_EXCEPTION: '7',             // Exception Notification
    ON_TENDER: '5',                // In-Transit
    ON_ESTIMATED_DELIVERY: '5',
    ON_PICKUP_DRIVER_EN_ROUTE: '5',
    ON_PICKUP_DRIVER_DEPARTED: '5',
    ON_PICKUP_DRIVER_ASSIGNED: '5',
    ON_PICKUP_DRIVER_ARRIVED: '5'
};
const buildPackageServiceOptions = (PLSS, isDomestic, SLSS) => {
    const options = {};

    const signatureType = PLSS?.SIGNATURE_OPTION_TYPE || SLSS?.SIGNATURE_OPTION_TYPE;
    if (isDomestic && signatureType) {
        options.DeliveryConfirmation = {
            DCISType: signatureType === 'ADULT' ? '3' : signatureType === 'NO_SIGNATURE_REQUIRED' ? '1' : '2'
        };
    }

    if (PLSS?.COD?.AMOUNT > 0) {
        options.COD = {
            CODFundsCode: ['CASH'].includes(PLSS.COD.COLLECTION_TYPE?.toUpperCase()) ? '0' : '8',
            CODAmount: {
                CurrencyCode: PLSS.COD.CURRENCY?.toUpperCase() || 'USD',
                MonetaryValue: PLSS.COD.AMOUNT
            }
        };
    }

    if (PLSS?.HAZMAT?.UNID_NUMBER) {
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
            RegulationSet: PLSS.DRY_ICE.REGULATION_SET || 'CFR',
            DryIceWeight: {
                UnitOfMeasurement: {
                    Code: ['KGS', 'KG'].includes(PLSS.DRY_ICE?.WEIGHT_UNITS?.toUpperCase()) ? '00' : '01'
                },
                Weight: PLSS.DRY_ICE.WEIGHT.toString()
            }
        };
    }

    return options;
};

const buildInternationalForms = ({ SLSS, SHIPPER, SOLDTO, INTERNATIONAL_DETAILS, currency, invdate, documentIds }) => {
    const forms = {
        FormType: isTrue(SLSS?.ELECTRONIC_TRADE_DOCUMENT) ? '07' : '01',
        ...((documentIds?.length > 0) && {
            UserCreatedForm: {
                DocumentID: documentIds
            }
        }),
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
                    Number: reuse.validatePhNo(SOLDTO.PHONE)
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

    forms.InvoiceNumber = INTERNATIONAL_DETAILS?.INVOICE_NUMBER || '';
    forms.InvoiceDate = INTERNATIONAL_DETAILS?.INVOICE_DATE || `${invdate}`;
    forms.PurchaseOrderNumber = INTERNATIONAL_DETAILS?.ITEM_INFO?.[0]?.PRODUCT_NO || '';
    forms.TermsOfShipment = Getcode.getTermsOfSaleCode(INTERNATIONAL_DETAILS?.INCOTERMS) || '';
    forms.ReasonForExport = INTERNATIONAL_DETAILS?.REASON_FOR_EXPORT?.toUpperCase() || 'SALE';
    forms.CurrencyCode = INTERNATIONAL_DETAILS?.ITEM_INFO?.[0]?.CURRENCY || currency;
    return forms;
};

async function uploadEncodedMultiETD(ETDbase64url, token, documentsArray) {

    const Request = {
        UploadRequest: {
            Request: {
                TransactionReference: {
                    CustomerContext: ""
                }
            },
            UserCreatedForm: documentsArray,

        }
    };
    // console.log(JSON.stringify(payload));
    const response = await axios.post(ETDbase64url,
        Request,
        {
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${token}`,//tdata.data.access_token,
                'transId': '123',
                'ShipperNumber': 'B24W72',
                'transactionSrc': 'testing'
            }
        }
    );

    return response.data;
}
