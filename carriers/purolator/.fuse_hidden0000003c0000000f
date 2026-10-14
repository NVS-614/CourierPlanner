const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildFinalResponse } = require('../../Reuse/responseBuilder');
const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});



module.exports = async (request) => {
    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER, INTERNATIONAL_DETAILS } = request;
    let FINALRESPONSE = buildFinalResponse(request);
    try {
        const user = safeValue(CARRIER_DETAILS.USERID);
        const password = safeValue(CARRIER_DETAILS.PASSWORD);
        const account = safeValue(CARRIER_DETAILS.SHIPPING_ACCOUNT);
        const url = safeValue(CARRIER_DETAILS.SHIPURL || CARRIER_DETAILS.ShipURL, process.env.PUROLATOR_SHIP);
        const labelurl = safeValue(CARRIER_DETAILS.LABELURL, process.env.PUROLATOR_LABEL);
        const rateurl = safeValue(CARRIER_DETAILS.RATEURL, process.env.PUROLATOR_RATE);
        const shipAction = safeValue(CARRIER_DETAILS.SHIP_KEY, process.env.PUROLATOR_SHIP_ACTION);
        const labelAction = safeValue(CARRIER_DETAILS.LABEL_KEY, process.env.PUROLATOR_LABEL_ACTION);
        const rateAction = safeValue(CARRIER_DETAILS.RATE_KEY, process.env.PUROLATOR_RATE_ACTION);
        const accessKey = safeValue(CARRIER_DETAILS.ACCESS_KEY);


        const { weightUnit, dimUnit } = getUnits(request.PACKAGES[0].WEIGHT_UNITS);
        const basicauth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');
        const service = request.CARRIER_DETAILS?.SERVICE_CODE || request.CARRIER_DETAILS?.SERVICE_NAME;

        // Safe extraction with defaults
        const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES;
        const intitemInfo = INTERNATIONAL_DETAILS?.ITEM_INFO || [];
        let currency = INTERNATIONAL_DETAILS?.CURRENCY || request.CARRIER_DETAILS?.CURRENCY || 'CAD';
        // Parse phone numbers safely
        const shipperPhone = parsePhoneNumber(SHIPPER.PHONE);
        const shipToPhone = parsePhoneNumber(SHIPTO.PHONE);
        const totalweight = PACKAGES.reduce((sum, p) => sum + Number(p.WEIGHT || 0), 0);
        // Build XML using template literals for better readability
        let shiprequest = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns="http://purolator.com/pws/datatypes/v2">
    <soapenv:Header>
        <RequestContext>
            <Version>2.0</Version>
            <Language>en</Language>
            <GroupID></GroupID>
            <RequestReference>Purolator</RequestReference>
            <UserToken>${accessKey}</UserToken>
        </RequestContext>
    </soapenv:Header>
    <soapenv:Body>
        <CreateShipmentRequest>
            <Shipment>
                <SenderInformation>
                    <Address>
                        <Name>${safeValue(SHIPPER.CONTACT, 'Sender')}</Name>
                        <Company>${safeValue(SHIPPER.COMPANY)}</Company>
                        <StreetNumber></StreetNumber>
                        <StreetName>${safeValue(SHIPPER.ADDRESS_LINE1)}</StreetName>
                        <StreetAddress2>${safeValue(SHIPPER.ADDRESS_LINE2)}</StreetAddress2>
                        <StreetAddress3>${safeValue(SHIPPER.ADDRESS_LINE3)}</StreetAddress3>
                        <City>${safeValue(SHIPPER.CITY)}</City>
                        <Province>${safeValue(SHIPPER.STATE)}</Province>
                        <Country>${safeValue(SHIPPER.COUNTRY)}</Country>
                        <PostalCode>${safeValue(SHIPPER.ZIPCODE)}</PostalCode>`;

        // Add phone number only if we have at least a country code
        if (shipperPhone.countryCode || shipperPhone.areaCode || shipperPhone.phoneNumber) {
            shiprequest += `
                        <PhoneNumber>
                            <CountryCode>${shipperPhone.countryCode}</CountryCode>
                            <AreaCode>${shipperPhone.areaCode}</AreaCode>
                            <Phone>${shipperPhone.phoneNumber}</Phone>
                            <Extension>${shipperPhone.extension}</Extension>
                        </PhoneNumber>`;
        }

        shiprequest += `
                    </Address>
                </SenderInformation>
                <ReceiverInformation>
                    <Address>
                        <Name>${safeValue(SHIPTO.CONTACT, 'Receiver')}</Name>
                        <Company>${safeValue(SHIPTO.COMPANY)}</Company>
                        <StreetNumber></StreetNumber>
                        <StreetName>${safeValue(SHIPTO.ADDRESS_LINE1)}</StreetName>
                        <StreetAddress2>${safeValue(SHIPTO.ADDRESS_LINE2)}</StreetAddress2>
                        <StreetAddress3>${safeValue(SHIPTO.ADDRESS_LINE3)}</StreetAddress3>
                        <City>${safeValue(SHIPTO.CITY)}</City>
                        <Province>${safeValue(SHIPTO.STATE)}</Province>
                        <Country>${safeValue(SHIPTO.COUNTRY)}</Country>
                        <PostalCode>${safeValue(SHIPTO.ZIPCODE)}</PostalCode>`;

        // Add phone number only if we have at least a country code
        if (shipToPhone.countryCode || shipToPhone.areaCode || shipToPhone.phoneNumber) {
            shiprequest += `
                        <PhoneNumber>
                            <CountryCode>${shipToPhone.countryCode}</CountryCode>
                            <AreaCode>${shipToPhone.areaCode}</AreaCode>
                            <Phone>${shipToPhone.phoneNumber}</Phone>
                            <Extension>${shipToPhone.extension}</Extension>
                        </PhoneNumber>`;
        }

        shiprequest += `
                    </Address>
                </ReceiverInformation>
                <ShipmentDate>${safeValue(HEADER_INFO.SHIP_DATE.split('T')[0])}</ShipmentDate>
                <PackageInformation>
                    <ServiceID>${safeValue(service)}</ServiceID>
                    <Description>${safeValue(CARRIER_DETAILS.NOTE)}</Description>
                    <TotalWeight>
                        <Value>${parseFloat(safeValue(HEADER_INFO.TOTAL_WEIGHT, '0')) || totalweight}</Value>
                        <WeightUnit>${weightUnit}</WeightUnit>
                    </TotalWeight>
                    <TotalPieces>${PACKAGES.length}</TotalPieces>
                    <PiecesInformation>`;

        // Add piece information for each package
        PACKAGES.forEach(element => {
            const weight = parseFloat(element.WEIGHT) || 0;
            const dimensions = parseDimensions(element.DIMENSION);

            shiprequest += `
                    <Piece>
                        <Weight>
                            <Value>${weight}</Value>
                            <WeightUnit>${weightUnit}</WeightUnit>
                        </Weight>`;

            if (dimensions) {
                shiprequest += `
                        <Length>
                            <Value>${dimensions.length}</Value>
                            <DimensionUnit>${dimUnit}</DimensionUnit>
                        </Length>
                        <Width>
                            <Value>${dimensions.width}</Value>
                            <DimensionUnit>${dimUnit}</DimensionUnit>
                        </Width>
                        <Height>
                            <Value>${dimensions.height}</Value>
                            <DimensionUnit>${dimUnit}</DimensionUnit>
                        </Height>`;
            }

            shiprequest += `
                    </Piece>`;
        });

        shiprequest += `</PiecesInformation></PackageInformation>`;

        // Add options information if there are special services
        const options = [];

        // Collect all options
        const dangerousGoodsOption = buildBooleanOption(SLSS?.HAZMAT, 'DangerousGoods');
        if (dangerousGoodsOption) options.push(dangerousGoodsOption);

        // Add other options...
        if (SLSS?.DECLARED_VALUE > 0) {
            options.push({ id: 'DeclaredValue', value: SLSS?.DECLARED_VALUE });
        }

        // Add other boolean options similarly...

        if (options.length > 0) {
            shiprequest += `
                <OptionsInformation>
                    <Options>`;

            options.forEach(option => {
                shiprequest += `
                        <OptionIDValuePair>
                            <ID>${option.id}</ID>
                            <Value>${option.value}</Value>
                        </OptionIDValuePair>`;
            });

            shiprequest += `
                    </Options>
                </OptionsInformation>`;
        }
        // Add international information if needed
        if (SHIPPER.COUNTRY !== SHIPTO.COUNTRY && intitemInfo.length > 0) {
            shiprequest += `
                <InternationalInformation>
                    <DocumentsOnlyIndicator>true</DocumentsOnlyIndicator>
                    <ContentDetails>`;

            intitemInfo.forEach(item => {
                shiprequest += `
                        <ContentDetail>
                            <Description>${safeValue(item.DESCRIPTION)}</Description>
                            <HarmonizedCode>${safeValue(item.HTS_CODE)}</HarmonizedCode>
                            <CountryOfManufacture>${safeValue(SHIPPER.COUNTRY)}</CountryOfManufacture>
                            <ProductCode>${safeValue(item.PRODUCT_NO)}</ProductCode>
                            <UnitValue>${parseFloat(safeValue(item.UNIT_COST, '0'))}</UnitValue>
                            <Quantity>${parseInt(safeValue(item.QUANTITY, '1'), 10)}</Quantity>
                        </ContentDetail>`;
            });

            shiprequest += `
                    </ContentDetails>
                    <DutyInformation>
                        <BillDutiesToParty>${safeValue(CARRIER_DETAILS.PAYMENT_TYPE)}</BillDutiesToParty>
                        <BusinessRelationship>NotRelated</BusinessRelationship>
                        <Currency>${currency}</Currency>
                    </DutyInformation>
                      <ImportExportType>Permanent</ImportExportType>
                      <CustomsInvoiceDocumentIndicator>true</CustomsInvoiceDocumentIndicator>
                </InternationalInformation>`;
        }

        // Add remaining sections
        shiprequest += `
                <PaymentInformation>
                    <PaymentType>${safeValue(CARRIER_DETAILS.PAYMENT_TYPE)}</PaymentType>
                    <RegisteredAccountNumber>${safeValue(CARRIER_DETAILS.SHIPPING_ACCOUNT)}</RegisteredAccountNumber>
                    <BillingAccountNumber>${safeValue(CARRIER_DETAILS.BILLING_ACCOUNT)}</BillingAccountNumber>
                </PaymentInformation>
                <PickupInformation>
                    <PickupType>DropOff</PickupType>
                </PickupInformation>
                <NotificationInformation>
                    <ConfirmationEmailAddress>${safeValue(SHIPTO.EMAIL)}</ConfirmationEmailAddress>
                    <AdvancedShippingNotificationEmailAddress1>${safeValue(SHIPTO.EMAIL)}</AdvancedShippingNotificationEmailAddress1>
                    <AdvancedShippingNotificationEmailAddress2>${safeValue(SHIPTO.EMAIL)}</AdvancedShippingNotificationEmailAddress2>
                </NotificationInformation>
                <TrackingReferenceInformation>
                    <Reference1>${safeValue(CARRIER_DETAILS.REFERENCE1)}</Reference1>
                    <Reference2>${safeValue(CARRIER_DETAILS.REFERENCE2)}</Reference2>
                    <Reference3>${safeValue(CARRIER_DETAILS.REFERENCE3)}</Reference3>
                </TrackingReferenceInformation>
                <OtherInformation>
                    <CostCentre></CostCentre>
                    <SpecialInstructions>${safeValue(CARRIER_DETAILS.NOTE || CARRIER_DETAILS.Note)}</SpecialInstructions>
                </OtherInformation>
            </Shipment>
            <PrinterType>Thermal</PrinterType>
        </CreateShipmentRequest>
    </soapenv:Body>
</soapenv:Envelope>`;


        // console.log('Ship Request:', shiprequest);

        // Make the API call
        const shipRes = await axiosInstance.post(url, shiprequest, {
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'SOAPAction': shipAction,
                'Authorization': basicauth
            },
        });

        console.log('Ship Response:', shipRes.data);
        const parsedResponse = reuse.parseAndCleanXML(shipRes.data);
        // Check for errors in response
        const responseInfo = parsedResponse?.Envelope?.Body?.CreateShipmentResponse?.ResponseInformation;
        if (responseInfo?.Errors?.Error) {
            FINALRESPONSE.STATUS = 'Error';
            FINALRESPONSE.ERRORS = handleErrorResponse(responseInfo?.Errors?.Error)
            return FINALRESPONSE;
        }

        // Process successful response
        const piecePINs = parsedResponse?.Envelope?.Body?.CreateShipmentResponse?.PiecePINs?.PIN;
        if (piecePINs) {
            const pins = Array.isArray(piecePINs) ? piecePINs : [piecePINs];
            FINALRESPONSE.STATUS = 'Success';
            FINALRESPONSE.TRACKING_STATUS = 'Shipped';
            // Update tracking numbers
            pins.forEach(pin => {
                FINALRESPONSE.PACKAGES.push({ TRACKING_NUMBER: pin.Value || '' });
            });
            const trackingNo = FINALRESPONSE.PACKAGES[0]?.TRACKING_NUMBER;
            FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = FINALRESPONSE.PACKAGES[0]?.TRACKING_NUMBER;

            // Get labels
            try {
                await getLabels(request, basicauth, labelurl, labelAction, accessKey, FINALRESPONSE);

            } catch (error) {

            }
            try {
                await GetPurolatorrates(request, shiprequest, rateurl, basicauth, rateAction, FINALRESPONSE, currency)
            } catch (error) {

            }


            return FINALRESPONSE;

        } else {
            FINALRESPONSE.STATUS = 'Error';
            FINALRESPONSE.ERRORS = ['No tracking numbers received from shipping service']
            return FINALRESPONSE;
        }

    } catch (error) {
        console.error('Error fetching purolator rates:', error.response?.data || error.message);
        FINALRESPONSE.STATUS = 'Error';
        if (error.response?.data) {
            error = reuse.parseAndCleanXML(error.response?.data || error.message);
            if (error.Envelope.Body.GetFullEstimateResponse.ResponseInformation.Errors !== '') {
                console.log(' then erro : ' + JSON.stringify(error.Envelope.Body.GetFullEstimateResponse.ResponseInformation.Errors));
                FINALRESPONSE.ERRORS = handleErrorResponse(error.Envelope.Body.GetFullEstimateResponse.ResponseInformation.Errors?.Error?.Description);
            }
        } else {
            error = error?.message
            FINALRESPONSE.ERRORS = handleErrorResponse(error);

        }
        return FINALRESPONSE;
    }
};

// Function to get labels
async function getLabels(request, basicauth, labelurl, labelAction, accessKey, FINALRESPONSE) {
    try {
        // Build label request
        let LabelRequest = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v1="http://purolator.com/pws/datatypes/v1">
    <soapenv:Header>
        <v1:RequestContext>
            <v1:Version>1.3</v1:Version>
            <v1:Language>en</v1:Language>
            <v1:GroupID></v1:GroupID>
            <v1:RequestReference>Purolator</v1:RequestReference>
            <v1:UserToken>${accessKey}</v1:UserToken>
        </v1:RequestContext>
    </soapenv:Header>
    <soapenv:Body>
        <v1:GetDocumentsRequest>
            <v1:Synchronous>true</v1:Synchronous>
            <v1:DocumentCriterium>`;

        FINALRESPONSE.PACKAGES.forEach(element => {
            if (element.TRACKING_NUMBER) {
                LabelRequest += `
                <v1:DocumentCriteria>
                    <v1:PIN>
                        <v1:Value>${element.TRACKING_NUMBER}</v1:Value>
                    </v1:PIN>
                    <v1:DocumentTypes>
                        <v1:DocumentType>DomesticBillOfLadingThermal</v1:DocumentType>
                    </v1:DocumentTypes>
                </v1:DocumentCriteria>`;
            }
        });

        LabelRequest += `
            </v1:DocumentCriterium>
        </v1:GetDocumentsRequest>
    </soapenv:Body>
</soapenv:Envelope>`;

        // console.log('Label Request:', LabelRequest);

        const LabelRes = await axios.post(labelurl, LabelRequest, {
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'SOAPAction': labelAction,
                'Authorization': basicauth
            },
        });

        console.log('Label Response received');
        const parsedLabelRes = reuse.parseAndCleanXML(LabelRes.data);
        const documents = parsedLabelRes?.Envelope?.Body?.GetDocumentsResponse?.Documents?.Document;


        if (documents) {
            const docArray = Array.isArray(documents) ? documents : [documents];
            docArray.forEach(element => {
                const docName = `${element?.PIN?.Value}.PDF`;
                const docDetail = element?.DocumentDetails?.DocumentDetail;
                if (docDetail?.Data) {
                    const formatDoc = reuse.formatShipDoc('PUROLATOR', 'Label', 1, docName, docDetail.Data, 'PDF');
                    FINALRESPONSE.SHIPPING_DOCUMENTS.push(formatDoc);
                }
            });
        }

    } catch (error) {
        console.error('Error getting labels:', error);
        if (error.response?.data) {
            const parsedLabelRes = reuse.parseAndCleanXML(error.response.data);
            FINALRESPONSE.ERRORS = handleErrorResponse(parsedLabelRes);

        } else {
            FINALRESPONSE.ERRORS.push(error.message || 'Failed to get shipping labels');
        }

    }
}
async function GetPurolatorrates(request, shiprequest, rateurl, basicauth, rateAction, FINALRESPONSE, currency) {
    try {
        let raterequest = shiprequest.replace(/CreateShipmentRequest/g, 'GetFullEstimateRequest');
        raterequest = raterequest.replace('<PrinterType>Thermal</PrinterType>', '<ShowAlternativeServicesIndicator>false</ShowAlternativeServicesIndicator>');
        // console.log('Puro Rate Request is', raterequest)

        const Rateresult = await axios.post(rateurl, raterequest,
            {
                headers: {
                    'Content-Type': 'text/xml;charset=UTF-8',
                    'SOAPAction': rateAction,
                    'Authorization': basicauth
                },
            });

        //  console.log('Rate Response received', Rateresult.data);
        // Parse rate response
        const Rateres = reuse.parseAndCleanXML(Rateresult.data);
        let totalFreight = parseFloat(Rateres?.Envelope?.Body?.GetFullEstimateResponse?.ShipmentEstimates?.ShipmentEstimate?.TotalPrice)
        let BasePrice = parseFloat(Rateres?.Envelope?.Body?.GetFullEstimateResponse?.ShipmentEstimates?.ShipmentEstimate?.BasePrice)

        FINALRESPONSE.DISCOUNTED_FREIGHT = totalFreight.toString();
        FINALRESPONSE.PUBLISHED_FREIGHT = totalFreight.toString();
        FINALRESPONSE.CURRENCY = currency;
        FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipRateRes('Base Charge', BasePrice, currency, 'Base'));
        let SurchargesRaw = Rateres?.Envelope?.Body?.GetFullEstimateResponse?.ShipmentEstimates?.ShipmentEstimate?.Surcharges?.Surcharge;
        let Surcharges = Array.isArray(SurchargesRaw)
            ? SurchargesRaw
            : SurchargesRaw
                ? [SurchargesRaw]
                : [];

        Surcharges.forEach(acc => {
            FINALRESPONSE.CHARGE_DETAILS.push(
                reuse.ShipRateRes(
                    acc.Description,
                    parseFloat(acc.Amount),
                    currency,
                    acc.Type
                )
            );
        });


    } catch (error) {
        console.error('Error getting labels:', error);
        if (error.response?.data) {
            try {
                const parsedError = reuse.parseAndCleanXML(error.response.data);
                FINALRESPONSE.ERRORS = handleErrorResponse(parsedError);
            } catch (parseError) {
                FINALRESPONSE.ERRORS.push('Failed to parse error response from label service');
            }
        } else {
            FINALRESPONSE.ERRORS.push(error.message || 'Failed to get shipping labels');
        }
        return ''
    }

};

const handleErrorResponse = (parsedError) => {
    const fault = parsedError?.Envelope?.Body?.Fault;
    if (fault?.faultstring) {
        return fault.faultstring;
    }
    else {
        const errors = Array.isArray(parsedError)
            ? parsedError.map(err => err.Description || err.Code || 'Unknown error')
            : [parsedError.Description || parsedError.Code || 'Unknown error'];
        return errors;
    }
};

const getUnits = (w) => ({
    weightUnit: w?.toUpperCase().startsWith('K') ? 'kg' : 'lb',
    dimUnit: w?.toUpperCase().startsWith('K') ? 'cm' : 'in'
});
// Helper function to safely build XML nodes
const safeValue = (value, defaultValue = '') => {
    if (value === null || value === undefined || value === '') {
        return defaultValue;
    }
    return String(value);
};

// Helper function to parse phone number safely
const parsePhoneNumber = (phone) => {
    if (!phone || typeof phone !== 'string') {
        return {
            countryCode: '',
            areaCode: '',
            phoneNumber: '',
            extension: '0000'
        };
    }

    const cleanPhone = phone.replace(/\D/g, '');

    return {
        countryCode: '001',                          // Hardcoded
        areaCode: cleanPhone.substring(0, 3),        // First 3 digits
        phoneNumber: cleanPhone.substring(3).padEnd(7, '0'), // Remaining 7 digits padded
        extension: '0000'
    };
};

// Helper function to safely split dimensions
const parseDimensions = (dimension) => {
    if (!dimension || typeof dimension !== 'string' ||
        dimension.toLowerCase() === '0' ||
        dimension.toLowerCase().startsWith('0') ||
        dimension.trim() === '') {
        return null;
    }

    const dims = dimension.toUpperCase().split('X').map(d => {
        const num = Number(d.trim());
        return isNaN(num) ? 0 : num;
    });

    if (dims.length < 3) return null;

    return {
        length: dims[0],
        width: dims[1],
        height: dims[2]
    };
};

// Helper function to build boolean option
const buildBooleanOption = (value, optionName) => {
    if (String(value).toUpperCase() === 'TRUE') {
        return {
            id: optionName,
            value: 'TRUE'
        };
    }
    return null;
};