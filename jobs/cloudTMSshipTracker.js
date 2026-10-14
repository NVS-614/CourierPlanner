const db = require('../database/db');
const express = require('express');
const router = express.Router();
const axios = require('axios');
const apiRequest = require("../Reuse/apiClient.js");
const dbCon = require("../database/dbsaveandupdate.js");
const trackuse = require("../SAPTRACK/trackUtilities.js");
const { v4: uuidv4 } = require("uuid");
const xml2js = require('xml2js');

async function track_SapCloudTmsDB() {
    try {
        const checkquery = `
    SELECT * FROM public.shipments
    WHERE details->>'XTRACKINGNO' = $1
      AND (
            TRIM(details->>'CarrierStatus') NOT IN ('DELIVERED', 'POD')
         OR TRIM(details->>'LBNStatus') NOT IN ('DELIVERED', 'POD')
      );
`;

        const result = await db.query(checkquery, [request.body.XTRACKINGNO]);
        // const result = await db.query(checkquery);
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
        let Carrier = shipment.details.CARRIER_DETAILS.CARRIER.toUpperCase();
        let TrackingNumber = shipment.details.HEADER_INFO.XTRACKINGNO;

        // --- Build MessageHeader for response ---
        let responseHeader = shipment.details.HEADER_INFO.MessageHeader;
        try {
            if (responseHeader.RecipientParty) {
                responseHeader.SenderParty = responseHeader.RecipientParty;
                 responseHeader.RecipientBusinessSystemID = responseHeader.SenderBusinessSystemID;
                delete responseHeader.RecipientParty;
                delete responseHeader.SenderBusinessSystemID;
            }
        } catch (error) {

        }
        //  const orderId = shipment.details.shipment?.orderId || '';
        // const documentReference = shipment.details.shipment?.documentReference;
        //  const salesorderno = documentReference.find(item => item.type === '114')?.value || '';
        //  const deliveryno = documentReference.find(item => item.type === '73')?.value || '';
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



            const TrackResponse = await parseTrackingEvents(result, parsedMappings, Carrier, CarrierTrackStatuses, TrackingNumber);
            const Events = TrackResponse.flatMap(event => {

                if (!event.LBN_Status_Code) {
                    return []; // Skip events with null/empty LBN_Status_Code
                }
                // Determine location ONLY for POPU or POD
                let location = null;
                let stop = null;

                if (event.LBN_Status_Code === 'POPU') {
                    location = { InternalID: shipment.details.SHIPPER.LocationID };
                    stop = { ID: '10' };
                }
                else if (event.LBN_Status_Code === 'POD') {
                    location = { InternalID: shipment.details.SHIPTO.LocationID };
                    stop = { ID: '20' };
                }

                return [
                    {
                        EventTypeCode: event.LBN_Status_Code,
                        EventReasonCode: '',
                        EventReasonText: '',
                        ExpectedDateTime: '',
                        EstimatedDateTime: '',
                        ActualDateTime: event.DateTime,
                        ...(location && { Location: location }),   // <-- include ONLY if exists
                        ...(stop && { Stop: stop }),   // <-- include ONLY if exists
                        TextCollection: ''
                    }
                ];
            });


            const responseObj = {
                "soapenv:Envelope": {
                    $: {
                        "xmlns:soapenv": "http://schemas.xmlsoap.org/soap/envelope/",
                        "xmlns": "http://sap.com/xi/SAPGlobal/Global"
                    },
                    "soapenv:Header": {

                    },
                    "soapenv:Body": {
                        "TransportationEventBulkNotification": {
                            MessageHeader: responseHeader,
                            TransportationEventNotificationMessage: {
                                MessageHeader: responseHeader,
                                TransportationEvent: {
                                    Event: Events,
                                    ObjectReference: { TransportationOrderID: shipment.details.HEADER_INFO.DOCUMENT_NUMBER }
                                },


                            }
                        }
                    }
                }
            };


            // --- Build XML ---
            const builder = new xml2js.Builder({
                xmldec: { version: "1.0", encoding: "UTF-8" }
            });
            const responseXml = builder.buildObject(responseObj);
            console.log(responseXml)

            const resultcode = await sendSoapRequest(responseXml)
            return resultcode;
        } catch (error) {
            console.error('Carrier API request failed:', error?.response?.data || error.message);
        }
    } catch (error) {
        console.error(`Error processing shipment ID ${shipment.id}:`, error);
        return error;
    }
}

async function parseTrackingEvents(result, parsedMappings, Carrier, CarrierTrackStatuses, TrackingNo) {
    return result.map(res => {
        const statusCode = getValueByPath(res, parsedMappings?.StatusCode);
        const statusInfo = findCarrierStatusInfo(Carrier, statusCode, CarrierTrackStatuses);

        return {
            TrackingNumber: TrackingNo || '', // Optional, if needed
            Carrier_Tracking_Status_Code: statusCode,
            Carrier_Tracking_Status_Description: statusInfo?.carriereventdescription || getValueByPath(res, parsedMappings?.Status),
            LBN_Status_Code: statusInfo?.lbnstatus || "",
            LBN_Status_Status_Description: statusInfo?.lbndescription || "",
            GTT_Relevent: statusInfo?.gttrelevent || false,

            Location: {
                City: getValueByPath(res, parsedMappings?.City),
                State: getValueByPath(res, parsedMappings?.State),
                PostalCode: getValueByPath(res, parsedMappings?.PostalCode),
                Country: getValueByPath(res, parsedMappings?.Country)
            },
            DateTime: trackuse.formatDateTime(getValueByPath(res, parsedMappings?.DateTime) + 'T' + getValueByPath(res, parsedMappings?.Time))
        };
    });
}


function findCarrierStatusInfo(carrier, carrierStatus, CarrierTrackStatuses) {
    const found = CarrierTrackStatuses.find(entry =>
        entry.details.carrier === carrier && entry.details.carrierstatus === carrierStatus
    );

    if (found) {
        const { carriereventdescription, lbnstatus, lbndescription, gttrelevent } = found.details;
        return { carriereventdescription, lbnstatus, lbndescription, gttrelevent };
    } else {
        return {};
    }
}

async function sendSoapRequest(soapXml) {
    try {
        const url = `https://my411664-api.s4hana.cloud.sap/sap/bc/srt/scs_ext/scmtms/tpevtbntfi?MessageId=${uuidv4()}`;
        const username = "plutocom";
        const password = "Plutocloud@#24072024";

        const inresult = await axios.post(url, soapXml, {
            headers: {
                "Content-Type": "text/xml;charset=UTF-8",
                "SOAPAction":
                    '"http://sap.com/xi/TMS/Global/TransportationOrderConfirmation_In/TransportationOrderConfirmation_InRequest"',
                "Accept-Encoding": "gzip,deflate",
                Connection: "Keep-Alive",
                "User-Agent": "Apache-HttpClient/4.5.5 (Java/17.0.12)"
            },
            auth: {
                username,
                password
            }
        });

        console.log("Response status:", inresult.status);
        console.log("Response data:", inresult.data);
        return inresult.status;
    } catch (error) {
        console.error("SOAP Request failed:", error.message);
        if (error.response) {

            console.error("Response code:", error.response.status);
            console.error("Response body:", error.response.data);
            return error.response.status;
        } else {
            return error.message;
        }
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

router.post('/', async (request, response) => {
    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

    try {
        //const checkquery = `SELECT * FROM public.saptrack WHERE details->>'XTRACKINGNO' = $1`;
        const checkquery = `SELECT * FROM public.shipments WHERE details->'HEADER_INFO'->>'XTRACKINGNO' = $1`;
        const result = await db.query(checkquery, [request.body.XTRACKINGNO]);

        if (result.length > 0) {
            const trackresult = await process_JobTrackShipmentDB(result[0]);
            response.status(trackresult).send('');
        } else {
            console.log('No matching record found.');
            response.status(500).send({ error: 'No matching record found' });
        }
    } catch (error) {
        console.error('Tracking request failed:', error);
        response.status(500).send({ error: 'Tracking request failed' });
    }
});


module.exports = router;