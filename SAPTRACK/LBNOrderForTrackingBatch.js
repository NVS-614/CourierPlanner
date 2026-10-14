const express = require('express');
const router = express.Router();
const axios = require('axios');
const apiRequest = require("../Reuse/apiClient.js");
const trackuse = require("../SAPTRACK/trackUtilities.js");
const dbCon = require("../database/dbsaveandupdate.js");
const { getLBNToken, getCSRFToken } = require('../Reuse/LBNTokenManager.js');

router.put('/', async (request, response) => {
  try {
    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    let dbCarriers = await dbCon.fetchCarriers();
    let bnValue = '';
    const carrierRefDoc = request.body?.shipment?.carrierReferenceDocument ?? [];
    const trackedObjects = request.body?.shipment?.transportMeans?.trackedObjects ?? [];
    if (trackedObjects.length > 0) {
      bnValue =
        trackedObjects.find(d => d.Id?.toUpperCase() === 'PACKAGE_EXT_ID')?.value || null;
    } else if (carrierRefDoc.length > 0) {
      bnValue =
        carrierRefDoc.find(d => d.type?.toUpperCase() === 'BN')?.value ||
        carrierRefDoc.find(d => d.type?.toUpperCase() === 'T67')?.value ||
        carrierRefDoc.find(d => d.type?.toUpperCase() === 'T50')?.value ||
        null;
    }
    const docRef = request.body.shipment?.documentReference ?? [];
    const salesorderno = docRef.find(item => item.type === '114')?.value || '';
    let deliveryno = docRef.find(item => item.type === '73')?.value || '';
    const orderId = request.body.shipment?.orderId.replace(bnValue, '') || '';
    let strSCAC = carrierRefDoc.find(item => item.type === 'SCAC')?.value || 'FEDEX';
    let TrackingNumber = request.body?.trackId || bnValue;
    const found = dbCarriers.find(item =>
      item.details.scac === strSCAC
    );
    const Carrier = found ? found.details.CarrierName : 'FEDEX';
    let lbntrackreq = request.body;
    lbntrackreq.XTRACKINGNO = TrackingNumber,
      lbntrackreq.Carrier = Carrier,
      lbntrackreq.CarrierStatus = '',
      lbntrackreq.LBNStatus = '',
      lbntrackreq.trackingEvents = [];
    const uniqueid = await dbCon.dbTracksaveandUpdate(lbntrackreq);
    let logEntry =
    {
      id: uniqueid,
      dateTime: new Date().toISOString(),
      endpointURL: "/sapTrack/LBNOrderForTracking",
      EventType: "BN4L_NETWORK-EXTERNAL_SYSTEM",
      request: JSON.stringify(request.body),
      response: '',
      StatusCode: ''
    }
    await dbCon.dbSAP_TRACK_transactionssave(logEntry);

    let trackingNumbers = [TrackingNumber];
    if (!Array.isArray(trackingNumbers) || !trackingNumbers.length) {
      return response.status(400).json({ error: 'trackingNumbers required' });
    }

    const promises = trackingNumbers.map(trackingNumber =>
      processTrackingNumber({
        TrackingNumber: trackingNumber,
        requestBody: request.body,
        Carrier,
        deliveryno,
        orderId,
        salesorderno,
        uniqueid,
        lbntrackreq
      })
    );

    const results = await Promise.allSettled(promises);

    return response.status(200).json({
      total: trackingNumbers.length,
      success: results.filter(r => r.status === 'fulfilled').length,
      results
    });

  } catch (error) {
    return response.status(500).json({ error: error.message });
  }
});

async function processTrackingNumber({ TrackingNumber, requestBody, Carrier, deliveryno, orderId, salesorderno, uniqueid, lbntrackreq }) {
  try {
    /** -------------------------------
     * 1. Fetch Carrier Config
     --------------------------------*/
    const getReq = {
      login: process.env.CARRIERCONFIG_ID,
      password: process.env.CARRIERCONFIG_PASSWORD,
      carrier: Carrier
    };
    const CarrierInfo = await axios.post(
      process.env.CARRIERCONFIG_URL,
      getReq,
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
    );

    const CarrierTrackStatuses = CarrierInfo.data.CarrierTrackStatuses;
    const eventTypes = requestBody.shipment.stops.flatMap(eventcodes => eventcodes.plannedEvents.map(code => code.eventType));

    const Trackinfo = CarrierInfo.data.CarrierConfig
      .find(item => item.details.actionType === "Tracking")?.details
      || CarrierInfo.data.CarrierConfig[0]?.details; // Fallback to first item

    if (!Trackinfo) {
      throw new Error("No carrier configuration available");
    }
    const trackingresponsefields = Trackinfo?.trackingresponsefields;
    const TrackPODinfo = CarrierInfo.data.CarrierConfig
      .find(item => item.details.actionType === "POD")?.details

    let podbase64 = '', strmimeType = "application/pdf"; docType = 'PDF'; podfileName = '';
    let trackPayload = null;
    let getapiToken = null;
    /** -------------------------------
     * 2. Token API call
     --------------------------------*/
    if (Trackinfo.tokenurl) {
      let tokenPayload = Trackinfo.tokenpayload;
      let header = { 'Content-Type': 'application/x-www-form-urlencoded' };
      if (tokenPayload.includes('###BASIC###')) {
        strToken = Buffer.from(`${Trackinfo.userid}:${Trackinfo.password}`).toString('base64');
        header['Authorization'] = `Basic ${strToken}`;
        tokenPayload = tokenPayload.replace('###BASIC###', '');
      } else {
        tokenPayload = tokenPayload
          .replace('###USER###', Trackinfo.userid)
          .replace('###PASSWORD###', Trackinfo.password);
      }
      const TokenResponse = await apiRequest('POST', Trackinfo.tokenurl, {
        payload: tokenPayload,
        headers: header
      });
      getapiToken = TokenResponse.access_token;
    }
    /** -------------------------------
        * 3. Tracking API call
        --------------------------------*/
    if (Trackinfo.trackpayload) {
      trackPayload = Trackinfo.trackpayload.replace('###TRACK###', TrackingNumber);
    }
    if (Trackinfo.authenticationtype.includes('Basic')) {
      getapiToken = Buffer.from(`${Trackinfo.userid}:${Trackinfo.password}`).toString('base64');
    }
    const TrackResponseAPI = await apiRequest(
      Trackinfo.mime,
      Trackinfo.endpointurl.replace('###TRACK###', TrackingNumber),
      {
        payload: trackPayload,
        headers: JSON.parse(Trackinfo.headers.replace('###TOKEN###', getapiToken))
      }
    );
    Response = TrackResponseAPI.output || TrackResponseAPI;

    try {
      const logEntryetc =
      {
        id: uniqueid,
        dateTime: new Date().toISOString(),
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

    /** -------------------------------
     * 4. Parse Tracking Response
     --------------------------------*/
    const mappings = trackingresponsefields.split('\n');
    const parsedMappings = mappings.reduce((acc, mapping) => {
      const [key, value] = mapping.split('#');
      if (key && value) acc[key.trim()] = value.trim();
      return acc;
    }, {});

    const plannedeventlist = requestBody.shipment.stops.flatMap(
      s => s.plannedEvents.map(e => e.eventType)
    );

    const result = trackuse.getValueByPath(Response, parsedMappings.TrackEvents);
    if (!Array.isArray(result)) throw new Error('Invalid tracking response');

    /** -------------------------------
     * 5. POD logic (carrier-specific)
     --------------------------------*/


    try {
      if (Carrier === 'UPS' && Response.trackResponse.shipment[0].package[0].currentStatus.description.trimEnd().toUpperCase() === 'DELIVERED') {
        let strpoddata = Response.trackResponse.shipment[0].package[0]?.deliveryInformation;
        try {
          if (strpoddata?.pod) {
            //  podbase64 = (strpoddata.pod.content) //await trackuse.base64HtmlToPdfAndUpload
            podbase64 = await trackuse.generatePDFWithPuppeteer(strpoddata.pod.content)
            podfileName = TrackingNumber + '_POD.pdf',
              docType = 'pdf'

          }
        } catch (error) {
          podbase64 = (strpoddata.pod.content)
          podfileName = TrackingNumber + '_POD.pdf', docType = 'pdf'
          console.log('PDF error is', error);
        }
      }
      if (Carrier === 'FEDEX' && Response.completeTrackResults[0].trackResults[0].latestStatusDetail.description.trimEnd().toUpperCase() === 'DELIVERED') {
        podbase64 = await trackuse.FedExPOD(TrackingNumber, getapiToken);
        strmimeType = 'image/png'; docType = 'PNG'; podfileName = TrackingNumber + '_POD.PNG'
      }
    } catch (error) {
      console.log('POD  error : ', error.message)
    }
    try {
      if (TrackPODinfo) {
        const TrackPODResponseAPI = await apiRequest(
          TrackPODinfo.mime,
          TrackPODinfo.endpointurl.replace('###TRACK###', TrackingNumber),
          {
            payload: trackPayload,
            headers: JSON.parse(TrackPODinfo.headers.replace('###TOKEN###', getapiToken))
          }
        );
      }
    } catch (error) {
      console.log('POD  error : ', error.message)
    }

    /** -------------------------------
     * 5. Normalize Events
     --------------------------------*/
    const ParseTrackingEventResponse = await trackuse.parseTrackingEvents(result, parsedMappings, Carrier, CarrierTrackStatuses, plannedeventlist, TrackingNumber);
    lbntrackreq.trackingEvents = ParseTrackingEventResponse;
    const latestUpdate = ParseTrackingEventResponse.reduce((latest, current) => {
      return new Date(current.DateTime) > new Date(latest.DateTime) ? current : latest;
    }, ParseTrackingEventResponse[0]);

    try {
      if (podbase64) {
        lbntrackreq.POD = {
          encodedLabel: podbase64,
          docType: docType
        }
      }
    } catch (error) {

    }

    lbntrackreq.CarrierStatus = latestUpdate.Carrier_Tracking_Status_Description.trimEnd().toUpperCase(); //Carrier_Tracking_Status_Code
    lbntrackreq.LBNStatus = latestUpdate.LBN_Status_Code,

      await dbCon.dbTracksaveandUpdate(lbntrackreq);
    /** -------------------------------
     * 6. Post to SAP SAP_ZPC
     --------------------------------*/

    try {
      const sapEventRequest = await trackuse.buildSAP_EventRequest(deliveryno, orderId, salesorderno, TrackingNumber, lbntrackreq.trackingEvents, podbase64, docType, podfileName);
      console.log(sapEventRequest);

      const [csrfToken, cookies] = await getCSRFToken();
      // Make sure we got cookies
      if (!cookies) {
        throw new Error('No cookies received in initial request');
      }
      // Now make the POST request with both CSRF token AND cookies
      const sapRes = await axios.post(process.env.LBN_SAP_TRACK_MILESTONE_URL, sapEventRequest,
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
    }

    /** -------------------------------
     * 6. Post to SAP LBN CLOUD
     --------------------------------*/


    const token = await getLBNToken();
    const lbnCloudEventRequest = await trackuse.buildLBN_EventRequest(requestBody, TrackingNumber, lbntrackreq.trackingEvents, Carrier, CarrierTrackStatuses, podbase64, strmimeType, podfileName);
    // console.log(JSON.stringify(lbnCloudEventRequest));
    let logEntryets =
    {
      id: uniqueid,
      dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
      endpointURL: process.env.LBN_CLOUD_ORDEREVENTS_URL,
      EventType: "EXTERNAL_SYSTEM-BN4L_NETWORK",
      request: JSON.stringify(lbnCloudEventRequest),
      response: null,
      StatusCode: null
    }
    const sapRes = await axios.post(process.env.LBN_CLOUD_ORDEREVENTS_URL, lbnCloudEventRequest, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });
    logEntryets.response = JSON.stringify(sapRes.data)
    logEntryets.StatusCode = '200'
    console.log('LBN_CLOUD_ORDEREVENTS success');
    await dbCon.dbSAP_TRACK_transactionssave(logEntryets);
    return {
      trackingNumber: TrackingNumber,
      status: 'SUCCESS'
    };
  } catch (error) {
    logEntryets.response = JSON.stringify(error?.response?.data || { message: error.message }),
      logEntryets.StatusCode = '500'
    console.log('LBN_CLOUD_ORDEREVENTS error', error.message);
    await dbCon.dbSAP_TRACK_transactionssave(logEntryets);
    return {
      trackingNumber: TrackingNumber,
      status: 'Error',
      error: error.message
    };
  }
}


module.exports = router;
