// carriers/fedex/track.js

const axios = require('axios');
const getToken = require('../../Reuse/fedex_token_manager.js');
const reuse = require('../../Reuse/utilityfunctions.js');
require('dotenv').config();

module.exports = async (request) => {

    try {

        const tokenurl =
            request.body.CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;

        const trackurl =
            request.body.CARRIER_DETAILS.TRACKURL || process.env.FEDEX_TRACK;

        let trackRequest = {
            includeDetailedScans: true,
            trackingInfo: []
        };

        request.body.PACKAGES.forEach(element => {
            trackRequest.trackingInfo.push({
                trackingNumberInfo: {
                    trackingNumber: element.TRACKING_NUMBER
                }
            });
        });

        const token = await getToken.getFedexTrackToken(
            request.body.CARRIER_DETAILS.SHIPPING_ACCOUNT,
            tokenurl,
            request.body.CARRIER_DETAILS.USERID,
            request.body.CARRIER_DETAILS.PASSWORD
        );

        const trackRes = await axios.post(trackurl, trackRequest, {
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${token}`
            }
        });

        const firstError =
            trackRes.data.output.completeTrackResults[0]
                ?.trackResults[0]?.error?.message;

        if (firstError) {
            throw {
                statusCode: 400,
                data: {
                    status: 'Error',
                    Errors: [firstError]
                }
            };
        }

        let trackResponse = {
            status: 'Success',
            Events: []
        };

        for (const Selement of trackRes.data.output?.completeTrackResults || []) {

            for (const Pelement of Selement.trackResults || []) {

                for (const element of Pelement.scanEvents || []) {

                    let eventres = {
                        TrackingNumber: Selement.trackingNumber,
                        status: element.eventDescription,
                        StatusCode: element.eventType,
                        DateTime: element.date,
                        Location: {
                            City: element.scanLocation?.city,
                            State: element.scanLocation?.stateOrProvinceCode,
                            PostalCode: element.scanLocation?.postalCode,
                            Country: element.scanLocation?.countryCode
                        }
                    };

                    // POD download if Delivered
                    if (element.eventType === 'DL') {
                        try {
                            eventres.POD = await getPOD(request);
                        } catch (error) {
                            console.log('POD Error:', error.message);
                        }
                    }

                    trackResponse.Events.push(eventres);
                }

                // Expected Delivery
                try {
                    trackResponse.ExpectedDeliveryDate =
                        Pelement.dateAndTimes?.find(entry =>
                            entry.type === "ACTUAL_DELIVERY"
                        )?.dateTime || '';
                } catch {
                    trackResponse.ExpectedDeliveryDate = '';
                }

                // Current Status
                trackResponse.CurrentStatus = {
                    status: Pelement.latestStatusDetail?.description,
                    StatusCode: Pelement.latestStatusDetail?.code,
                    Location: {
                        City: Pelement.latestStatusDetail?.scanLocation?.city,
                        State: Pelement.latestStatusDetail?.scanLocation?.stateOrProvinceCode,
                        PostalCode: Pelement.latestStatusDetail?.scanLocation?.postalCode,
                        Country: Pelement.latestStatusDetail?.scanLocation?.countryCode
                    }
                };

                // Origin
                trackResponse.Origin = {
                    City: Pelement.shipperInformation?.address?.city,
                    State: Pelement.shipperInformation?.address?.stateOrProvinceCode,
                    PostalCode: Pelement.shipperInformation?.address?.postalCode,
                    Country: Pelement.shipperInformation?.address?.countryCode
                };

                // Destination
                trackResponse.Destination = {
                    City: Pelement.recipientInformation?.address?.city,
                    State: Pelement.recipientInformation?.address?.stateOrProvinceCode,
                    PostalCode: Pelement.recipientInformation?.address?.postalCode,
                    Country: Pelement.recipientInformation?.address?.countryCode
                };
            }
        }

        return trackResponse;

    } catch (error) {

        throw {
            statusCode: error.statusCode || 500,
            data: error.data || {
                status: 'Error',
                Errors: [reuse.handleShipErrorRes(error)]
            }
        };
    }
};

const getPOD = async (request) => {
    try {

        const tokenurl =
            request.body.CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;

        const PodURL =
            request.body.CARRIER_DETAILS.PODURL || request.body.CARRIER_DETAILS.PodURL || process.env.FEDEX_POD;

        const podRequest = {
            trackDocumentDetail: {
                documentType: 'SIGNATURE_PROOF_OF_DELIVERY',
                documentFormat: 'PNG'
            },
            trackDocumentSpecification: [{
                trackingNumberInfo: {
                    trackingNumber: request.body.PACKAGES[0]?.TRACKING_NUMBER
                }
            }]
        };

        const token = await getToken.getFedexTrackToken(
            request.body.CARRIER_DETAILS.SHIPPING_ACCOUNT,
            tokenurl,
            request.body.CARRIER_DETAILS.USERID,
            request.body.CARRIER_DETAILS.PASSWORD
        );

        const PodRes = await axios.post(PodURL, podRequest, {
            headers: {
                'content-type': 'application/json',
                'authorization': `Bearer ${token}`
            }
        });

        const fileName =
            request.body.PACKAGES[0]?.TRACKING_NUMBER + '_POD.PNG';

        reuse.uploadBase64File(
            PodRes.data.output.documents[0],
            fileName
        );

        return process.env.AWS_URL + fileName;

    } catch (error) {
        console.log('POD Error:', error.message);
        return '';
    }
};