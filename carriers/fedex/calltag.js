// carriers/fedex/return.js
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getFedexToken } = require('../../Reuse/fedex_token_manager.js');
const Getcode = require('../../Reuse/ServicesandCodes.js');

const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});


async function calltag(request) {

    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER, SHIPFROM, INTERNATIONAL_DETAILS } = request;
    // Resolve hold-at-location address from top-level request object (canonical pattern)
    const holdaddress = request.HOLD_AT_LOCATION?.ZIPCODE ? request.HOLD_AT_LOCATION : SHIPTO;
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
    let ShipAction = 'CONFIRM';
    let strHazMat = false
    const { weightUnit, dimUnit } = getUnits(PACKAGES?.[0]?.WEIGHT_UNITS);
    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES || {};
    const tokenurl = CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;
    let shipurl = CARRIER_DETAILS.SHIPURL || process.env.FEDEX_SHIP;
    const labelType = CARRIER_DETAILS?.LABELTYPE || 'PDF';
    const CSPuserId = CARRIER_DETAILS.CSPUserId || CARRIER_DETAILS.CSP_USER || process.env.FEDEX_CSPUSER;
    const CSPpassword = CARRIER_DETAILS.CSPPassword || CARRIER_DETAILS.CSP_PASSWORD || process.env.FEDEX_CSPPASSWORD;
    // Tag-specific endpoint overrides shipurl for FEDEX_TAG return shipments
    shipurl = CARRIER_DETAILS.TAGURL || process.env.FEDEX_TAG;

  const returnShip = SLSS?.RETURN_SHIP;

    try {

        const token = await getFedexToken(CARRIER_DETAILS.SHIPPING_ACCOUNT, tokenurl, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD);
        // const token = await getCSPFedexToken(tokenurl, CSPuserId, CSPpassword, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD, CARRIER_DETAILS.SHIPPING_ACCOUNT);

        if (SLSS?.HOME_DELIVERY?.PREMIUM_TYPE) {
            SHIPTO.ADDRESS_TYPE = "RESIDENTIAL";
        };
        const service = CARRIER_DETAILS?.SERVICE_CODE || CARRIER_DETAILS?.SERVICE_NAME;

        const paymentTypeRaw = CARRIER_DETAILS.PAYMENT_TYPE || '';
        const paymentTypeUpper = paymentTypeRaw.toUpperCase();

        const isThirdRecipientCollect =
            /THIRD|3RD/.test(paymentTypeUpper) ||
            paymentTypeUpper === 'RECIPIENT' ||
            paymentTypeUpper === 'COLLECT';

        const shippingChargesPayment = {
            paymentType: /THIRD|3RD/.test(paymentTypeUpper)
                ? 'THIRD_PARTY'
                : paymentTypeUpper,

            ...(isThirdRecipientCollect
                ? {
                    payor: {
                        responsibleParty: {
                            address: {
                                countryCode: CARRIER_DETAILS?.BILLING_COUNTRY,
                                postalCode: CARRIER_DETAILS?.BILLING_ZIPCODE
                            },
                            accountNumber: {
                                value: CARRIER_DETAILS?.BILLING_ACCOUNT
                            }
                        }
                    }
                }
                : {
                    payor: {
                        responsibleParty: {
                            accountNumber: {
                                value: CARRIER_DETAILS.SHIPPING_ACCOUNT
                            }
                        }
                    }
                })
        };


        const shiprequest = {
            accountNumber: { value: CARRIER_DETAILS.SHIPPING_ACCOUNT },
            shipAction: ShipAction,
            // processingOptionType: 'ALLOW_ASYNCHRONOUS',
            oneLabelAtATime: false,
            mergeLabelDocOption: 'LABELS_AND_DOCS',
            labelResponseOptions: 'LABEL',
            requestedShipment: {
                shipDatestamp: (HEADER_INFO?.SHIP_DATE || new Date().toISOString()).split('T')[0],
                shipper: buildAddress(SHIPPER),
                origin: buildAddress(SHIPFROM ?? SHIPPER),
                recipients: [buildAddress(SHIPTO)],
                //residential: service.toUpperCase() === "FEDEX_GROUND" ? false : shipmentData.SHIPTO?.AddressType === "RESIDENTIAL"
                pickupType: CARRIER_DETAILS.PICKUP_TYPE || 'USE_SCHEDULED_PICKUP',
                serviceType: service,
                packagingType: HEADER_INFO.PACKAGING_TYPE || 'YOUR_PACKAGING',
                totalWeight: HEADER_INFO?.TOTAL_WEIGHT,
                shippingChargesPayment,
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
                ...(SLSS?.EMAIL_NOTIFICATION && {
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
                                notificationEventType: SLSS.EMAIL_NOTIFICATION.EVENT_TYPES || ['ON_DELIVERY']
                            }
                        ]
                    }
                }),

                ...(SHIPPER.COUNTRY !== SHIPTO.COUNTRY && {
                    customsClearanceDetail: {
                        // Broker details
                        ...(INTERNATIONAL_DETAILS?.BROKER_ADDRESS?.COUNTRY && {
                            brokers: [{
                                broker: {
                                    address: {
                                        streetLines: [
                                            INTERNATIONAL_DETAILS.BROKER_ADDRESS.ADDRESS_LINE1,
                                            INTERNATIONAL_DETAILS.BROKER_ADDRESS.ADDRESS_LINE2,
                                            INTERNATIONAL_DETAILS.BROKER_ADDRESS.ADDRESS_LINE3
                                        ].filter(line => line),
                                        city: INTERNATIONAL_DETAILS.BROKER_ADDRESS.CITY,
                                        stateOrProvinceCode: INTERNATIONAL_DETAILS.BROKER_ADDRESS.STATE,
                                        postalCode: INTERNATIONAL_DETAILS.BROKER_ADDRESS.ZIPCODE,
                                        countryCode: INTERNATIONAL_DETAILS.BROKER_ADDRESS.COUNTRY
                                    },
                                    contact: {
                                        personName: INTERNATIONAL_DETAILS.BROKER_ADDRESS.CONTACT,
                                        emailAddress: INTERNATIONAL_DETAILS.BROKER_ADDRESS.EMAIL,
                                        phoneNumber: reuse.validatePhNo(INTERNATIONAL_DETAILS.BROKER_ADDRESS.PHONE),
                                        companyName: INTERNATIONAL_DETAILS.BROKER_ADDRESS.COMPANY
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
                                value: Number(item.ITEM_WEIGHT)
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
                        ...(SLSS?.INSURANCE_AMOUNT && {
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

        /* PACKAGE */
        shiprequest.requestedShipment.rateRequestType = ["LIST", "ACCOUNT"];
        shiprequest.requestedShipment.requestedPackageLineItems = PACKAGES.map((element, index) => {
            const xpackage = {
                itemDescription: element?.DESCRIPTION || 'commodities',
                weight: {
                    value: Number(element.WEIGHT),
                    units: weightUnit
                },
                customerReferences: createCustomerReferences(CARRIER_DETAILS),
                ...((element.PACKING_TYPE) && { subPackagingType: element.PACKING_TYPE }),
                //contentRecord: createContentRecords(element.ItemsInfo || []),
                sequenceNumber: index,
                dimensions: createDimensions(element.DIMENSION, dimUnit),
                packageSpecialServices: createPackageSpecialServices(element.PACKAGE_LVL_SPECIAL_SERVICES, SLSS)
            };

            return xpackage;
        });

        /* SHIPMENT SPECIAL SERVICES */

        try {
            shiprequest.requestedShipment.shipmentSpecialServices =
                createShipmentSpecialServices(SLSS, holdaddress);
        } catch (ex) { }

        try {
            const shipmentSS = shiprequest.requestedShipment.shipmentSpecialServices;

            shipmentSS.specialServiceTypes.push('RETURN_SHIPMENT');
            shipmentSS.returnShipmentDetail = {
                returnType: 'FEDEX_TAG',
                rma: {
                    reason: returnShip?.REASON
                }
            };

            // Return Email Details
            if (returnShip?.PHONE) {
                shipmentSS.returnShipmentDetail.returnEmailDetail = {
                    merchantPhoneNumber: returnShip.PHONE
                };

                if (returnShip?.SPECIAL_SERVICE) {
                    shipmentSS.returnShipmentDetail.returnEmailDetail.allowedSpecialService = [
                        returnShip.SPECIAL_SERVICE
                    ];
                }
            }

          

        } catch (ex) { }
        shiprequest.shipAction = ShipAction;

        shiprequest.requestedShipment.pickupDetail = {
            readyPickupDateTime: returnShip?.READY_TIME || HEADER_INFO.SHIP_DATE,
            latestPickupDateTime: returnShip?.CLOSE_TIME || HEADER_INFO.SHIP_DATE
        }


        console.log('FedEx Ship Request is')
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
        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Return Shipped';
        PACKAGES.forEach((piece) => {
            FINALRESPONSE.PACKAGES.push({ RETURN_TRACKING_NUMBER: sres.data.output.masterTrackingNumber });
        });
        FINALRESPONSE.HEADER_INFO.MASTER_RETURN_TRACKING_NUMBER = sres.data.output.masterTrackingNumber;
        return FINALRESPONSE;

    }
    catch (ex) {
        console.error("FedEx Ship Error:", ex?.response?.data || ex.message);
        FINALRESPONSE.STATUS = 'Error';
        FINALRESPONSE.ERRORS = reuse.handleShipErrorRes(ex);
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
        ...((data?.ADDRESS_TYPE || data?.AddressType) && { residential: (data?.ADDRESS_TYPE || data?.AddressType).toUpperCase() === "RESIDENTIAL" })
    },
    contact: {
        companyName: data.COMPANY,
        personName: data.CONTACT,
        emailAddress: data.EMAIL,
        phoneNumber: reuse.validatePhNo(data.PHONE)
    }
});
const createCustomerReferences = (carrierDetails) => {
    return [
        { customerReferenceType: 'INVOICE_NUMBER', value: carrierDetails.REFERENCE1 },
        { customerReferenceType: 'CUSTOMER_REFERENCE', value: carrierDetails.REFERENCE2 || carrierDetails.Reference2 },
        { customerReferenceType: 'P_O_NUMBER', value: carrierDetails.REFERENCE3 },
        { customerReferenceType: 'P_O_NUMBER', value: carrierDetails.NOTE || carrierDetails.Note }
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
        // CANONICAL PATTERN: SLSS.HOLD_AT_LOCATION = boolean flag,
        // address comes from top-level request.HOLD_AT_LOCATION (passed in as holdaddress).
        ...(SLSS?.HOLD_AT_LOCATION && holdaddress && {
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
        ...(SLSS?.DRY_ICE?.WEIGHT && {
            shipmentDryIceDetail: {
                // BUGFIX: was `SLSS.DryIce.NumberOfPackages` (wrong casing → would throw)
                packageCount: Number(SLSS.DRY_ICE?.QUANTITY) || 1,
                totalWeight: {
                    units: SLSS.DRY_ICE.WEIGHT_UNITS?.toUpperCase() || 'KG',
                    value: Number(SLSS.DRY_ICE.WEIGHT)
                }
            }
        }),

        ...(SLSS?.HOME_DELIVERY?.PREMIUM_TYPE && {
            homeDeliveryPremiumDetail: {
                phoneNumber: {
                    areaCode: SLSS.HOME_DELIVERY?.AREA_CODE || '',
                    localNumber: reuse.validatePhNo(SLSS.HOME_DELIVERY.PHONE)
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
    // First 3 → validate required fields properly

    // SLSS.HOLD_AT_LOCATION is now a boolean flag (canonical pattern)
    if (isTrue(SLSS?.HOLD_AT_LOCATION) || SLSS?.HOLD_AT_LOCATION === true) {
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

    if (isTrue(SLSS?.EMAIL_NOTIFICATION))
        shipmentSpecialServices.specialServiceTypes.push('EVENT_NOTIFICATION');
    if (isTrue(SLSS?.RESIDENTIAL_DELIVERY))
        shipmentSpecialServices.specialServiceTypes.push('RESIDENTIAL_DELIVERY');
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
        ...(PLSS?.PRIORITY_ALERT && { priorityAlertDetail: {} }),
        ...(PLSS?.PRIORITY_ALERT_PLUS && {
            priorityAlertDetail: {
                enhancementTypes: ['PRIORITY_ALERT_PLUS'],
                content: [PLSS?.PRIORITY_ALERT_PLUS_CONTENT || '']
            }
        }),
        ...((SLSS?.SIGNATURE_OPTION_TYPE || PLSS?.SIGNATURE_OPTION_TYPE) && {
            signatureOptionType: SignatureMap(SLSS?.SIGNATURE_OPTION_TYPE || PLSS?.SIGNATURE_OPTION_TYPE)
        }),
        ...(PLSS?.ALCOHOL && {
            alcoholDetail: {
                alcoholRecipientType: PLSS.ALCOHOL?.RECIPIENT_TYPE,
                shipperAgreementType: PLSS.ALCOHOL?.SHIPPER_AGREEMENT_TYPE
            }
        }),
        ...(PLSS?.DRY_ICE?.WEIGHT && {
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
    // Add special service types based on conditions — these are objects, not booleans
    if (isTrue(PLSS?.PRIORITY_ALERT) || isTrue(PLSS?.PRIORITY_ALERT_PLUS)) { specialServices.specialServiceTypes.push('PRIORITY_ALERT'); }
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

module.exports = { calltag }