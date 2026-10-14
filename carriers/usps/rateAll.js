const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');

const round2 = (val) => Number(parseFloat(val).toFixed(2));

module.exports = async function getUSPSRates(request) {
    const accountNumber = request.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    const password = request.CARRIER_DETAILS.PASSWORD;
    const requesterID = request.CARRIER_DETAILS.REQUESTER_ID || process.env.USPS_REQUESTER_ID;
    const rateurl = request.CARRIER_DETAILS.RATEURL || process.env.USPS_RATE;
    const rateAction = request.CARRIER_DETAILS.RATE_ACTION || process.env.USPS_RATE_ACTION;
    const currency = request.CARRIER_DETAILS.CURRENCY || 'USD';

    try {
        /* ---------- RUN USPS CALLS IN PARALLEL ---------- */
        const responses = await Promise.all(
            request.PACKAGES.map(async (pkg) => {
                // Convert weight to ounces
                let WeightOz = 0;
                const wu = (pkg.WEIGHT_UNITS || '').toUpperCase();
                if (wu === 'LBS' || wu === 'LB') {
                    // 1 LB = 16 oz exactly (was 15.9 — under-billed every shipment by ~0.6%)
                    WeightOz = Number(pkg.WEIGHT * 16);
                } else if (wu === 'KGS' || wu === 'KG') {
                    WeightOz = Number(pkg.WEIGHT * 35.274);
                } else {
                    WeightOz = Number(pkg.WEIGHT || 0);
                }

                // Build XML request
                let raterequest = '';
                raterequest += '<?xml version="1.0" encoding="UTF-8"?>';
                raterequest += '<soap:Envelope xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">';
                raterequest += '<soap:Body>';
                raterequest += '<CalculatePostageRates xmlns="www.envmgr.com/LabelService">';
                raterequest += '<PostageRatesRequest ResponseVersion="0">';
                raterequest += `<RequesterID>${requesterID}</RequesterID>`;
                raterequest += '<CertifiedIntermediary>';
                raterequest += `<AccountID>${accountNumber}</AccountID>`;
                raterequest += `<PassPhrase>${password}</PassPhrase>`;
                raterequest += '</CertifiedIntermediary>';

                if (request.SHIPPER.COUNTRY === request.SHIPTO.COUNTRY) {
                    raterequest += '<MailClass>Domestic</MailClass>';
                } else {
                    raterequest += '<MailClass>International</MailClass>';
                }

                raterequest += `<WeightOz>${WeightOz}</WeightOz>`;
                raterequest += `<MailpieceShape>${pkg.PACKING_TYPE || 'Parcel'}</MailpieceShape>`;

                if (pkg?.DIMENSION && !pkg.DIMENSION.startsWith('0') && pkg.DIMENSION !== '') {
                    const dims = pkg.DIMENSION.toUpperCase().split('X');
                    raterequest += '<MailpieceDimensions>';
                    raterequest += `<Length>${Number(dims[0])}</Length>`;
                    raterequest += `<Width>${Number(dims[1])}</Width>`;
                    raterequest += `<Height>${Number(dims[2])}</Height>`;
                    raterequest += '</MailpieceDimensions>';
                }

                raterequest += '<Machinable>True</Machinable>';
                raterequest += '<Services DeliveryConfirmation="ON" SignatureConfirmation="ON"/>';
                raterequest += `<ToPostalCode>${request.SHIPTO.ZIPCODE?.substring(0, 5) || ''}</ToPostalCode>`;
                raterequest += `<ToCountry>${request.SHIPTO.COUNTRY || ''}</ToCountry>`;
                raterequest += `<ToCountryCode>${request.SHIPTO.COUNTRY || ''}</ToCountryCode>`;
                raterequest += `<FromPostalCode>${request.SHIPPER.ZIPCODE?.substring(0, 5) || ''}</FromPostalCode>`;
                raterequest += '<DateAdvance>0</DateAdvance>';
                raterequest += '<DeliveryTimeDays>TRUE</DeliveryTimeDays>';
                raterequest += '<EstimatedDeliveryDate>TRUE</EstimatedDeliveryDate>';
                raterequest += '</PostageRatesRequest>';
                raterequest += '</CalculatePostageRates>';
                raterequest += '</soap:Body>';
                raterequest += '</soap:Envelope>';

                console.log(raterequest);

                const res = await axios.post(rateurl, raterequest, {
                    headers: {
                        'Content-Type': 'text/xml;charset=UTF-8',
                        'SOAPAction': rateAction
                    }
                });

                const rateRes = reuse.parseAndCleanXML(res.data);

                if (rateRes.Envelope.Body?.Fault) {
                    throw {
                        statusCode: rateRes.Envelope.Body.Fault?.faultcode || '',
                        message: rateRes.Envelope.Body.Fault.faultstring
                    };
                }

                const postageResponse = rateRes?.Envelope?.Body?.CalculatePostageRatesResponse?.PostageRatesResponse;

                if (!postageResponse || postageResponse.Status != '0') {
                    throw {
                        statusCode: postageResponse?.Status || '',
                        message: postageResponse?.ErrorMessage || 'USPS API Error'
                    };
                }

                const quotesRaw = postageResponse.PostagePrice;
                const quotes = Array.isArray(quotesRaw) ? quotesRaw : (quotesRaw ? [quotesRaw] : []);
                const packRates = [];

                quotes.forEach(element => {
                    const rate = {
                        CARRIER: 'USPS',
                        ACCOUNT_NUMBER: accountNumber,
                        SERVICE_CODE: element.MailClass,
                        SERVICE_NAME: element?.Postage?.MailService || element.MailClass,
                        PUBLISHED_FREIGHT: element?.["$"]?.TotalAmount || element?.$?.TotalAmount || '0',
                        DISCOUNTED_FREIGHT: element?.["$"]?.TotalAmount || element?.$?.TotalAmount || '0',
                        CURRENCY: currency,
                        CHARGE_DETAILS: []
                    };

                    if (element?.DeliveryTimeDays) {
                        rate.TRANSIT_DAYS = element.DeliveryTimeDays;
                    }
                    if (element?.EstimatedDeliveryDate) {
                        try {
                            rate.EXPECTED_DELIVERY_DATE = new Date(element.EstimatedDeliveryDate).toISOString().split('T')[0];
                        } catch (e) {
                            rate.EXPECTED_DELIVERY_DATE = element.EstimatedDeliveryDate;
                        }
                    }

                    // Capture postage as a base charge detail
                    if (element?.Postage?.Rate) {
                        rate.CHARGE_DETAILS.push({
                            TYPE: 'Base',
                            DESCRIPTION: 'Base Postage',
                            AMOUNT: element.Postage.Rate,
                            CURRENCY: currency
                        });
                    }

                    // Capture fees / surcharges if present
                    const feesRaw = element?.Fees?.Fee;
                    if (feesRaw) {
                        const feesList = Array.isArray(feesRaw) ? feesRaw : [feesRaw];
                        feesList.forEach(fee => {
                            rate.CHARGE_DETAILS.push({
                                TYPE: fee?.FeeType || fee?.["$"]?.FeeType || 'Fee',
                                DESCRIPTION: fee?.FeeDescription || fee?.FeeType || 'Fee',
                                AMOUNT: fee?.FeeAmount || fee?.["$"]?.FeeAmount || '0',
                                CURRENCY: currency
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
                const { SERVICE_CODE, DISCOUNTED_FREIGHT, PUBLISHED_FREIGHT, CHARGE_DETAILS = [] } = curr;
                if (!acc[SERVICE_CODE]) {
                    acc[SERVICE_CODE] = {
                        ...curr,
                        DISCOUNTED_FREIGHT: 0,
                        PUBLISHED_FREIGHT: 0,
                        CHARGE_DETAILS: []
                    };
                }
                acc[SERVICE_CODE].DISCOUNTED_FREIGHT += parseFloat(DISCOUNTED_FREIGHT || 0);
                acc[SERVICE_CODE].PUBLISHED_FREIGHT += parseFloat(PUBLISHED_FREIGHT || 0);

                CHARGE_DETAILS.forEach(sc => {
                    const existing = acc[SERVICE_CODE].CHARGE_DETAILS.find(x => x.TYPE === sc.TYPE);
                    if (existing) {
                        existing.AMOUNT = round2(parseFloat(existing.AMOUNT) + parseFloat(sc.AMOUNT));
                    } else {
                        acc[SERVICE_CODE].CHARGE_DETAILS.push({
                            ...sc,
                            AMOUNT: round2(sc.AMOUNT)
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
            try {
                const rateerr = reuse.parseAndCleanXML(ex4.response.data);
                return {
                    status: 'Error',
                    message: [{
                        CARRIER: 'USPS',
                        STATUSCODE: rateerr?.Envelope?.Body?.Fault?.faultcode
                            || rateerr?.Envelope?.Body?.CalculatePostageRatesResponse?.PostageRatesResponse?.Status
                            || '',
                        MESSAGE: rateerr?.Envelope?.Body?.Fault?.faultstring
                            || rateerr?.Envelope?.Body?.CalculatePostageRatesResponse?.PostageRatesResponse?.ErrorMessage
                            || 'USPS API Error'
                    }]
                };
            } catch (parseErr) {
                return {
                    status: 'Error',
                    message: [{
                        CARRIER: 'USPS',
                        STATUSCODE: '',
                        MESSAGE: ex4.message || 'USPS API Error'
                    }]
                };
            }
        }
        else {
            return {
                status: 'Error',
                message: [{
                    CARRIER: 'USPS',
                    STATUSCODE: ex4.statusCode || '',
                    MESSAGE: ex4.message || 'USPS API Error'
                }]
            };
        }
    }
};