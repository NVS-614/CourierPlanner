
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getFedexToken } = require('../../Reuse/fedex_token_manager.js');

const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

module.exports = async function fedexfrtRateAll(request) {

    const chargeCodes = request?.chargeCodeData;

    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES } = request;
    const tokenurl = CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;
    const rateurl = CARRIER_DETAILS.RATEURL || process.env.FEDEX_FREIGHT_RATE;

    const CSPuserId = CARRIER_DETAILS.CSPUserId || CARRIER_DETAILS.CSP_USER || process.env.FEDEX_CSPUSER;
    const CSPpassword = CARRIER_DETAILS.CSPPassword || CARRIER_DETAILS.CSP_PASSWORD || process.env.FEDEX_CSPPASSWORD;
    const strlabeltype = CARRIER_DETAILS?.LABELTYPE === 'ZPL' ? 'ZPLII' : CARRIER_DETAILS?.LABELTYPE || 'PNG'

    try {
        const token = await getFedexToken(CARRIER_DETAILS.SHIPPING_ACCOUNT, tokenurl, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD);
        // const token = await getCSPFedexToken(tokenurl, CSPuserId, CSPpassword, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD, CARRIER_DETAILS.SHIPPING_ACCOUNT);
        let strHazMat = false
        const rateRequest = buildFedExFreightShipment(request)
        console.log("FedEx Freight Rate Request:")
        console.log(JSON.stringify(rateRequest))
        const response = await axiosInstance.post(
            rateurl,
            rateRequest,
            {
                headers: {
                    'content-type': 'application/json',
                    'authorization': `Bearer ${token}`
                }
            }
        );
        console.log('FEDEXFRT Rate Response is ..:');
        const rates = await processFedExRateResponse(request, response, request.CARRIER_DETAILS.SHIPPING_ACCOUNT, chargeCodes);
        return { status: 'Success', rates };
    } catch (error) {
        console.error('Error fetching FEDEXFRT rates:', error.response?.data || error.message);
        return reuse.handleErrorRes('FEDEXFRT', error);
    }

};


function buildFedExFreightShipment(request) {

    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER, BILLTO, INTERNATIONAL_DETAILS } = request;
    const strlabeltype = CARRIER_DETAILS?.LABELTYPE === 'ZPL' ? 'ZPLII' : CARRIER_DETAILS?.LABELTYPE || 'PNG'
    const shipDateStr = HEADER_INFO?.SHIP_DATE || new Date().toISOString();
    const [date, time] = shipDateStr.split('T')
    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES;
    const ratequote = {
        shipDatestamp: date,
        serviceType: CARRIER_DETAILS?.SERVICE_CODE,
        //  preferredCurrency: 'USD',
        totalPackageCount: PACKAGES.length,

        shipper: {
            address: buildAddress(SHIPPER)
        },
        recipient: {
            address: buildAddress(SHIPTO)
        },

        shippingChargesPayment: {
            paymentType: (CARRIER_DETAILS.PAYMENT_TYPE || 'SENDER').toUpperCase(),
            payor: {
                responsibleParty: {
                    accountNumber: {
                        value: CARRIER_DETAILS?.BILLING_ACCOUNT
                    }
                }
            }
        },

        freightShipmentDetail: {
            accountNumber: {
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
        ...((HEADER_INFO.TOTAL_WEIGHT) && { totalWeight: Number(HEADER_INFO.TOTAL_WEIGHT) })
    }


    return {
        accountNumber: {
            value: CARRIER_DETAILS.SHIPPING_ACCOUNT
        },
        rateRequestControlParameters: {
            returnTransitTimes: true
        },
        freightRequestedShipment: ratequote
    }
}


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
            //rateShop = reuse.handleSalesOrderRateRes('FEDEXFRT', accountNumber, element.serviceType, element.serviceName, accountObj.totalNetFedExCharge, listObj?.totalNetFedExCharge || '', element?.commit?.dateDetail?.dayFormat, element?.commit?.transitDays?.minimumTransitTime, accountObj.currency, request.HEADER_INFO.ShippingPoint, request.HEADER_INFO.SalesOrderDate)
            const rateShop = reuse.handleRateRes(
                'FEDEXFRT',
                accountNumber,
                element.serviceType,
                element.serviceName,
                accountObj.totalNetFedExCharge,
                listObj?.totalNetFedExCharge || '',
                expectedDeliveryDate,
                transitDays,
                accountObj.currency, request.HEADER_INFO.ShippingPoint, request.HEADER_INFO.SalesOrderDate
            );
            rateShop.surCharges = accountObj.shipmentRateDetail.surCharges.map((charge) => {
                const mappedCharge = {
                    type: charge.type,
                    description: charge.description,
                    amount: charge.amount,
                    currency: accountObj.currency
                };
                if (chargeCodes) {
                    mappedCharge.tmsChargeCode = reuse.getsapchargecode("FEDEXFRT", charge.type, chargeCodes);
                }
                return mappedCharge;
            });
            rateShop.surCharges.push(
                {
                    type: 'BASE',
                    description: 'Base Charge',
                    ...(chargeCodes && {
                        tmsChargeCode: reuse.getsapchargecode("FEDEXFRT", 'BASE', chargeCodes)
                    }),
                    amount: accountObj.totalBaseCharge,
                    currency: accountObj.currency
                }
            )
            rateShopResponse.push(rateShop);
        } catch (ex) {
            console.error('Error processing FEDEXFRT rate detail:', ex);
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
