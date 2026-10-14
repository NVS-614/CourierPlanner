const db = require('../database/db');
const express = require('express');
const axios = require('axios');
const apiRequest = require("../Reuse/apiClient.js");
const dbCon = require("../database/dbsaveandupdate.js");
const trackuse = require("../SAPTRACK/trackUtilities.js");
const { getLBNToken } = require('../Reuse/LBNTokenManager.js');

async function DirectCarrier_PushTrackShipment(pushdata, carrier) {
    try {

        const Response = pushdata;
        const Carrier = carrier;
        let TrackingNo = ''
        let lbntrackreq = ''
        let podbase64 = '';
        let strmimeType = "application/pdf";
        let docType = 'PDF';
        let podfileName = '';
        const getReq = {
            login: process.env.CARRIERCONFIG_ID,
            password: process.env.CARRIERCONFIG_PASSWORD,
            carrier: Carrier
        };

        let CarrierInfo;
        try {
            CarrierInfo = await axios.post(process.env.CARRIERCONFIG_URL, getReq, {
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
            });
        } catch (error) {
            // return response.status(400).json({ status: 'Error', message: error.response?.data?.message || 'Carrier config fetch failed' });
        }

        if (!CarrierInfo?.data?.CarrierConfig?.length) {
            console.log("Carrier Configuration Not Found");
            return '';
        }

        const CarrierTrackStatuses = CarrierInfo?.data?.CarrierTrackStatuses || [];
        const Trackinfo = CarrierInfo.data.CarrierConfig[0].details;
        const trackingresponsefields = Trackinfo?.trackingresponsefields;
        try {
            const mappings = trackingresponsefields.split('\n');
            const parsedMappings = mappings.reduce((acc, mapping) => {
                const [key, value] = mapping.split('#');
                if (key && value) acc[key.trim()] = value.trim();
                return acc;
            }, {});
            TrackingNo = getValueByPath(Response, parsedMappings?.TrackingNo);
            try {
                const checkquery = `
                    SELECT * FROM public.saptrack 
                    WHERE details->>'XTRACKINGNO' = $1 AND details->>'Carrier' = $2 
                    LIMIT 1
                `;
                const result = await db.query(checkquery, [TrackingNo, Carrier]);
                if (result.length > 0) {
                    lbntrackreq = result[0].details;
                }

            } catch (error) {
                console.error("Error tracking shipments:", error);
            }

            const plannedeventlist = lbntrackreq.shipment.stops.flatMap(eventcodes => eventcodes.plannedEvents.map(code => code.eventType));

            const result = getValueByPath(Response, parsedMappings?.TrackEvents);
            if (!Array.isArray(result)) {
                //API error response like Tracking info not found.
                console.log("Invalid tracking response format");
                return '';
            }

            try {
                if (Carrier === 'UPS' && Response.trackResponse.shipment[0].package[0].currentStatus.description.trimEnd().toUpperCase() === 'DELIVERED') {
                    try {
                        let strpoddata = Response.trackResponse.shipment[0].package[0]?.deliveryInformation;
                        if (strpoddata?.pod) {
                            podbase64 = (strpoddata.pod.content) //await trackuse.base64HtmlToPdfAndUpload
                            podfileName = TrackingNumber + '_POD.html',
                                docType = 'Html'
                        }
                    } catch (error) {
                        console.log(error);
                    }
                }
            } catch (error) {
                console.error("Error extracting POD (UPS):", error.message);
            }

            try {
                if (Carrier === 'FEDEX' && Response.completeTrackResults[0].trackResults[0].latestStatusDetail.description.trimEnd().toUpperCase() === 'DELIVERED') {
                    podbase64 = await trackuse.FedExPOD(TrackingNumber, getapiToken);
                    strmimeType = 'image/png'; docType = 'PNG'; podfileName = TrackingNumber + '_POD.PNG'
                }
            } catch (error) {
                console.error("Error extracting POD (FEDEX):", error.message);
            }

            const TrackResponse = trackuse.parseTrackingEvents(result, parsedMappings, Carrier, CarrierTrackStatuses, plannedeventlist, TrackingNo);

            lbntrackreq.trackingEvents = TrackResponse;
            //Latest Status
            const latestUpdate = TrackResponse.reduce((latest, current) => {
                return new Date(current.DateTime) > new Date(latest.DateTime) ? current : latest;
            }, TrackResponse[0]);

            if (podbase64) {
                lbntrackreq.POD = {
                    encodedLabel: podbase64,
                    docType: docType
                }
            }
            lbntrackreq.CarrierStatus = latestUpdate.Carrier_Tracking_Status_Description.toUpperCase(); //Carrier_Tracking_Status_Code
            lbntrackreq.LBNStatus = latestUpdate.LBN_Status_Code;
            await dbCon.dbTracksaveandUpdate(lbntrackreq);

        } catch (error) {
            console.error('Carrier API request failed:', error?.response?.data || error.message);

            return '';
        }

        try {
            const sapEventRequest = await trackuse.buildSAP_EventRequest(deliveryno, orderId, salesorderno, TrackingNumber, lbntrackreq.trackingEvents, podbase64, docType, podfileName);
            console.log(sapEventRequest);
            // First request to get CSRF token and cookies
            const tokenResponse = await axios.get(
                process.env.LBN_SAP_TRACK_CSRFTOKEN_URL,
                {
                    headers: {
                        'X-CSRF-Token': 'Fetch',
                        Authorization: 'Basic ' + Buffer.from(`${process.env.LBN_SAP_USER}:${process.env.LBN_SAP_PASSWORD}`).toString('base64')
                    }
                }
            );

            const csrfToken = tokenResponse.headers['x-csrf-token'];
            const cookies = tokenResponse.headers['set-cookie']; // Get cookies from response

            // Make sure we got cookies
            if (!cookies) {
                throw new Error('No cookies received in initial request');
            }

            // Now make the POST request with both CSRF token AND cookies
            const sapRes = await axios.post(
                process.env.LBN_SAP_TRACK_MILESTONE_URL,
                sapEventRequest,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken,
                        'Cookie': cookies.join('; '), // Include the cookies
                        Authorization: 'Basic ' + Buffer.from(`${process.env.LBN_SAP_USER}:${process.env.LBN_SAP_PASSWORD}`).toString('base64')
                    }
                }
            );

            console.log('SAP_ZPC RES', sapRes?.data);
        } catch (error) {
            console.log('SAP_ZPC ERROR', error.response?.data || error.message);
            if (error.response) {
                console.log('Response headers:', error.response.headers);
                console.log('Response status:', error.response.status);
            }
        }

        const token = await getLBNToken();

        const SapEventRequest = await trackuse.buildLBN_EventRequest(lbntrackreq, TrackingNo, lbntrackreq.trackingEvents, Carrier, CarrierTrackStatuses, podbase64, strmimeType, podfileName);

        // console.log(JSON.stringify(SapEventRequest));
        try {
            const sapRes = await axios.post(process.env.LBN_CLOUD_ORDEREVENTS_URL, SapEventRequest, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
            console.log('success');
            return '';

        } catch (error) {
            console.log("SAP API request failed", error.message);
            return '';
        }
        return '';
    } catch (error) {
        console.error(`Error processing shipment ID :`, error);
    }
}



async function track_ShipmentsDB() {
    try {
        const checkquery = `
          SELECT * FROM public.saptrack 
          WHERE TRIM(details->>'CarrierStatus') NOT IN ('DELIVERED', 'POD') 
             OR TRIM(details->>'LBNStatus') NOT IN ('DELIVERED', 'POD')
        `;

        const result = await db.query(checkquery);
        if (result.length > 0) {
            for (const shipment of result) {
                await process_JobTrackShipmentDB(shipment); // Wait for each shipment to be processed
            }
        }
        return '';

    } catch (error) {
        console.error("Error tracking shipments:", error);
        throw error;
    }
}


async function process_JobTrackShipmentDB(shipment) {
    let lbntrackreq = shipment.details;
    try {
        console.log(`Processing shipment ID: ${shipment.id}`);
        let existingid = shipment.id
        let Carrier = shipment.details.Carrier;
        let TrackingNumber = shipment.details.XTRACKINGNO;
        const orderId = shipment.details.shipment?.orderId || '';
        const documentReference = shipment.details.shipment?.documentReference;
        const salesorderno = documentReference.find(item => item.type === '114')?.value || '';
        const deliveryno = documentReference.find(item => item.type === '73')?.value || '';
        let podbase64 = '';
        let strmimeType = "application/pdf";
        let podfileName = '';
        let docType = 'PDF';

        const getReq = {
            login: process.env.CARRIERCONFIG_ID,
            password: process.env.CARRIERCONFIG_PASSWORD,
            carrier: Carrier
        };

        let CarrierInfo;
        try {
            CarrierInfo = await axios.post(process.env.CARRIERCONFIG_URL, getReq, {
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' }
            });
        } catch (error) {
            console.error("Error extracting CarrierInfo:", error.message);
        }


        if (!CarrierInfo?.data?.CarrierConfig?.length) {
            console.log("Carrier Configuration Not Found");
            return '';
        }

        const CarrierTrackStatuses = CarrierInfo?.data?.CarrierTrackStatuses || [];

        const Trackinfo = CarrierInfo.data.CarrierConfig[0].details;
        const trackingresponsefields = Trackinfo?.trackingresponsefields;
        const plannedeventlist = shipment.details.shipment.stops.flatMap(eventcodes => eventcodes.plannedEvents.map(code => code.eventType));

        let getapiToken = '', trackPayload = '', strToken = null, Response = '';

        try {

            if (Trackinfo.tokenurl) {
                let tokenPayload = Trackinfo.tokenpayload;
                let tokenAuthType = null;

                if (tokenPayload.includes('###BASIC###')) {
                    tokenAuthType = 'Basic';
                    strToken = Buffer.from(`${Trackinfo.userid}:${Trackinfo.password}`).toString('base64');
                    tokenPayload = tokenPayload.replace('###BASIC###', '');
                } else {
                    tokenPayload = tokenPayload.replace('###USER###', Trackinfo.userid).replace('###PASSWORD###', Trackinfo.password);
                }

                const TokenResponse = await apiRequest('POST', Trackinfo.tokenurl, {
                    payload: tokenPayload,
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    authType: tokenAuthType,
                    token: strToken
                });

                getapiToken = TokenResponse.access_token;

                if (Trackinfo.trackpayload) {
                    trackPayload = Trackinfo.trackpayload.replace('###TRACK###', TrackingNumber);
                }

                const TrackResponse = await apiRequest(
                    Trackinfo.mime,
                    Trackinfo.endpointurl.replace('###TRACK###', TrackingNumber),
                    {
                        payload: trackPayload,
                        authType: Trackinfo.authenticationtype.replace(' Token', ''),
                        token: getapiToken,
                        apiKey: Trackinfo.apikey,
                        headers: { 'Content-Type': 'application/json', transId: 'test', transactionSrc: 'testing' }
                    }
                );

                Response = TrackResponse.output || TrackResponse;

            } else {
                if (Trackinfo.authenticationtype.includes('Basic')) {
                    strToken = Buffer.from(`${Trackinfo.userid}:${Trackinfo.password}`).toString('base64');
                }

                const TrackResponse = await apiRequest(
                    Trackinfo.mime,
                    Trackinfo.endpointurl.replace('###TRACK###', TrackingNumber),
                    {
                        payload: trackPayload,
                        authType: Trackinfo.authenticationtype.replace(' Token', '').replace(' Auth', ''),
                        token: strToken,
                        apiKey: Trackinfo.apikey,
                        headers: { 'Content-Type': 'application/json', transId: 'test', transactionSrc: 'testing' }
                    }
                );

                Response = TrackResponse.output || TrackResponse;

            }

            try {
                const logEntryetc =
                {
                    id: existingid,
                    dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
                    endpointURL: Trackinfo.endpointurl.replace('###TRACK###', TrackingNumber),
                    EventType: "EXTERNAL_SYSTEM-CARRIER",
                    request: (trackPayload),
                    response: JSON.stringify(Response),
                    StatusCode: ''
                }
                await dbCon.dbSAP_TRACK_transactionssave(logEntryetc);
            } catch (error) {
                console.log('logEntryetc Save error : ', error.message)
            }



            const mappings = trackingresponsefields.split('\n');
            const parsedMappings = mappings.reduce((acc, mapping) => {
                const [key, value] = mapping.split('#');
                if (key && value) acc[key.trim()] = value.trim();
                return acc;
            }, {});

            const result = getValueByPath(Response, parsedMappings?.TrackEvents);
            if (!Array.isArray(result)) {
                //API error response like Tracking info not found.
                console.log("Invalid tracking response format");
                return shipment;
            }
            try {
                if (Carrier === 'UPS' && Response.trackResponse.shipment[0].package[0].currentStatus.description.trimEnd().toUpperCase() === 'DELIVERED') {
                    try {
                        let strpoddata = Response.trackResponse.shipment[0].package[0]?.deliveryInformation;
                        if (strpoddata?.pod) {
                            podbase64 = (strpoddata.pod.content) //await trackuse.base64HtmlToPdfAndUpload
                            podfileName = TrackingNumber + '_POD.html',
                                docType = 'Html'
                        }
                    } catch (error) {
                        console.log('UPS podbase64 error', error);
                    }
                }
            } catch (error) {
                console.error("Error extracting POD (UPS):", error.message);
            }

            try {
                if (Carrier === 'FEDEX' && Response.completeTrackResults[0].trackResults[0].latestStatusDetail.description.trimEnd().toUpperCase() === 'DELIVERED') {
                    podbase64 = await trackuse.FedExPOD(TrackingNumber, getapiToken);
                    strmimeType = 'image/png'; docType = 'PNG'; podfileName = TrackingNumber + '_POD.PNG'
                }
            } catch (error) {
                console.error("Error extracting POD (FEDEX):", error.message);
            }



            const TrackResponse = await trackuse.parseTrackingEvents(result, parsedMappings, Carrier, CarrierTrackStatuses, plannedeventlist, TrackingNumber);

            lbntrackreq.trackingEvents = TrackResponse;
            const latestUpdate = TrackResponse.reduce((latest, current) => {
                return new Date(current.DateTime) > new Date(latest.DateTime) ? current : latest;
            }, TrackResponse[0]);

            if (!TrackResponse.length) {
                console.log("No tracking events returned");
                //  return '';
            }

            //Latest Status
            if (podbase64) {
                lbntrackreq.POD = {
                    encodedLabel: podbase64,
                    docType: docType
                }
            }
            lbntrackreq.CarrierStatus = latestUpdate.Carrier_Tracking_Status_Description.toUpperCase(); //Carrier_Tracking_Status_Code
            lbntrackreq.LBNStatus = latestUpdate.LBN_Status_Code;
            await dbCon.dbTracksaveandUpdate(lbntrackreq);

        } catch (error) {
            console.error('Carrier API request failed:', error?.response?.data || error.message);

            return lbntrackreq;
        }


        try {
            const sapEventRequest = await trackuse.buildSAP_EventRequest(deliveryno, orderId, salesorderno, TrackingNumber, lbntrackreq.trackingEvents, podbase64, docType, podfileName);
            console.log(sapEventRequest);
            // First request to get CSRF token and cookies
            const tokenResponse = await axios.get(
                process.env.LBN_SAP_TRACK_CSRFTOKEN_URL,
                {
                    headers: {
                        'X-CSRF-Token': 'Fetch',
                        Authorization: 'Basic ' + Buffer.from(`${process.env.LBN_SAP_USER}:${process.env.LBN_SAP_PASSWORD}`).toString('base64')
                    }
                }
            );

            const csrfToken = tokenResponse.headers['x-csrf-token'];
            const cookies = tokenResponse.headers['set-cookie']; // Get cookies from response

            // Make sure we got cookies
            if (!cookies) {
                throw new Error('No cookies received in initial request');
            }

            // Now make the POST request with both CSRF token AND cookies
            const sapRes = await axios.post(
                process.env.LBN_SAP_TRACK_MILESTONE_URL,
                sapEventRequest,
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-CSRF-Token': csrfToken,
                        'Cookie': cookies.join('; '), // Include the cookies
                        Authorization: 'Basic ' + Buffer.from(`${process.env.LBN_SAP_USER}:${process.env.LBN_SAP_PASSWORD}`).toString('base64')
                    }
                }
            );

            console.log('SAP_ZPC RES', sapRes?.data);
        } catch (error) {
            console.log('SAP_ZPC ERROR', error.response?.data || error.message);
            if (error.response) {
                console.log('Response headers:', error.response.headers);
                console.log('Response status:', error.response.status);
            }
        }

        const token = await getLBNToken();


        const SapEventRequest = await trackuse.buildLBN_EventRequest(lbntrackreq, TrackingNumber, lbntrackreq.trackingEvents, Carrier, CarrierTrackStatuses, podbase64, strmimeType, podfileName);

        // console.log(JSON.stringify(SapEventRequest));
        try {
            const sapRes = await axios.post(process.env.LBN_CLOUD_ORDEREVENTS_URL, SapEventRequest, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });

            const logEntryets =
            {
                id: existingid,
                dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
                endpointURL: process.env.LBN_CLOUD_ORDEREVENTS_URL,
                EventType: "EXTERNAL_SYSTEM-BN4L_NETWORK",
                request: JSON.stringify(SapEventRequest),
                response: JSON.stringify(sapRes.data),
                StatusCode: 200
            }
            await dbCon.dbSAP_TRACK_transactionssave(logEntryets);
            console.log('success');


        } catch (error) {
            const logEntryets =
            {
                id: existingid,
                dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
                endpointURL: process.env.LBN_CLOUD_ORDEREVENTS_URL,
                EventType: "EXTERNAL_SYSTEM-BN4L_NETWORK",
                request: JSON.stringify(SapEventRequest),
                response: JSON.stringify(error?.response?.data || { message: error.message }),
                StatusCode: 500
            }
            await dbCon.dbSAP_TRACK_transactionssave(logEntryets);
            console.log("SAP API request failed", error.message);

        }

        return lbntrackreq;


    } catch (error) {
        console.error(`Error processing shipment ID ${shipment.id}:`, error);
        return error;
    }
}



function getValueByPath(data, path) {
    try {
        return path.split('.').reduce((acc, key) => {
            if (key.includes('[')) {
                const [arrKey, index] = key.split(/\[|\]/).filter(Boolean);
                return acc[arrKey][parseInt(index, 10)];
            }
            return acc[key];
        }, data);
    } catch {
        return undefined;
    }
}


module.exports = { track_ShipmentsDB, DirectCarrier_PushTrackShipment, process_JobTrackShipmentDB };
