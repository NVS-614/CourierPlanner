
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');

module.exports = async function purolatorRateAll(request) {
    const rateShopResponse = [];
    const chargeCodes = request?.chargeCodeData;
    try {
        const { raterequest, rateurl } = await buildpurolatorRequest(request);

        const response = await axios.post(rateurl, raterequest, {
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'SOAPAction': request.CARRIER_DETAILS.RATE_ACTION || process.env.PUROLATOR_RATE_ACTION,
                'Authorization': 'Basic ' + Buffer.from(`${request.CARRIER_DETAILS.USERID}:${request.CARRIER_DETAILS.PASSWORD}`).toString('base64')

            }
        });
        const Rateres = reuse.parseAndCleanXML(response.data);
        try {
            if (Rateres.Envelope.Body.GetFullEstimateResponse.ResponseInformation.Errors !== '') {
                console.log(' then erro : ' + JSON.stringify(Rateres.Envelope.Body.GetFullEstimateResponse.ResponseInformation.Errors));
                return reuse.handleErrorRes('purolator', Rateres.Envelope.Body.GetFullEstimateResponse.ResponseInformation.Errors?.Error?.DESCRIPTION);
            }
            else {
                let rateShop = {
                    CHARGE_DETAILS: []
                };
                try {
                    Rateres.Envelope.Body.GetFullEstimateResponse.ShipmentEstimates.ShipmentEstimate.forEach(element => {
                        rateShop = reuse.handleRateRes('purolator', request.CARRIER_DETAILS.SHIPPING_ACCOUNT, element.ServiceID, element.ServiceID, element.TotalPrice, element.TotalPrice, element.ExpectedDeliveryDate, element.EstimatedTransitDays, '');
                        const surcharges = [].concat(element.Surcharges?.Surcharge || []);
                        rateShop.CHARGE_DETAILS = surcharges.map((charge) => {
                            return reuse.handlesurCharRes("purolator", charge.Type, charge.Description, charge.Amount, '', chargeCodes);
                        });
                        rateShop.CHARGE_DETAILS.push(
                            reuse.handlesurCharRes("purolator", 'BASE', 'Base Charge', element.BasePrice, '', chargeCodes)
                        );
                        rateShopResponse.push(rateShop);
                    });

                } catch (error) {
                    console.log('success3', error.message);
                }

                return { status: 'Success', rates: rateShopResponse };
            }
        } catch (ex6) {
            return reuse.handleErrorRes('purolator', ex6);
        }
    } catch (error) {
        console.error('Error fetching purolator rates:', error.response?.data || error.message);
        if (error.response?.data) {
            error = reuse.parseAndCleanXML(error.response?.data || error.message);
            if (error.Envelope.Body.GetFullEstimateResponse.ResponseInformation.Errors !== '') {
                console.log(' then erro : ' + JSON.stringify(error.Envelope.Body.GetFullEstimateResponse.ResponseInformation.Errors));
                return reuse.handleErrorRes('purolator', error.Envelope.Body.GetFullEstimateResponse.ResponseInformation.Errors?.Error?.Description);
            }
        } else {
            error = error?.message
            return reuse.handleErrorRes('purolator', error);
        }
    }
};

async function buildpurolatorRequest(request) {

    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER, SHIPFROM, INTERNATIONAL_DETAILS } = request;

    const [date] = HEADER_INFO.SHIP_DATE.split('T');
    const rateurl = CARRIER_DETAILS.RATEURL || process.env.PUROLATOR_RATE;
    const totalweight = PACKAGES.reduce((sum, p) => sum + Number(p.Weight || 0), 0);
    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES;
    const { weightUnit, dimUnit } = getUnits(request.PACKAGES[0].WEIGHT_UNITS);
    let raterequest = '';
    raterequest += '<?xml version="1.0" encoding="UTF-8"?>';
    raterequest += '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/">';
    raterequest += '<soapenv:Header>';
    raterequest += '<RequestContext xmlns="http://purolator.com/pws/datatypes/v2">';
    raterequest += '<Version>2.0</Version>';
    raterequest += '<Language>en</Language>';
    raterequest += '<GroupID>1</GroupID>';
    raterequest += '<RequestReference>Purolator</RequestReference>';
    raterequest += '<UserToken>' + CARRIER_DETAILS?.ACCESS_KEY + '</UserToken>';
    raterequest += '</RequestContext>';
    raterequest += '</soapenv:Header>';
    raterequest += '<soapenv:Body>';
    raterequest += '<GetFullEstimateRequest xmlns="http://purolator.com/pws/datatypes/v2">';
    raterequest += '<Shipment>';
    raterequest += '<SenderInformation>';
    raterequest += '<Address>';
    raterequest += '<Name>' + SHIPPER.CONTACT + '</Name>';
    raterequest += '<Company>' + SHIPPER.COMPANY + '</Company>';
    raterequest += '<StreetNumber>' + SHIPPER.ADDRESS_LINE1 + '</StreetNumber>';
    raterequest += '<StreetName>' + SHIPPER.ADDRESS_LINE2 + '</StreetName>';
    raterequest += '<StreetAddress2>' + SHIPPER.ADDRESS_LINE3 + '</StreetAddress2>';
    raterequest += '<StreetAddress3>' + SHIPPER.ADDRESS_LINE3 + '</StreetAddress3>';
    raterequest += '<City>' + SHIPPER.CITY + '</City>';
    raterequest += '<Province>' + SHIPPER.STATE + '</Province>';
    raterequest += '<Country>' + SHIPPER.COUNTRY + '</Country>';
    raterequest += '<PostalCode>' + SHIPPER.ZIPCODE + '</PostalCode>';
    raterequest += '<PhoneNumber>';
    raterequest += '<CountryCode></CountryCode>';
    raterequest += '<AreaCode></AreaCode>';
    raterequest += '<Phone>' + SHIPPER.PHONE + '</Phone>';
    raterequest += '</PhoneNumber>';
    raterequest += '</Address>';
    raterequest += '</SenderInformation>';
    raterequest += '<ReceiverInformation>';
    raterequest += '<Address>';
    raterequest += '<Name>' + SHIPTO.CONTACT + '</Name>';
    raterequest += '<Company>' + SHIPTO.COMPANY + '</Company>';
    raterequest += '<StreetNumber>' + SHIPTO.ADDRESS_LINE3 + '</StreetNumber>';
    raterequest += '<StreetName>' + SHIPTO.ADDRESS_LINE1 + '</StreetName>';
    raterequest += '<StreetAddress2>' + SHIPTO.ADDRESS_LINE2 + '</StreetAddress2>';
    raterequest += '<StreetAddress3>' + SHIPTO.ADDRESS_LINE3 + '</StreetAddress3>';
    raterequest += '<City>' + SHIPTO.CITY + '</City>';
    raterequest += '<Province>' + SHIPTO.STATE + '</Province>';
    raterequest += '<Country>' + SHIPTO.COUNTRY + '</Country>';
    raterequest += '<PostalCode>' + SHIPTO.ZIPCODE + '</PostalCode>';
    raterequest += '<PhoneNumber>';
    raterequest += '<CountryCode></CountryCode>';
    raterequest += '<AreaCode></AreaCode>';
    raterequest += '<Phone>' + SHIPTO.PHONE + '</Phone>';
    raterequest += '</PhoneNumber>';
    raterequest += '</Address>';
    raterequest += '</ReceiverInformation>';
    raterequest += '<PackageInformation>';
    //based on packing type we need to pass ServiceID or call ServiceAvailabilityService API
    if (SHIPTO.COUNTRY === 'US') {
        raterequest += '<ServiceID>PurolatorExpressU.S.</ServiceID>';
    }
    else if (SHIPPER.COUNTRY !== SHIPTO.COUNTRY) {
        raterequest += '<ServiceID>PurolatorExpressInternational</ServiceID>';
    } else {
        raterequest += '<ServiceID>PurolatorExpress</ServiceID>';
    }

    raterequest += xmlTag('Description', CARRIER_DETAILS?.NOTE);
    raterequest += '<TotalWeight>';
    raterequest += '<Value>' + (HEADER_INFO?.TOTAL_WEIGHT || totalweight) + '</Value>';
    raterequest += '<WeightUnit>' + weightUnit + '</WeightUnit>';
    raterequest += '</TotalWeight>';
    raterequest += '<TotalPieces>' + PACKAGES.length + '</TotalPieces>';
    raterequest += '<OptionsInformation>';
    raterequest += '<Options>';

    if (reuse.isTrue(SLSS?.HAZMAT)) {
        raterequest += '<OptionIDValuePair>';
        raterequest += '<ID>DangerousGoods</ID>';
        raterequest += '<Value>TRUE</Value>';
        raterequest += '</OptionIDValuePair>';
        raterequest += '<OptionIDValuePair>';
        raterequest += '<ID>DangerousGoodsClass</ID>';
        raterequest += '<Value>LimitedQuantities</Value>';
        raterequest += '</OptionIDValuePair>';
        raterequest += '<OptionIDValuePair>';
        raterequest += '<ID>DangerousGoodsMode</ID>';
        raterequest += '<Value>Ground</Value>';
        raterequest += '</OptionIDValuePair>';
    }

    if (SLSS?.DECLARED_VALUE > 0) {
        raterequest += '<OptionIDValuePair>';
        raterequest += '<ID>DeclaredValue</ID>';
        raterequest += `<Value>${SLSS?.DECLARED_VALUE}</Value>`;
        raterequest += '</OptionIDValuePair>';
    }

    if (reuse.isTrue(SLSS?.HOLD_FOR_PICKUP)) {

        raterequest += '<OptionIDValuePair>';
        raterequest += '<ID>HoldForPickup</ID>';
        raterequest += '<Value>TRUE</Value>';
        raterequest += '</OptionIDValuePair>';
    }


    if (reuse.isTrue(SLSS?.SATURDAY_PICKUP)) {

        raterequest += '<OptionIDValuePair>';
        raterequest += '<ID>SaturdayPickup</ID>';
        raterequest += '<Value>TRUE</Value>';
        raterequest += '</OptionIDValuePair>';
    }
    if (reuse.isTrue(SLSS?.SATURDAY_DELIVERY)) {
        raterequest += '<OptionIDValuePair>';
        raterequest += '<ID>SaturdayDelivery</ID>';
        raterequest += '<Value>TRUE</Value>';
        raterequest += '</OptionIDValuePair>';
    }
    if (SLSS?.ExpressCheque) {

        raterequest += '<OptionIDValuePair>';
        raterequest += '<ID>ExpressCheque</ID>';
        raterequest += '<Value>TRUE</Value>';
        raterequest += '</OptionIDValuePair>';
        raterequest += '<OptionIDValuePair>';
        raterequest += '<ID>ExpressChequeMethodOfPayment</ID>';
        raterequest += '<Value>Cheque</Value>';
        raterequest += '</OptionIDValuePair>';
        raterequest += '<OptionIDValuePair>';
        raterequest += '<ID>ExpressChequeAmount</ID>';
        raterequest += '<Value>10</Value>';
        raterequest += '</OptionIDValuePair>';
    }
    if (SLSS?.SIGNATURE_OPTION_TYPE) {
        
            if (SLSS?.SIGNATURE_OPTION_TYPE === 'NO_SIGNATURE_REQUIRED') {
                raterequest += '<OptionIDValuePair>';
                raterequest += '<ID>OriginSignatureNotRequired</ID>';
                raterequest += '<Value>TRUE</Value>';
                raterequest += '</OptionIDValuePair>';
            }
            if (SLSS?.SIGNATURE_OPTION_TYPE === 'RESIDENTIAL_DOMESTIC') {
                raterequest += '<OptionIDValuePair>';
                raterequest += '<ID>ResidentialSignatureDomestic</ID>';
                raterequest += '<Value>TRUE</Value>';
                raterequest += '</OptionIDValuePair>';
            }
            if (SLSS?.SIGNATURE_OPTION_TYPE === 'INDIRECT') {
                raterequest += '<OptionIDValuePair>';
                raterequest += '<ID>ChainOfSignature</ID>';
                raterequest += '<Value>TRUE</Value>';
                raterequest += '</OptionIDValuePair>';
            }
            if (SLSS?.SIGNATURE_OPTION_TYPE === 'RESIDENTIAL_TNTL') {
                raterequest += '<OptionIDValuePair>';
                raterequest += '<ID>ResidentialSignatureIntl</ID>';
                raterequest += '<Value>TRUE</Value>';
                raterequest += '</OptionIDValuePair>';
            }
            if (SLSS?.SIGNATURE_OPTION_TYPE === 'ADULT') {
                raterequest += '<OptionIDValuePair>';
                raterequest += '<ID>AdultSignatureRequired</ID>';
                raterequest += '<Value>TRUE</Value>';
                raterequest += '</OptionIDValuePair>';
            }
        }
        if (reuse.isTrue(SLSS?.HEALTH_CARE)) {
            raterequest += '<OptionIDValuePair>';
            raterequest += '<ID>HealthCare</ID>';
            raterequest += '<Value>TRUE</Value>';
            raterequest += '</OptionIDValuePair>';
        }
        raterequest += '</Options>';
        raterequest += '</OptionsInformation>';
        raterequest += '<PiecesInformation>';

        try {
            PACKAGES.forEach(element => {
                raterequest += '<Piece>';
                raterequest += '<Weight>';
                raterequest += '<Value>' + element.WEIGHT + '</Value>';
                raterequest += '<WeightUnit>' + weightUnit + '</WeightUnit>';
                raterequest += '</Weight>';

                if (element.DIMENSION && element.DIMENSION !== "" && !element.DIMENSION.startsWith("0")) {
                    const dims = element.DIMENSION.toUpperCase().split('X');
                    raterequest += '<Length>';
                    raterequest += '<Value>' + Number(dims[0]) + '</Value>';
                    raterequest += '<DimensionUnit>' + dimUnit + '</DimensionUnit>';
                    raterequest += '</Length>';
                    raterequest += '<Width>';
                    raterequest += '<Value>' + Number(dims[1]) + '</Value>';
                    raterequest += '<DimensionUnit>' + dimUnit + '</DimensionUnit>';
                    raterequest += '</Width>';
                    raterequest += '<Height>';
                    raterequest += '<Value>' + Number(dims[2]) + '</Value>';
                    raterequest += '<DimensionUnit>' + dimUnit + '</DimensionUnit>';
                    raterequest += '</Height>';
                }

                raterequest += '</Piece>';
            });
        } catch (ex2) {
            // Handle exception if needed
        }

        raterequest += '</PiecesInformation>';
        raterequest += '</PackageInformation>';
        raterequest += '<PaymentInformation>';
        raterequest += '<PaymentType>' + CARRIER_DETAILS.PAYMENT_TYPE + '</PaymentType>';
        raterequest += '<RegisteredAccountNumber>' + CARRIER_DETAILS.SHIPPING_ACCOUNT + '</RegisteredAccountNumber>';
        //raterequest += CARRIER_DETAILS?.BILLING_ACCOUNT && `<BillingAccountNumber>${CARRIER_DETAILS.BILLING_ACCOUNT}</BillingAccountNumber>`;
        raterequest += xmlTag('BillingAccountNumber', CARRIER_DETAILS?.BILLING_ACCOUNT);

        raterequest += '</PaymentInformation>';
        raterequest += '<PickupInformation>';
        raterequest += '<PickupType>DropOff</PickupType>';
        raterequest += '</PickupInformation>';
        raterequest += '</Shipment>';
        raterequest += '<ShowAlternativeServicesIndicator>true</ShowAlternativeServicesIndicator>';
        raterequest += '</GetFullEstimateRequest>';
        raterequest += '</soapenv:Body>';
        raterequest += '</soapenv:Envelope>';

        console.log(raterequest);
        console.log(JSON.stringify(raterequest))
        return { raterequest, rateurl };
    };

    function xmlTag(tag, value) {
        return value ? `<${tag}>${value}</${tag}>` : '';
    }
    const getUnits = (w) => ({
        weightUnit: w?.toUpperCase().startsWith('K') ? 'kg' : 'lb',
        dimUnit: w?.toUpperCase().startsWith('K') ? 'cm' : 'in'
    });