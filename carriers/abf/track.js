// carriers/fedex/track.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildTrackResponse, buildEvent } = require('../../Reuse/trackResponseFormatter');


module.exports = async (request) => {
    const TRACK_RESPONSE = buildTrackResponse();

    try {
        const trackurl =
            request.CARRIER_DETAILS.TRACKURL || process.env.ABF_TRACK;

        const input =
            `DL=2&ID=${request.CARRIER_DETAILS?.ACCESS_KEY}` +
            `&RefNum=${request.PACKAGES?.[0]?.TRACKING_NUMBER}` +
            `&RefType=A`;

        const trackresult = await axios.post(trackurl, input, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded'
            }
        });

        const trackres = reuse.parseAndCleanXML(trackresult.data);

        const numErrors = Number(trackres?.ABF?.NUMERRORS || 0);

        if (numErrors > 0) {
            TRACK_RESPONSE.ERRORS.push(
                trackres?.ABF?.ERRORS?.ERRORMESSAGE ||
                'Unknown tracking error'
            );
        } else {
            TRACK_RESPONSE.EXPECTED_DELIVERY_DATE = null;

            const shipments = trackres?.ABF?.SHIPMENTS?.SHIPMENT;

            if (!shipments) {
                TRACK_RESPONSE.ERRORS.push('No shipment data found');
                return TRACK_RESPONSE;
            }

            const shipmentList = Array.isArray(shipments)
                ? shipments
                : [shipments];

            shipmentList.forEach((shipment) => {
                const EVENT_RES = buildEvent({
                    trackingNumber: shipment?.PRONUMBER,
                    status: shipment?.LONGSTATUS,
                    statusCode: shipment?.SHORTSTATUS2,
                    dateTime: shipment?.EXPECTEDDELIVERYDATE,
                    location: {
                        city: shipment?.CONSIGNEECITY,
                        state: null,
                        postalCode: null,
                        country: null,
                        latitude: '',
                        longitude: ''
                    }
                });

                TRACK_RESPONSE.EVENTS.push(EVENT_RES);
            });
        }

    } catch (error) {
        TRACK_RESPONSE.ERRORS.push(
            reuse.handleShipErrorRes(error)
        );
    }

    return TRACK_RESPONSE;
};
