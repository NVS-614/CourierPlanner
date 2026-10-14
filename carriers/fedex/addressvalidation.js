const express = require('express');
const router = express.Router();
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getFedexToken } = require('../../Reuse/fedex_token_manager.js');

router.post('/', async (request, response) => {
    // Set CORS headers
    response.header({
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Origin, X-Requested-With, Content-Type, Accept'
    });

    const { CARRIER_DETAILS, SHIPTO } = request.body.REQUEST;
    let Addresponse = {
        RESPONSE: {}
    };
    try {
        // Get API endpoints from request or use defaults
        const tokenUrl = CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;
        const addressUrl = CARRIER_DETAILS.ADDRESSURL || process.env.FEDEX_ADDRESS_VALIDATION;

        // Get valid token (from cache or new)
        const token = await getFedexToken(CARRIER_DETAILS.SHIPPING_ACCOUNT, tokenUrl, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD);

        // Prepare address validation request payload
        const addressValidationRequest = {
            validateAddressControlParameters: {
                includeResolutionTokens: true
            },
            addressesToValidate: [{
                address: {
                    streetLines: [SHIPTO.ADDRESS_LINE1, SHIPTO.ADDRESS_LINE2].filter(Boolean),
                    city: SHIPTO.CITY,
                    stateOrProvinceCode: SHIPTO.STATE,
                    postalCode: SHIPTO.ZIPCODE,
                    countryCode: SHIPTO.COUNTRY
                },
                contact: {
                    personName: SHIPTO.CONTACT,
                    companyName: SHIPTO.COMPANY,
                    phoneNumber: SHIPTO.PHONE
                }
            }]
        };

        // Make API call to validate address
        const avResponse = await axios.post(addressUrl, addressValidationRequest, {
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            }
        });

        // Process successful response
        const { output } = avResponse.data;
        console.log('Address Validation Response:', JSON.stringify(output, null, 2));

        output.resolvedAddresses.forEach(element => {
            Addresponse.RESPONSE.VERIFIEDADDRESS = {
                COMPANY: element.contact?.companyName,
                CONTACT: element.contact?.personName,
                ADDRESS_LINE1: element.streetLinesToken[0],
                ADDRESS_LINE2: element?.streetLinesToken[1] || SHIPTO.ADDRESS_LINE2,
                STATE: element.stateOrProvinceCode || '',
                CITY: element?.cityToken?.[0]?.value || '',
                ZIPCODE: element?.postalCodeToken?.value,
                COUNTRY: element.countryCode,
                PHONE: element.contact?.phoneNumber,
                CLASSIFICATION: element?.classification,
                RESOLVED: element?.attributes?.Resolved,
                NOTE: element?.customerMessages?.[0]?.code
            };
        });

        return response.status(200).json(Addresponse);

    } catch (error) {
        console.error('Error in address validation:', error?.response?.data || error.message);
        Addresponse.RESPONSE.STATUS = 'Error';
        Addresponse.RESPONSE.ERRORS = error.response
            ? reuse.handleShipErrorRes(error)
            : [error.message];
        return response.status(200).json(Addresponse);
    }
});

module.exports = router;