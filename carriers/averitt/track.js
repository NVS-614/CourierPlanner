// carriers/fedex/track.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildTrackResponse, buildEvent } = require('../../Reuse/trackResponseFormatter');

module.exports = async (request) => {
    const TRACK_RESPONSE = buildTrackResponse();
    try {
        const trackurl = request.CARRIER_DETAILS.TRACKURL || process.env.AVERITT_TRACK;
        const etturl = trackurl + `${request.PACKAGES?.[0]?.TRACKING_NUMBER}?api_key=${request.CARRIER_DETAILS?.ACCESS_KEY}`;
        const trackRes = await axios.get(
            etturl,
            {
                headers: {
                    'content-type': 'application/json'
                }
            }
        );
        console.log('Averitt track Response is ..:');
        console.log(JSON.stringify(trackRes.data))

        const Selement = trackRes.data;
        let isDelivered = false;
        if (Selement.estimatedServiceTime) {
            TRACK_RESPONSE.EXPECTED_DELIVERY_DATE = Selement.estimatedServiceTime?.estDate + 'T' + Selement.estimatedServiceTime?.estTime;
        } else if (Selement.deliveryInformation?.dateTime) {
            TRACK_RESPONSE.EXPECTED_DELIVERY_DATE = Selement.deliveryInformation.dateTime;
        } else {
            TRACK_RESPONSE.EXPECTED_DELIVERY_DATE = ''
        }



        const shipmentList = Array.isArray(Selement.shipmentHistory)
            ? Selement.shipmentHistory
            : [Selement.shipmentHistory];

        shipmentList.forEach((element) => {
            const EVENT_RES = buildEvent({
                trackingNumber: Selement.proNumber,
                status: element.status,
                statusCode: element.status,
                dateTime: element.dateTime,
                location: {
                    city: element.location,
                    state: null,
                    postalCode: null,
                    country: null,
                    latitude: '',
                    longitude: ''
                }
            });

            TRACK_RESPONSE.EVENTS.push(EVENT_RES);
        });


    } catch (error) {
        TRACK_RESPONSE.ERRORS.push(
            reuse.handleShipErrorRes(error)
        );
    }

    return TRACK_RESPONSE;
};
