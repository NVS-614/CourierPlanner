
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const Getcode = require('../../Reuse/ServicesandCodes.js');
const { getupsToken } = require('../../Reuse/ups_token_manager.js');
const moment = require('moment');

module.exports = async function upsRateAll(request) {

    const chargeCodes = request?.chargeCodeData;
    try {
        const { raterequest, token, rateurl } = await buildupsRequest(request);

        const response = await axios.post(rateurl, raterequest, {
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${token}`,
                'transId': '1' + request.HEADER_INFO?.DocumentNumber,
                'transactionSrc': 'testing'
            }
        });

        const rates = await processupsRateResponse(request, response, request.CARRIER_DETAILS.SHIPPING_ACCOUNT, chargeCodes);
        return { status: 'Success', rates };
    } catch (error) {
        console.error('Error fetching ups rates:', error.response?.data || error.message);
        return reuse.handleErrorRes('ups', error);
    }

};

async function buildupsRequest(request) {
    const shipDate = request.HEADER_INFO?.SHIP_DATE || new Date().toISOString();
    const [date] = shipDate.split('T');
    let {
        SHIPPING_ACCOUNT: accountNumber,
        USERID: userId,
        PASSWORD: password,
        TOKENURL: tokenurl,
        RATEURL: rateurl
    } = request.CARRIER_DETAILS;
    // Override if empty or undefined
    tokenurl = tokenurl || process.env.UPS_TOKEN;
    rateurl = rateurl || process.env.UPS_RATE;
    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES;
    const token = await getupsToken(tokenurl, userId, password, accountNumber);
    const shipperCountry = request.SHIPPER.COUNTRY?.toUpperCase();
    const shipToCountry = request.SHIPTO.COUNTRY?.toUpperCase();
    const isDomestic =
        shipperCountry === shipToCountry ||
        (shipperCountry === 'US' && shipToCountry === 'PR') ||
        (shipperCountry === 'PR' && shipToCountry === 'US');

    let strDCISType = ''
    if (!isDomestic && SLSS?.SIGNATURE_OPTION_TYPE) {
        strDCISType = SLSS.SIGNATURE_OPTION_TYPE === 'ADULT' ? '2' : '1'
    }
    let currency = 'USD';
    let { weightUnit, dimUnit } = getUnits(request.PACKAGES[0].WEIGHT_UNITS);

    let raterequest = {
        RateRequest: {
            Request: {
                RequestOption: 'Shoptimeintransit'
            },
            Shipment: {
                Description: "Clothing",
                Shipper: buildAddress(request.SHIPPER, accountNumber),
                ShipTo: buildAddress(request.SHIPTO),
                ShipFrom: buildAddress(request.SHIPPER),
                PaymentDetails: {
                    ShipmentCharge: {
                        Type: '01',
                        BillShipper: {
                            AccountNumber: accountNumber
                        }
                    }
                },
                ShipmentRatingOptions: {
                    NegotiatedRatesIndicator: 'X'
                },
                Package: [],
                DeliveryTimeInformation: {
                    PackageBillType: '03'
                },
                ShipmentServiceOptions: {
                    ...(isTrue(SLSS?.SATURDAY_DELIVERY) && {
                        SaturdayDeliveryIndicator: ''
                    }),
                    ...(isTrue(SLSS?.SATURDAY_PICKUP) && {
                        SaturdayPickupIndicator: ''
                    }),
                    ...(isTrue(SLSS?.SATURDAY_PICKUP) && {
                        HoldForPickupIndicator: ''
                    }),
                    ...((SLSS?.RemoveCommercialInvoice) && {
                        CommercialInvoiceRemovalIndicator: ''
                    }),
                    ...(isTrue(SLSS?.NEUTRAL_DELIVERY) && {
                        UPScarbonneutralIndicator: ''
                    }),
                    ...(isTrue(SLSS?.LIFT_GATE_PICKUP) && {
                        LiftGateForPickUpIndicator: ''
                    }),
                    ...(isTrue(SLSS?.LIFT_GATE_DELIVERY) && {
                        LiftGateForDeliveryIndicator: ''
                    }),
                    ...(isTrue(SLSS?.DROPOFF_AT_FACILITY) && {
                        DropoffAtUPSFacilityIndicator: ''
                    }),
                    ...(isTrue(SLSS?.EXCHANGE_FORWARD_SHIPMENT) && {
                        ExchangeForwardIndicator: ''
                    }),
                    ...((SLSS?.COD && SLSS.COD?.AMOUNT > 0) && {
                        COD: {
                            CODFundsCode: ['CASH'].includes(SLSS.COD?.COLLECTION_TYPE?.toUpperCase()) ? '1' : '9',
                            CODAmount: {
                                CurrencyCode: SLSS.COD.CURRENCY?.toUpperCase() || 'USD',
                                MonetaryValue: SLSS.COD.AMOUNT
                            }
                        }
                    }),
                    ...(strDCISType && {
                        DeliveryConfirmation: {
                            DCISType: strDCISType
                        }
                    }),
                    ...((SLSS?.IMPORT_CONTROL) && {
                        ImportControlIndicator: '',
                        LabelMethod: {
                            Code: SLSS.IMPORT_CONTROL?.CODE || '01'
                        }
                    }),
                    ...((SLSS?.EMAIL_NOTIFICATION?.EVENT_TYPE?.length) && {
                        Notification: [{
                            NotificationCode: SLSS.EMAIL_NOTIFICATION?.EVENT_TYPE || '6',
                            EMail: {
                                EMailAddress: SLSS.EMAIL_NOTIFICATION?.EMAIL || request.SHIPPER.EMAIL
                            }
                        }]
                    }),
                },
                ...((request.SHIPPER.COUNTRY !== request.SHIPTO.COUNTRY) && {
                    InvoiceLineTotal: {
                        CurrencyCode: request?.INTERNATIONAL_DETAILS?.CUSTOMS_VALUE_CURRENCY || currency,
                        MonetaryValue: String(request?.INTERNATIONAL_DETAILS?.CUSTOMS_VALUE ?? 1)
                    }
                })
            }
        }
    };

    let totalweight = 0;
    // Process each package
    request.PACKAGES.forEach(element => {
        const PLSS = element?.PACKAGE_LVL_SPECIAL_SERVICES;
        let packweight = 0;
        if (request.SHIPPER.COUNTRY === 'US' & request.SHIPTO.COUNTRY === 'US' & weightUnit === 'KGS') {
            packweight = kgToLb(element.WEIGHT);
            weightUnit = 'LBS'
        } else { packweight = element.WEIGHT }

        let strpackDCISType = '';
        const signatureType = PLSS?.SIGNATURE_OPTION_TYPE || SLSS?.SIGNATURE_OPTION_TYPE;

        if (isDomestic && signatureType) {
            strpackDCISType = signatureType === 'ADULT' ? '3' :
                signatureType === 'NO_SIGNATURE_REQUIRED' ? '1' :
                    '2';
        }
        totalweight = totalweight + Number(packweight)
        let xpackage = {

            PackagingType: {
                Code: '02',
                Description: 'Packaging'
            },
            PackageWeight: {
                UnitOfMeasurement: {
                    Code: weightUnit,
                    Description: weightUnit
                },
                Weight: packweight.toString()
            },
            ...((element.DIMENSION && element.DIMENSION !== "" && !element.DIMENSION.startsWith("0")) && {
                Dimensions: {
                    UnitOfMeasurement: {
                        Code: dimUnit,
                        Description: dimUnit
                    },
                    Length: element.DIMENSION.toUpperCase().split('X')[0],
                    Width: element.DIMENSION.toUpperCase().split('X')[1],
                    Height: element.DIMENSION.toUpperCase().split('X')[2]
                }
            }),
            PackageServiceOptions: {

                ...((PLSS?.COD && PLSS.COD?.AMOUNT > 0) && {
                    COD: {
                        CODFundsCode: ['CASH'].includes(PLSS.COD?.COLLECTION_TYPE?.toUpperCase()) ? '0' : '8',
                        CODAmount: {
                            CurrencyCode: PLSS.COD.CURRENCY?.toUpperCase() || 'USD',
                            MonetaryValue: PLSS.COD.AMOUNT
                        }
                    }
                }),
                ...((PLSS?.DRY_ICE && PLSS.DRY_ICE?.WEIGHT > 0) && {
                    DryIce: {
                        RegulationSet: PLSS.DRY_ICE.REGULATION_SET || 'CFR', //values are valid: IATA, CFR.
                        DryIceWeight: {
                            UnitOfMeasurement: {
                                Code: ['KGS', 'KG'].includes(PLSS.DRY_ICE.WEIGHT_UNITS?.toUpperCase()) ? '00' : '01',
                            },

                            Weight: PLSS.DRY_ICE.WEIGHT
                        }
                    }
                }),
                ...(strpackDCISType && {
                    DeliveryConfirmation: {
                        DCISType: strpackDCISType
                    }
                }),
            },
        }

        raterequest.RateRequest.Shipment.Package.push(xpackage);
    });

    raterequest.RateRequest.Shipment.ShipmentTotalWeight = {
        UnitOfMeasurement: {
            Code: weightUnit,
            Description: weightUnit
        },
        Weight: totalweight.toString()
    }

    console.log(JSON.stringify(raterequest))
    return { raterequest, token, rateurl };
}

async function processupsRateResponse(request, sres, accountNumber, chargeCodes) {
    const rateShopResponse = [];

    sres.data.RateResponse.RatedShipment.forEach(element => {
        let transitdays = 0;
        let rateShop = {};
        let serviceName = '', discate = '', ETA = '';
        const strcurrency = element.TotalCharges?.CurrencyCode;
        // Get service name based on country
        serviceName = request.SHIPPER.COUNTRY == 'CA'
            ? Getcode.getUPSServiceNameCA(element.Service.Code)
            : Getcode.getUPSServiceName(element.Service.Code);

        // Get negotiated rate or standard rate
        discate = element?.NegotiatedRateCharges
            ? element.NegotiatedRateCharges.TotalCharge.MonetaryValue
            : element.TotalCharges.MonetaryValue;

        // Calculate estimated arrival
        try {
            if (element?.TimeInTransit) {
                ETA = moment(element.TimeInTransit.ServiceSummary.EstimatedArrival.Arrival.Date).format('YYYY-MM-DDThh:mm:ss');
                transitdays = element.TimeInTransit.ServiceSummary.EstimatedArrival.BusinessDaysInTransit;
            } else if (element?.GUARANTEED_DELIVERY?.BusinessDaysInTransit) {
                transitdays = element.GUARANTEED_DELIVERY.BusinessDaysInTransit;
                ETA = reuse.addTransitDays(transitdays, datePart);
            }
        } catch (error) {
            console.log('Error calculating ETA:', error.message);
        }
        // rateShop = reuse.handleSalesOrderRateRes('UPS', accountNumber, element.Service.Code, serviceName, discate, element.TotalCharges.MonetaryValue, ETA, transitdays, strcurrency, HEADER_INFO?.ShippingPoint, HEADER_INFO?.SalesOrderDate)


        rateShop = reuse.handleRateRes('UPS', accountNumber, element.Service.Code, serviceName, discate, element.TotalCharges.MonetaryValue, ETA, transitdays, strcurrency, request.HEADER_INFO?.ShippingPoint, request.HEADER_INFO?.SalesOrderDate);

        try {
            const surresult = {};
            let baseCharge = 0;        // BASE (prefer negotiated)
            let transportCharge = 0;   // TRANSPORT (prefer negotiated)
            let optionCharge = 0;      // OPTION / ServiceOptions (prefer negotiated)
            let fuelCharge = 0;        // FUEL (code 375, prefer negotiated)

            const num = (v) => (v == null ? 0 : +v);

            // helper: sum a code in an itemized array
            const sumCode = (items, code) =>
                (items || []).reduce((s, c) => s + (c.Code === code ? num(c.MonetaryValue) : 0), 0);

            // helper: add all itemized to surresult
            const addItemized = (items) => {
                (items || []).forEach((c) => {
                    const code = c.Code;
                    surresult[code] = (surresult[code] || 0) + num(c.MonetaryValue);
                });
            };

            // -------- package-level sums: NEGOTIATED first, else PUBLISHED --------
            (element.RatedPackage || []).forEach((pkg) => {
                const neg = pkg.NegotiatedCharges || {};

                baseCharge += num(neg.BaseServiceCharge?.MonetaryValue ?? pkg.BaseServiceCharge?.MonetaryValue);
                transportCharge += num(neg.TransportationCharges?.MonetaryValue ?? pkg.TransportationCharges?.MonetaryValue);
                optionCharge += num(neg.ServiceOptionsCharges?.MonetaryValue ?? pkg.ServiceOptionsCharges?.MonetaryValue);

                // itemized: merge negotiated first, then published
                addItemized(neg.ItemizedCharges);
                addItemized(pkg.ItemizedCharges);

                // FUEL (375): prefer negotiated itemized, else published itemized (per package)
                const negFuel = sumCode(neg.ItemizedCharges, '375');
                if (negFuel > 0) {
                    fuelCharge += negFuel;
                } else {
                    fuelCharge += sumCode(pkg.ItemizedCharges, '375');
                }
            });

            // -------- shipment-level fallbacks if pkg-level missing --------
            const negTotal = num(element.NegotiatedRateCharges?.TotalCharge?.MonetaryValue);
            const pubTotal = num(element.TotalCharges?.MonetaryValue);
            const total = negTotal || pubTotal;

            // OPTION fallback (shipment-level, if available)
            if (optionCharge === 0) {
                optionCharge = num(element.NegotiatedRateCharges?.ServiceOptionsCharges?.MonetaryValue
                    ?? element.ServiceOptionsCharges?.MonetaryValue);
            }

            // TRANSPORT fallback:
            // 1) if still 0, try shipment-level transport (if present in your schema),
            // 2) else derive as total - options.
            if (transportCharge === 0) {
                transportCharge = num(element.NegotiatedRateCharges?.TransportationCharges?.MonetaryValue
                    ?? element.TransportationCharges?.MonetaryValue);
                if (transportCharge === 0 && total > 0 && optionCharge >= 0) {
                    transportCharge = Math.max(0, total - optionCharge);
                }
            }

            // BASE fallback: if still 0, derive as TRANSPORT - FUEL
            if (baseCharge === 0) {
                baseCharge = Math.max(0, transportCharge - fuelCharge);
            }

            // build surCharges array (include all itemized + explicit BASE/TRANSPORT/OPTION/FUEL lines)
            const surCharges = Object.keys(surresult).map((code) =>
                reuse.handlesurCharRes(
                    "UPS",
                    code,
                    Getcode.getUPSAccessorialName(code),
                    +surresult[code].toFixed(2),
                    strcurrency,
                    chargeCodes
                )
            );

            // ensure explicit buckets
            surCharges.push(
                reuse.handlesurCharRes(
                    "UPS",
                    'BASE',
                    'Base Charge',
                    +baseCharge.toFixed(2),
                    strcurrency,
                    chargeCodes
                ),
                reuse.handlesurCharRes(
                    "UPS",
                    'TRANSPORT',
                    'Transport Charge',
                    +transportCharge.toFixed(2),
                    strcurrency,
                    chargeCodes
                ),
                reuse.handlesurCharRes(
                    "UPS",
                    'OPTION',
                    'Service Options',
                    +optionCharge.toFixed(2),
                    strcurrency,
                    chargeCodes
                ),
                reuse.handlesurCharRes(
                    "UPS",
                    'FUEL',
                    'Fuel Surcharge',
                    +fuelCharge.toFixed(2),
                    strcurrency,
                    chargeCodes
                )
            );

            rateShop.CHARGE_DETAILS = surCharges;
        } catch (err) {
            console.log('UPS surcharge parse error:', err?.message || err);
        }

        rateShopResponse.push(rateShop);
    });


    return rateShopResponse;
}

const buildAddress = (data, accountNumber) => ({
    Name: data.COMPANY,
    ...(accountNumber && { ShipperNumber: accountNumber }),
    Address: {
        AddressLine: [
            data.ADDRESS_LINE1,
            data.ADDRESS_LINE2,
            data.ADDRESS_LINE3
        ].filter(line => line), //The filter will keep only truthy values (non-empty strings in this case)
        City: data.CITY,
        StateProvinceCode: data.STATE,
        CountryCode: data.COUNTRY,
        PostalCode: data.ZIPCODE
    }
});

function kgToLb(kg) {
    return kg * 2.20462;
}


const isTrue = (val) =>
    val === true ||
    (typeof val === 'string' && ['true', 'x', 'yes', '1'].includes(val.toLowerCase().trim()));
const getUnits = (w) => ({
    weightUnit: w?.toUpperCase().startsWith('K') ? 'KGS' : 'LBS',
    dimUnit: w?.toUpperCase().startsWith('K') ? 'CM' : 'IN'
});