const axios = require('axios');
const getToken = require('../../Reuse/fedex_token_manager.js');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildTrackResponse, buildEvent } = require('../../Reuse/trackResponseFormatter.js');

const DEFAULT_TRACK_URL = process.env.FEDEX_TRACK;
const DEFAULT_TOKEN_URL = process.env.FEDEX_TOKEN;

// Split array into chunks
const chunkArray = (array, size) => {
    const result = [];
    for (let i = 0; i < array.length; i += size) {
        result.push(array.slice(i, i + size));
    }
    return result;
};


module.exports = async (request) => {

    const TRACK_RESPONSES = [];

    try {

        const tokenurl = request.CARRIER_DETAILS.TOKENURL || DEFAULT_TOKEN_URL;
        const trackurl = request.CARRIER_DETAILS.TRACKURL || DEFAULT_TRACK_URL;

        // Split tracking numbers into batches of 30
        const packageChunks = chunkArray(request.PACKAGES, 30);

        const token = await getToken.getFedexTrackToken(
            request.CARRIER_DETAILS.SHIPPING_ACCOUNT,
            tokenurl,
            process.env.FEDEX_CSPUSER,
             process.env.FEDEX_CSPPASSWORD,
        );

        // Run tracking requests in parallel
        const responses = await Promise.all(

            packageChunks.map(async (chunk) => {

                const trackRequest = {
                    includeDetailedScans: true,
                    trackingInfo: chunk.map(pkg => ({
                        trackingNumberInfo: {
                            trackingNumber: pkg.TRACKING_NUMBER
                        }
                    }))
                };

                const res = await axios.post(trackurl, trackRequest, {
                    headers: {
                        'content-type': 'application/json',
                        authorization: `Bearer ${token}`
                    }
                });

                return res.data?.output?.completeTrackResults || [];
            })
        );

        // Flatten all results
        const results = responses.flat();


        for (const Selement of results) {

            const TRACK_RESPONSE = buildTrackResponse();
            const trackingNumber = Selement.trackingNumber;

            TRACK_RESPONSE.TRACKING_NUMBER = trackingNumber;

            const Pelement = Selement.trackResults?.[0];

            if (!Pelement) {
                TRACK_RESPONSE.ERRORS.push("No tracking result found");
                TRACK_RESPONSES.push(TRACK_RESPONSE);
                continue;
            }

            if (Pelement?.error?.message) {
                TRACK_RESPONSE.ERRORS.push(Pelement.error.message);
                TRACK_RESPONSES.push(TRACK_RESPONSE);
                continue;
            }

            let events = Pelement.scanEvents || [];

            // Remove duplicate events
            const uniqueEvents = [
                ...new Map(events.map(e => [e.date + e.eventType, e])).values()
            ];

            // Sort newest first
            uniqueEvents.sort((a, b) =>
                new Date(b.date) - new Date(a.date)
            );

            // Build events + POD in parallel
            TRACK_RESPONSE.EVENTS = await Promise.all(
                uniqueEvents.map(async (event) => {

                    const EVENT_RES = buildEvent({
                        trackingNumber,
                        status: event.eventDescription,
                        statusCode: event.eventType,
                        dateTime: event.date,
                        location: {
                            city: event.scanLocation?.city,
                            state: event.scanLocation?.stateOrProvinceCode,
                            postalCode: event.scanLocation?.postalCode,
                            country: event.scanLocation?.countryCode
                        }
                    });

                    if (event.eventType === 'DL') {
                        try {
                            EVENT_RES.POD = await getPOD(request, trackingNumber);
                        } catch {
                            EVENT_RES.POD = '';
                        }
                    }

                    return EVENT_RES;
                })
            );

            TRACK_RESPONSE.EXPECTED_DELIVERY_DATE =
                Pelement.dateAndTimes?.find(d => d.type === "ACTUAL_DELIVERY")?.dateTime || '';

            TRACK_RESPONSE.CURRENT_STATUS = buildEvent({
                trackingNumber,
                status: Pelement.latestStatusDetail?.description,
                statusCode: Pelement.latestStatusDetail?.code,
                dateTime: null,
                location: {
                    city: Pelement.latestStatusDetail?.scanLocation?.city,
                    state: Pelement.latestStatusDetail?.scanLocation?.stateOrProvinceCode,
                    postalCode: Pelement.latestStatusDetail?.scanLocation?.postalCode,
                    country: Pelement.latestStatusDetail?.scanLocation?.countryCode
                }
            });

            TRACK_RESPONSE.ORIGIN = {
                CITY: Pelement.shipperInformation?.address?.city || null,
                STATE: Pelement.shipperInformation?.address?.stateOrProvinceCode || null,
                POSTAL_CODE: Pelement.shipperInformation?.address?.postalCode || null,
                COUNTRY: Pelement.shipperInformation?.address?.countryCode || null
            };

            TRACK_RESPONSE.DESTINATION = {
                CITY: Pelement.recipientInformation?.address?.city || null,
                STATE: Pelement.recipientInformation?.address?.stateOrProvinceCode || null,
                POSTAL_CODE: Pelement.recipientInformation?.address?.postalCode || null,
                COUNTRY: Pelement.recipientInformation?.address?.countryCode || null
            };

            TRACK_RESPONSES.push(TRACK_RESPONSE);
        }


        // Handle missing tracking numbers
        for (const pkg of request.PACKAGES) {

            const exists = TRACK_RESPONSES.find(
                r => r.TRACKING_NUMBER === pkg.TRACKING_NUMBER
            );

            if (!exists) {

                const TRACK_RESPONSE = buildTrackResponse();
                TRACK_RESPONSE.TRACKING_NUMBER = pkg.TRACKING_NUMBER;
                TRACK_RESPONSE.ERRORS.push("Tracking number not found");

                TRACK_RESPONSES.push(TRACK_RESPONSE);
            }
        }

        return TRACK_RESPONSES;

    } catch (error) {

        return request.PACKAGES.map(pkg => {

            const TRACK_RESPONSE = buildTrackResponse();

            TRACK_RESPONSE.TRACKING_NUMBER = pkg.TRACKING_NUMBER;

            TRACK_RESPONSE.ERRORS.push(
                reuse.handleShipErrorRes(error)
            );

            return TRACK_RESPONSE;
        });
    }
};



const getPOD = async (request, TRACKING_NUMBER) => {
    try {

        const tokenurl =
            request.CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;

        const PodURL =
            request.CARRIER_DETAILS.PODURL || process.env.FEDEX_POD;

        const podRequest = {
            trackDocumentDetail: {
                documentType: 'SIGNATURE_PROOF_OF_DELIVERY',
                documentFormat: 'PNG'
            },
            trackDocumentSpecification: []
        };

        podRequest.trackDocumentSpecification.push({
            trackingNumberInfo: {
                trackingNumber: TRACKING_NUMBER
            }
        });

        const token = await getToken.getFedexTrackToken(
            request.CARRIER_DETAILS.SHIPPING_ACCOUNT,
            tokenurl,
            process.env.FEDEX_CSPUSER,
            process.env.FEDEX_CSPPASSWORD
        );

        const PodRes = await axios.post(PodURL, podRequest, {
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${token}`
            }
        });

        return PodRes.data.output.documents[0]

    } catch (error) {

        console.log('POD Error:', error.message);
        return '';
    }
};