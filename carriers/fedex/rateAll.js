
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getFedexToken } = require('../../Reuse/fedex_token_manager.js');
const { getCSPFedexToken } = require('../../Reuse/fedex_csptoken_manager.js');

const axiosInstance = axios.create({
    timeout: 15000
});


module.exports = async function fedexRateAll(request) {
    const chargeCodes = request?.chargeCodeData;
    try {
        const { raterequest, token, rateurl } = await buildFedExRequest(request);
        const response = await axiosInstance.post(rateurl, raterequest, {
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${token}`
            }
        });
        const rates = await processFedExRateResponse(request, response, request.CARRIER_DETAILS.SHIPPING_ACCOUNT, chargeCodes);
        return { status: 'Success', rates };
    } catch (error) {
        console.error('Error fetching FEDEX rates:', error.response?.data || error.message);
        return reuse.handleErrorRes('FEDEX', error);
    }

};

const isTrue = (val) =>
    val === true ||
    (typeof val === 'string' && ['true', 'x', 'yes', '1'].includes(val.toLowerCase().trim()));

const buildAddress = (data) => ({
    address: {
        city: data.CITY,
        stateOrProvinceCode: data.STATE,
        countryCode: data.COUNTRY,
        postalCode: data.ZIPCODE,
        streetLines: [data.ADDRESS_LINE1, data.ADDRESS_LINE2, data.ADDRESS_LINE3].filter(Boolean),
        ...((data?.ADDRESS_TYPE) && { residential: data?.ADDRESS_TYPE.toUpperCase() === "RESIDENTIAL" })

    }

});

const getUnits = (w) => ({
    weightUnit: w?.toUpperCase().startsWith('K') ? 'KG' : 'LB',
    dimUnit: w?.toUpperCase().startsWith('K') ? 'CM' : 'IN'
});

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
const createShipmentSpecialServices = (SLSS) => {
    const shipmentSpecialServices = {
        specialServiceTypes: [],

        // NOTE: hold-at-location details are not included in rate requests (rate API
        // doesn't accept them). See carriers/fedex/ship.js for the canonical pattern:
        // SLSS.HOLD_AT_LOCATION (boolean flag) + request.HOLD_AT_LOCATION (address object).
        ...((SLSS?.DRY_ICE && SLSS.DRY_ICE.WEIGHT > 0) && {
            shipmentDryIceDetail: {
                packageCount: Number(SLSS.DRY_ICE?.QUANTITY) || 1,
                totalWeight: {
                    units: SLSS.DRY_ICE.WEIGHT_UNITS?.toUpperCase() || 'KG',
                    value: Number(SLSS.DRY_ICE.WEIGHT)
                }
            }
        }),
        ...((SLSS?.ReturnShip && SLSS.RETURN_SHIP?.RETURN_TYPE) && {
            returnShipmentDetail: {
                returnType: SLSS.RETURN_SHIP?.RETURN_TYPE
            }
        }),
        ...((SLSS?.HOME_DELIVERY && SLSS.HOME_DELIVERY?.PREMIUM_TYPE) && {
            homeDeliveryPremiumDetail: {
                phoneNumber: {
                    areaCode: SLSS.HOME_DELIVERY?.AREA_CODE || '',
                    localNumber: SLSS.HOME_DELIVERY.PHONE
                },
                deliveryDate: SLSS.HOME_DELIVERY.DELIVERY_DATE,
                homedeliveryPremiumType: SLSS.HOME_DELIVERY?.PREMIUM_TYPE || 'APPOINTMENT'
            }
        }),
        ...(SLSS?.ELECTRONIC_TRADE_DOCUMENT && {
            etdDetail: {
                requestedDocumentTypes: ['COMMERCIAL_INVOICE']
            }
        })
    };

    // Add special service types based on conditions
    //if (SLSS?.COD) shipmentSpecialServices.specialServiceTypes.push('COD');
    if (isTrue(SLSS?.HOLD_AT_LOCATION)) shipmentSpecialServices.specialServiceTypes.push('HOLD_AT_LOCATION');
    if (isTrue(SLSS?.RESIDENTIAL_DELIVERY)) shipmentSpecialServices.specialServiceTypes.push('RESIDENTIAL_DELIVERY');
    if (isTrue(SLSS?.FEDEX_ONE_RATE)) shipmentSpecialServices.specialServiceTypes.push('FEDEX_ONE_RATE');
    if (isTrue(SLSS?.BROKER_SELECT)) shipmentSpecialServices.specialServiceTypes.push('BROKER_SELECT_OPTION');
    if (isTrue(SLSS?.SATURDAY_PICKUP)) shipmentSpecialServices.specialServiceTypes.push('SATURDAY_PICKUP');
    if (isTrue(SLSS?.SATURDAY_DELIVERY)) shipmentSpecialServices.specialServiceTypes.push('SATURDAY_DELIVERY');
    if (isTrue(SLSS?.THIRD_PARTY_CONSIGNEE)) shipmentSpecialServices.specialServiceTypes.push('THIRD_PARTY_CONSIGNEE');
    if (isTrue(SLSS?.ELECTRONIC_TRADE_DOCUMENT)) shipmentSpecialServices.specialServiceTypes.push('ELECTRONIC_TRADE_DOCUMENTS');
    if (isTrue(SLSS?.CALL_BEFORE_DELIVERY)) shipmentSpecialServices.specialServiceTypes.push('CALL_BEFORE_DELIVERY');
    if (SLSS?.DRY_ICE && SLSS.DRY_ICE.WEIGHT > 0) shipmentSpecialServices.specialServiceTypes.push('DRY_ICE');
    if (SLSS?.HOME_DELIVERY && SLSS.HOME_DELIVERY?.PREMIUM_TYPE) shipmentSpecialServices.specialServiceTypes.push('HOME_DELIVERY_PREMIUM');
    if (SLSS?.RETURN_TYPE && SLSS.RETURN_SHIP?.RETURN_TYPE) shipmentSpecialServices.specialServiceTypes.push('RETURN_SHIPMENT');
    if (SLSS?.EMAIL_NOTIFICATION?.EVENT_TYPE?.length) shipmentSpecialServices.specialServiceTypes.push('EVENT_NOTIFICATION');
    //  if (isTrue(SLSS?.PharmacyDelivery) shipmentSpecialServices.specialServiceTypes.push('PHARMACY_DELIVERY');
    //   if (isTrue(SLSS?.INSIDE_DELIVERY) shipmentSpecialServices.specialServiceTypes.push('INSIDE_DELIVERY');
    //   if (isTrue(SLSS?.INSIDE_PICKUP) shipmentSpecialServices.specialServiceTypes.push('INSIDE_PICKUP');

    return shipmentSpecialServices;
};
const createPackageSpecialServices = (PLSS, SLSS) => {

    const specialServices = {
        specialServiceTypes: [],
        ...((SLSS?.SIGNATURE_OPTION_TYPE || PLSS?.SIGNATURE_OPTION_TYPE) && {
            signatureOptionType: SignatureMap(SLSS?.SIGNATURE_OPTION_TYPE || PLSS?.SIGNATURE_OPTION_TYPE)
        }),
        ...((PLSS?.ALCOHOL && PLSS?.ALCOHOL?.RECIPIENT_TYPE) && {
            alcoholDetail: {
                // BUGFIX: was `PLSS.Alcohol.*` (wrong casing — would throw)
                alcoholRecipientType: PLSS.ALCOHOL.RECIPIENT_TYPE,
                shipperAgreementType: PLSS.ALCOHOL.SHIPPER_AGREEMENT_TYPE
            }
        }),

        ...((PLSS?.DRY_ICE && PLSS.DRY_ICE?.WEIGHT > 0) && {
            dryIceWeight: {
                units: PLSS.DRY_ICE.WEIGHT_UNITS?.toUpperCase() || 'KG',
                value: PLSS.DRY_ICE.WEIGHT
            }
        }),
        ...((PLSS?.BATTERY && PLSS.BATTERY?.PACKING_TYPE) && {
            batteryDetails: [{
                packing: PLSS.BATTERY.PACKING_TYPE,
                regulatorySubType: PLSS.BATTERY.REGULATORY_TYPE,
                material: PLSS.BATTERY.MATERIAL_TYPE
            }]
        }),
        ...((PLSS?.HAZMAT && PLSS.HAZMAT?.ACCESSIBILITY) && {
            dangerousGoodsDetail: {
                accessibility: PLSS.HAZMAT?.ACCESSIBILITY || "ACCESSIBLE",
                // options: ["HAZARDOUS_MATERIALS"],
                // cargoAircraftOnly: PLSS.HAZMAT.CARGO_AIRCRAFT,
                // containers: [{
                //     hazardousCommodities: [{
                //         quantity: {
                //             amount: PLSS.HAZMAT.QUANTITY,
                //             units: PLSS.HAZMAT.UOM
                //         },
                //         description: {
                //             packingGroup: PLSS.HAZMAT.PACKAGING_GROUP_TYPE,
                //             subsidiaryClasses: [PLSS.HAZMAT.SUB_CLASS],
                //             technicalName: PLSS.HAZMAT.TECHNICAL_NAME,
                //             packingDetails: {
                //                 cargoAircraftOnly: PLSS.HAZMAT.CARGO_AIRCRAFT,
                //                 packingInstructions: PLSS.HAZMAT.PACKAGING_INSTRUCTION_CODE
                //             },
                //             id: PLSS.HAZMAT.UNID_NUMBER,
                //             properShippingName: PLSS.HAZMAT.PROPER_SHIPPING_NAME,
                //             hazardClass: PLSS.HAZMAT.HAZ_CLASS
                //         }
                //     }],
                //     numberOfContainers: Number(PLSS.HAZMAT.PACKAGING_TYPE_QUANTITY),
                //     containerType: PLSS.HAZMAT.PACKING_TYPE
                // }],
                // packaging: {
                //     count: Number(PLSS.HAZMAT.QUANTITY),
                //     units: PLSS.HAZMAT.UOM
                // },
                // signatory: {
                //     contactName: PLSS.HAZMAT.EMERGENCY_CONTACT,
                //     title: "Tester",
                //     place: "Test Place"
                // },
                // emergencyContactNumber: PLSS.HAZMAT.EMERGENCY_PHONE
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
    if (isTrue(PLSS?.SATURDAY_PICKUP)) specialServices.specialServiceTypes.push('SATURDAY_PICKUP');
    if (PLSS?.ALCOHOL?.RECIPIENT_TYPE) specialServices.specialServiceTypes.push('ALCOHOL');
    if (PLSS?.DRY_ICE?.WEIGHT > 0) specialServices.specialServiceTypes.push('DRY_ICE');
    if (PLSS?.BATTERY?.PACKING_TYPE) specialServices.specialServiceTypes.push('BATTERY');
    if (PLSS?.HAZMAT?.ACCESSIBILITY || PLSS?.HAZMAT?.UNID_NUMBER) specialServices.specialServiceTypes.push('DANGEROUS_GOODS');

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
async function buildFedExRequest(request) {
    const shipDate = request.HEADER_INFO?.SHIP_DATE || new Date().toISOString();
    const [date] = shipDate.split('T');
    const tokenurl = request.CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;
    let rateurl = request.CARRIER_DETAILS.RATEURL || process.env.FEDEX_RATE;
    const userId = request.CARRIER_DETAILS.USERID;
    const password = request.CARRIER_DETAILS.PASSWORD;
    const accountNumber = request.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES || {};
    const CSPuserId = request.CARRIER_DETAILS.CSP_USER || process.env.FEDEX_CSPUSER;
    const CSPpassword = request.CARRIER_DETAILS.CSP_PASSWORD || process.env.FEDEX_CSPPASSWORD;
    // const token = await getFedexToken(accountNumber, tokenurl, userId, password);
    const token = await getCSPFedexToken(tokenurl, CSPuserId, CSPpassword, request.CARRIER_DETAILS.USERID, request.CARRIER_DETAILS.PASSWORD, request.CARRIER_DETAILS.SHIPPING_ACCOUNT);
    let brokeraddress = request?.INTERNATIONAL_DETAILS?.BROKER_ADDRESS || request?.BROKER_ADDRESS;
    let currency = 'USD';
    const { weightUnit, dimUnit } = getUnits(request.PACKAGES?.[0]?.WEIGHT_UNITS);
    if (SLSS?.HOME_DELIVERY && SLSS.HOME_DELIVERY?.PREMIUM_TYPE) {
        request.SHIPTO.ADDRESS_TYPE = "RESIDENTIAL";
    };
    const raterequest = {
        accountNumber: { value: accountNumber },
        rateRequestControlParameters: { returnTransitTimes: true },
        carrierCodes: ["FDXE", "FDXG"],
        requestedShipment: {
            shipper: buildAddress(request.SHIPPER),
            recipient: buildAddress(request.SHIPTO),
            // serviceType: 'FEDEX_PRIORITY_OVERNIGHT',//request.CARRIER_DETAILS?.SERVICE_CODE;
            // preferredCurrency: 'USD',
            rateRequestType: ['ACCOUNT', 'LIST'],
            shipDatestamp: date,
            pickupType: request.CARRIER_DETAILS?.PICKUP_TYPE || "USE_SCHEDULED_PICKUP",
            packagingType: request.HEADER_INFO.PACKAGING_TYPE || 'YOUR_PACKAGING',
            ...(SLSS?.INDICIA && {
                smartPostInfoDetail: {
                    indicia: SLSS?.INDICIA || 'PARCEL_SELECT'
                }
            }),
            ...(request.SHIPPER.COUNTRY !== request.SHIPTO.COUNTRY && {
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
                    commodities: request.INTERNATIONAL_DETAILS.ITEM_INFO?.map(item => ({
                        unitPrice: {
                            amount: Number(item.UNIT_COST),
                            currency: currency
                        },
                        quantity: Number(item.QUANTITY),
                        quantityUnits: item.UOM || 'EA',
                        customsValue: {
                            amount: Number(item.QUANTITY * item.UNIT_COST),
                            currency: currency
                        },
                        countryOfManufacture: item?.COUNTRY_OF_MFR || SHIPPER.COUNTRY,
                        harmonizedCode: item.HTS_CODE,
                        description: item.DESCRIPTION,
                        weight: {
                            units: weightUnit,
                            value: Number(item.ITEM_WEIGHT)
                        },
                        //  partNumber: item.PRODUCT_NO
                    })) || [],


                    // Total customs value
                    totalCustomsValue: {
                        amount: Number(request.INTERNATIONAL_DETAILS.ITEM_INFO?.reduce(
                            (sum, item) => sum + (item.QUANTITY * item.UNIT_COST), 0
                        ) || 0),
                        currency: currency
                    },

                    // Insurance
                    ...(SLSS?.INSURANCE_AMOUNT > 0 && {
                        insuranceCharge: {
                            amount: Number(SLSS.INSURANCE_AMOUNT),
                            currency: SLSS?.INSURANCE_CURRENCY || currency
                        }
                    })
                }
            }),
        }
    }
    raterequest.requestedShipment.shipmentSpecialServices = createShipmentSpecialServices(SLSS);
    raterequest.requestedShipment.requestedPackageLineItems = request.PACKAGES.map((element, index) => {
        const { weightUnit, dimUnit } = getUnits(element.WEIGHT_UNITS);
        const xpackage = {
            // subPackagingType: element.ITEM_PACKING_TYPE || 'BOX',
            groupPackageCount: 1, //number of identical package
            weight: {
                value: Number(element.WEIGHT),
                units: weightUnit
            },
            ...((element?.DECLARED_VALUE) && {
                declaredValue: {
                    currency: currency,
                    amount: element.DECLARED_VALUE
                }
            }),
            //  contentRecord: createContentRecords(element.ItemsInfo || []),
            dimensions: createDimensions(element.DIMENSION, dimUnit),
            packageSpecialServices: createPackageSpecialServices(element?.PACKAGE_LVL_SPECIAL_SERVICES, SLSS)

        };
        return xpackage;
    });
    console.log(JSON.stringify(raterequest))
    return { raterequest, token, rateurl };
}

async function processFedExRateResponse(request, response, accountNumber, chargeCodes) {
    const rateShopResponse = [];
    // console.log('FedEx Rate Response', JSON.stringify(response.data.output))
    response.data.output.rateReplyDetails.forEach(element => {
        try {
            const accountObj = element.ratedShipmentDetails.find(acc => acc.rateType === 'ACCOUNT');
            const listObj = element.ratedShipmentDetails.find(lobj => lobj.rateType === 'LIST');

            if (!accountObj) return;
            // Calculate transit days
            let transitDays;
            let shipdate = request.HEADER_INFO.SHIP_DATE?.split('T');
            const expectedDeliveryDate = element.commit?.dateDetail?.dayFormat || null;
            // If transitDays is provided, use it
            if (element.commit?.transitDays?.minimumTransitTime) {
                const transitMap = {
                    'ONE_DAY': 1, 'TWO_DAYS': 2, 'THREE_DAYS': 3, 'FOUR_DAYS': 4, 'FIVE_DAYS': 5, 'SIX_DAYS': 6, 'SEVEN_DAYS': 7, 'EIGHT_DAYS': 8, 'NINE_DAYS': 9, 'TEN_DAYS': 10
                };
                transitDays = transitMap[element.commit.transitDays.minimumTransitTime]?.toString() || '1';
            }
            // If missing, calculate from dates
            else if (expectedDeliveryDate && shipdate) {
                transitDays = calculateTransitDays(shipdate, expectedDeliveryDate).toString();
            }
            // Default fallback
            else {
                transitDays = '1';
            }
            //rateShop = reuse.handleSalesOrderRateRes('FEDEX', accountNumber, element.serviceType, element.serviceName, accountObj.totalNetFedExCharge, listObj?.totalNetFedExCharge || '', element?.commit?.dateDetail?.dayFormat, element?.commit?.transitDays?.minimumTransitTime, accountObj.currency, request.HEADER_INFO.ShippingPoint, request.HEADER_INFO.SalesOrderDate)
            const rateShop = reuse.handleRateRes(
                'FEDEX',
                accountNumber,
                element.serviceType,
                element.serviceName,
                accountObj?.totalNetFedExCharge || listObj?.totalNetFedExCharge || '',
                listObj?.totalNetFedExCharge || accountObj?.totalNetFedExCharge || '',
                expectedDeliveryDate,
                transitDays,
                accountObj.currency, request.HEADER_INFO.ShippingPoint, request.HEADER_INFO.SalesOrderDate
            );
            rateShop.CHARGE_DETAILS = accountObj.shipmentRateDetail.surCharges.map((charge) => {
                return reuse.handlesurCharRes("FEDEX", charge.type, charge.description, charge.amount, accountObj.currency, chargeCodes);
            });
            rateShop.CHARGE_DETAILS.push(
                reuse.handlesurCharRes("FEDEX", 'BASE', 'Base Charge', accountObj.totalBaseCharge, accountObj.currency, chargeCodes)
            );
            rateShopResponse.push(rateShop);
        } catch (ex) {
            console.error('Error processing FEDEX rate detail:', ex);
        }
    });

    return rateShopResponse;
}


function calculateTransitDays(shipDateStr, deliveryDateStr) {
    // Convert strings to Date objects
    const shipDate = new Date(shipDateStr); // Your shipDatestamp (2025-12-05)
    const deliveryDate = new Date(deliveryDateStr); // dayFormat (2025-12-09T23:59:00)

    // Reset times to compare only dates
    const shipDateOnly = new Date(shipDate.getFullYear(), shipDate.getMonth(), shipDate.getDate());
    const deliveryDateOnly = new Date(deliveryDate.getFullYear(), deliveryDate.getMonth(), deliveryDate.getDate());

    // Calculate business days (excluding weekends)
    let businessDays = 0;
    let currentDate = new Date(shipDateOnly);

    // Loop through each day until delivery date
    while (currentDate < deliveryDateOnly) {
        currentDate.setDate(currentDate.getDate() + 1);
        const dayOfWeek = currentDate.getDay();

        // Skip Saturdays (6) and Sundays (0)
        if (dayOfWeek !== 0 && dayOfWeek !== 6) {
            businessDays++;
        }
    }

    return businessDays;
}
