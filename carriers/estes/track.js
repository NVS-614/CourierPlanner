// carriers/estes/track.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildTrackResponse, buildEvent } = require('../../Reuse/trackResponseFormatter');
const getToken = require('./estes_token_manager.js');
require('dotenv').config();

module.exports = async (request) => {
    const TRACK_RESPONSE = buildTrackResponse();
    try {
       
    const tokenurl = request.CARRIER_DETAILS.TOKENURL || process.env.ESTES_TOKEN;
    const trackurl = request.CARRIER_DETAILS.TRACKURL || process.env.ESTES_TRACK;
 const token = await getToken.getEstesToken(CARRIER_DETAILS.SHIPPING_ACCOUNT, tokenurl, CARRIER_DETAILS.USERID, CARRIER_DETAILS.PASSWORD, CARRIER_DETAILS?.ACCESS_KEY);
   
        const trackres = await axios.get(finalurl, {
            headers: {
                'content-type': 'application/json',
                'apiKey': request.CARRIER_DETAILS?.ACCESS_KEY
            },
        });

        console.log('RL track Response is ..:');
        console.log(JSON.stringify(trackres.data));
        
        try {
            trackres.data?.Shipments?.forEach(shipment => {

                TRACK_RESPONSE.EXPECTED_DELIVERY_DATE =
                    shipment?.EstimatedDelivery || null;

                TRACK_RESPONSE.ORIGIN = {
                    CITY: shipment?.SHIPPER?.Address?.City || null,
                    STATE: shipment?.SHIPPER?.Address?.State || null,
                    POSTAL_CODE: shipment?.SHIPPER?.Address?.ZipCode || null,
                    COUNTRY: shipment?.SHIPPER?.Address?.CountryCode || null
                };

                TRACK_RESPONSE.DESTINATION = {
                    CITY: shipment?.Consignee?.Address?.City || null,
                    STATE: shipment?.Consignee?.Address?.State || null,
                    POSTAL_CODE: shipment?.Consignee?.Address?.ZipCode || null,
                    COUNTRY: shipment?.Consignee?.Address?.CountryCode || null
                };

                shipment?.StatusHistory?.forEach(event => {

                    const EVENT_RES = buildEvent({
                        trackingNumber: shipment?.ShipmentNumber,
                        status: event?.Description,
                        statusCode: event?.StatusCode,
                        dateTime: event?.Date + 'T' + event?.Time,
                        location: {
                            city: event?.City,
                            state: event?.State,
                            postalCode: event?.ZipCode,
                            country: event?.Country,
                            latitude: event?.Latitude,
                            longitude: event?.Longitude
                        }
                    });

                    TRACK_RESPONSE.EVENTS.push(EVENT_RES);
                });

            });


        } catch (error) {
            TRACK_RESPONSE.ERRORS.push({
                MESSAGE: error.message
            });
        }

        return TRACK_RESPONSE;

    } catch (err) {
        console.log(err?.response?.data || err?.message);
        TRACK_RESPONSE.STATUS = 'Error';
        if (err?.response?.data) {
            if (err.response.data?.Messages) {
                TRACK_RESPONSE.ERRORS.push(err.response.data.Messages[0]);
            } else {
                TRACK_RESPONSE.ERRORS.push(err.response.data);
            }
        } else {
            TRACK_RESPONSE.ERRORS.push(err.message);
        }

        return TRACK_RESPONSE;
    }
};