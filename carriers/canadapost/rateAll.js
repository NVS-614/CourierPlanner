const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');

const round2 = (val) => Number(parseFloat(val).toFixed(2));

module.exports = async function getCanadaPostRates(request) {

    const accountNumber = request.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    const rateurl = request.CARRIER_DETAILS.RATEURL || process.env.CANADAPOST_RATE;
    const [datePart] = request.HEADER_INFO.SHIP_DATE.split('T');

    try {

        /* ---------- RUN CANADA POST CALLS IN PARALLEL ---------- */

        const responses = await Promise.all(
            request.PACKAGES.map(async (pkg) => {

                let raterequest = '';
                raterequest += '<?xml version="1.0" encoding="UTF-8"?>';
                raterequest += '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v4="http://www.canadapost.ca/ws/soap/ship/rate/v4">';
                raterequest += '<soapenv:Header>';
                raterequest += '<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd" xmlns:wsu="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-utility-1.0.xsd">';
                raterequest += '<wsse:UsernameToken>';
                raterequest += `<wsse:Username>${request.CARRIER_DETAILS.USERID}</wsse:Username>`;
                raterequest += '<wsse:Password Type="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-username-token-profile-1.0#PasswordText">' + request.CARRIER_DETAILS.PASSWORD + '</wsse:Password>';

                raterequest += '</wsse:UsernameToken>';
                raterequest += '</wsse:Security>';
                raterequest += '</soapenv:Header>';

                raterequest += '<soapenv:Body>';
                raterequest += '<v4:get-rates-request>';
                raterequest += '<locale>EN</locale>';
                raterequest += '<mailing-scenario>';

                raterequest += `<customer-number>${accountNumber}</customer-number>`;
                raterequest += `<expected-mailing-date>${datePart}</expected-mailing-date>`;

                if (request.CARRIER_DETAILS?.ContractID) {
                    raterequest += `<contract-id>${request.CARRIER_DETAILS.ContractID}</contract-id>`;
                }

                raterequest += '<parcel-characteristics>';
                raterequest += `<weight>${pkg.WEIGHT}</weight>`;

                if (pkg?.DIMENSION && !pkg.DIMENSION.startsWith("0")) {
                    const dims = pkg.DIMENSION.toUpperCase().split('X');

                    if (dims.length === 3) {
                        raterequest += '<dimensions>';
                        raterequest += `<length>${Number(dims[0])}</length>`;
                        raterequest += `<width>${Number(dims[1])}</width>`;
                        raterequest += `<height>${Number(dims[2])}</height>`;
                        raterequest += '</dimensions>';
                    }
                }

                raterequest += '</parcel-characteristics>';
                raterequest += `<origin-postal-code>${request.SHIPPER.ZIPCODE}</origin-postal-code>`;

                raterequest += '<destination>';

                if (request.SHIPTO.COUNTRY === 'US') {
                    raterequest += '<united-states>';
                    raterequest += `<zip-code>${request.SHIPTO.ZIPCODE}</zip-code>`;
                    raterequest += '</united-states>';
                }
                else if (request.SHIPPER.COUNTRY !== request.SHIPTO.COUNTRY) {
                    raterequest += '<international>';
                    raterequest += `<country-code>${request.SHIPTO.COUNTRY}</country-code>`;
                    raterequest += `<postal-code>${request.SHIPTO.ZIPCODE}</postal-code>`;
                    raterequest += '</international>';
                }
                else {
                    raterequest += '<domestic>';
                    raterequest += `<postal-code>${request.SHIPTO.ZIPCODE}</postal-code>`;
                    raterequest += '</domestic>';
                }

                raterequest += '</destination>';
                raterequest += '</mailing-scenario>';
                raterequest += '</v4:get-rates-request>';
                raterequest += '</soapenv:Body>';
                raterequest += '</soapenv:Envelope>';

                console.log(raterequest)

                const res = await axios.post(rateurl, raterequest, {
                    headers: {
                        'Content-Type': 'text/xml;charset=UTF-8',
                        'SOAPAction': request.CARRIER_DETAILS.RATE_ACTION || process.env.CANADAPOST_RATE_ACTION
                    }
                });

                const rateRes = reuse.parseAndCleanXML(res.data);


                if (rateRes.Envelope.Body?.Fault) {
                    throw {
                        statusCode: rateRes.Envelope.Body.Fault?.faultcode || '',
                        message: rateRes.Envelope.Body.Fault.faultstring
                    };
                } else if (rateRes?.Envelope?.Body?.["get-rates-response"]?.messages) {
                    const errors = rateRes?.Envelope?.Body?.["get-rates-response"]?.messages.message;
                    throw {
                        statusCode: errors.code || '',
                        message: errors.description
                    };
                }


                const quotes = rateRes.Envelope.Body["get-rates-response"]["price-quotes"]["price-quote"];

                const packRates = [];

                quotes.forEach(element => {

                    let rate = {
                        CARRIER: 'CanadaPost',
                        ACCOUNT_NUMBER: accountNumber,
                        SERVICE_CODE: element["service-code"],
                        SERVICE_NAME: element["service-name"],
                        PUBLISHED_FREIGHT: element["price-details"].due,
                        DISCOUNTED_FREIGHT: element["price-details"].due,
                        CURRENCY: 'CAD',
                        CHARGE_DETAILS: []
                    };

                    if (element?.["service-standard"]) {
                        rate.TRANSIT_DAYS = element["service-standard"]["expected-transit-time"];
                        rate.EXPECTED_DELIVERY_DATE = element["service-standard"]["expected-delivery-date"];
                    }

                    const options = element?.["price-details"]?.options?.option;

                    if (options) {
                        const optionList = Array.isArray(options) ? options : [options];

                        optionList.forEach(opt => {
                            rate.CHARGE_DETAILS.push({
                                TYPE: opt["option-code"],
                                DESCRIPTION: opt["option-name"],
                                AMOUNT: opt["option-price"],
                                CURRENCY: ''
                            });
                        });
                    }

                    packRates.push(rate);

                });

                return packRates;

            })
        );

        /* ---------- FLATTEN ALL PACKAGE RESPONSES ---------- */

        const flattenedRates = responses.flat();

        /* ---------- CONSOLIDATE BY SERVICE ---------- */

        const resultArray = Object.values(
            flattenedRates.reduce((acc, curr) => {

                const { serviceCode, DISCOUNTED_FREIGHT, PUBLISHED_FREIGHT, CHARGE_DETAILS = [] } = curr;

                if (!acc[serviceCode]) {
                    acc[serviceCode] = {
                        ...curr,
                        DISCOUNTED_FREIGHT: 0,
                        PUBLISHED_FREIGHT: 0,
                        CHARGE_DETAILS: []
                    };
                }

                acc[serviceCode].DISCOUNTED_FREIGHT += parseFloat(DISCOUNTED_FREIGHT);
                acc[serviceCode].PUBLISHED_FREIGHT += parseFloat(PUBLISHED_FREIGHT);

                CHARGE_DETAILS.forEach(sc => {

                    const existing = acc[serviceCode].CHARGE_DETAILS.find(x => x.type === sc.type);

                    if (existing) {
                        existing.amount = round2(parseFloat(existing.amount) + parseFloat(sc.amount));
                    }
                    else {
                        acc[serviceCode].CHARGE_DETAILS.push({
                            ...sc,
                            amount: round2(sc.amount)
                        });
                    }

                });

                return acc;

            }, {})
        ).map(service => ({
            ...service,
            DISCOUNTED_FREIGHT: round2(service.DISCOUNTED_FREIGHT),
            PUBLISHED_FREIGHT: round2(service.PUBLISHED_FREIGHT)
        }));


        return { status: 'Success', rates: resultArray };

    }
    catch (ex4) {
        if (ex4.response) {
            const rateerr = reuse.parseAndCleanXML(ex4.response.data);
            return {
                status: 'Error',
                message: [{
                    CARRIER: 'CanadaPost',
                    STATUSCODE: rateerr.Envelope.Body.Fault?.faultcode || '',
                    MESSAGE: rateerr.Envelope.Body?.Fault?.faultstring || 'CanadaPost API Error'
                }]
            };

        }
        else {
            return {
                status: 'Error',
                message: [{
                    CARRIER: 'CanadaPost',
                    STATUSCODE: ex4.statusCode || '',
                    MESSAGE: ex4.message || 'CanadaPost API Error'
                }]
            };
        }


    }

}

