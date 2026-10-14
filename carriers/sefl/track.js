
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildTrackResponse, buildEvent } = require('../../Reuse/trackResponseFormatter');
require('dotenv').config();

module.exports = async (request) => {
    const TRACK_RESPONSE = buildTrackResponse();
    try {
        let trackurl = request.CARRIER_DETAILS?.TRACKURL || process.env.SEFL_TRACK;
        const finalurl = trackurl + `${request.PACKAGES[0]?.TRACKING_NUMBER}&TraceType=PRO`;
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