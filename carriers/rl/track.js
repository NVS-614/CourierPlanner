// carriers/rl/track.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildTrackResponse, buildEvent } = require('../../Reuse/trackResponseFormatter');
require('dotenv').config();

module.exports = async (request) => {
    const TRACK_RESPONSE = buildTrackResponse();
    TRACK_RESPONSE.POD = {};

    try {
        let trackurl = request.CARRIER_DETAILS?.TRACKURL || process.env.RL_TRACK;
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
            for (const shipment of (trackres.data?.Shipments || [])) {

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

                for (const event of (shipment?.StatusHistory || [])) {

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

                    // ---------------- POD: fetch on delivery ----------------
                    if (
                        event?.StatusCode === 'DEL' ||
                        event?.Description?.toLowerCase() === 'delivered'
                    ) {
                        try {
                            const trackingNumber =
                                shipment?.ShipmentNumber ||
                                request.PACKAGES[0]?.TRACKING_NUMBER;
                            TRACK_RESPONSE.POD = await getPODForTracking(request, trackingNumber);
                        } catch (podError) {
                            console.error('RL POD fetch error:', podError.message);
                        }
                    }

                    TRACK_RESPONSE.EVENTS.push(EVENT_RES);
                }
            }

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

// ---------------- POD API ----------------
const getPODForTracking = async (request, trackingNumber) => {
    try {
        const CARRIER_DETAILS = request.CARRIER_DETAILS;

        let poddocs = CARRIER_DETAILS?.POD_DOCS || CARRIER_DETAILS?.PodDocs || [
            'DELIVERY_RECEIPT', 'INVOICE', 'DELIVERY_PHOTO', 'BILL_OF_LADING',
            'WEIGHT_CERTIFICATE', 'NMFC_CERTIFICATE', 'LETTER_OF_AUTHORIZATION'
        ];

        // Mapping: standard key → RL API document type value
        const podDocMapping = {
            DELIVERY_RECEIPT:       'DeliveryReceipt',
            INVOICE:                'Invoice',
            DELIVERY_PHOTO:         'DeliveryPhoto',
            BILL_OF_LADING:         'BillOfLading',
            WEIGHT_CERTIFICATE:     'WeightCertificate',
            NMFC_CERTIFICATE:       'NmfcCertificate',
            LETTER_OF_AUTHORIZATION:'LetterOfAuthorization'
        };

        // Reverse mapping: RL API type → standard key
        const typeMapping = {
            DeliveryReceipt:        'DELIVERY_RECEIPT',
            Invoice:                'INVOICE',
            DeliveryPhoto:          'DELIVERY_PHOTO',
            BillOfLading:           'BILL_OF_LADING',
            WeightCertificate:      'WEIGHT_CERTIFICATE',
            NmfcCertificate:        'NMFC_CERTIFICATE',
            LetterOfAuthorization:  'LETTER_OF_AUTHORIZATION'
        };

        // Build documentTypes query string
        const documentTypes = poddocs
            .map(doc => `request.documentTypes=${podDocMapping[doc] || doc}`)
            .join('&');

        const allInOneDocument = CARRIER_DETAILS?.ALLINONE || false;
        const podURL = CARRIER_DETAILS?.PODURL || process.env.RL_POD;
        const finalURL =
            `${podURL}${documentTypes}` +
            `&request.proNumber=${trackingNumber}` +
            `&request.allInOneDocument=${allInOneDocument}` +
            `&request.mediaType=PDF`;

        console.log('RL POD URL:', finalURL);

        const podRes = await axios.get(finalURL, {
            headers: {
                accept: 'application/json',
                'apiKey': CARRIER_DETAILS?.ACCESS_KEY
            }
        });

        const documents = podRes?.data?.Documents || [];
        if (!documents.length) return {};

        const POD = {};

        for (const doc of documents) {
            const base64Image = doc?.Data;
            if (!base64Image) continue;

            if (base64Image) {
                const key = typeMapping[doc.Type] || doc?.Type?.toUpperCase() || 'POD';
                POD[key] = base64Image;
            }
        }

        return POD;

    } catch (error) {
        console.error('RL POD Error:', error.message);
        return {};
    }
};