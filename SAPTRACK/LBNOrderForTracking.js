const express = require('express');
const router = express.Router();
const axios = require('axios');
const apiRequest = require("../Reuse/apiClient.js");
const trackuse = require("../SAPTRACK/trackUtilities.js");
const dbCon = require("../database/dbsaveandupdate.js");
const { getLBNToken,getCSRFToken } = require('../Reuse/LBNTokenManager.js');
router.put('/', async (request, response) => {
  try {
    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

    let dbCarriers = await dbCon.fetchCarriers();

    let podbase64 = '', strmimeType = "application/pdf"; docType = 'PDF';
    let podfileName = '';
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
    const TrackingNumber = request.body?.trackId || bnValue;
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
      dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
      endpointURL: "/sapTrack/LBNOrderForTracking",
      EventType: "BN4L_NETWORK-EXTERNAL_SYSTEM",
      request: JSON.stringify(request.body),
      response: '',
      StatusCode: ''
    }
    await dbCon.dbSAP_TRACK_transactionssave(logEntry);

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
      return response.status(400).json({ status: 'Error', message: error.response?.data?.message || 'Carrier config fetch failed' });
    }

    if (!CarrierInfo?.data?.CarrierConfig?.length) {
      return response.status(400).json({ error: "Carrier Configuration Not Found" });
    }
    const CarrierTrackStatuses = CarrierInfo.data.CarrierTrackStatuses;
    const eventTypes = request.body.shipment.stops.flatMap(eventcodes => eventcodes.plannedEvents.map(code => code.eventType));

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
            headers: Trackinfo.headers//{ 'Content-Type': 'application/json', transId: 'test', transactionSrc: 'testing' }
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
            headers: Trackinfo.headers//{ 'Content-Type': 'application/json', transId: 'test', transactionSrc: 'testing' }
          }
        );

        Response = TrackResponse.output || TrackResponse;

      }


      try {
        const logEntryetc =
        {
          id: uniqueid,
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

      const plannedeventlist = request.body.shipment.stops.flatMap(eventcodes => eventcodes.plannedEvents.map(code => code.eventType));

      const result = trackuse.getValueByPath(Response, parsedMappings?.TrackEvents);
      if (!Array.isArray(result)) {
        return response.status(400).json({ error: "Invalid tracking response format" });
      }


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
      // return response.status(200).send({ podbase64 })
      try {
        if (Carrier === 'FEDEX' && Response.completeTrackResults[0].trackResults[0].latestStatusDetail.description.trimEnd().toUpperCase() === 'DELIVERED') {
          podbase64 = await trackuse.FedExPOD(TrackingNumber, getapiToken);
          strmimeType = 'image/png'; docType = 'PNG'; podfileName = TrackingNumber + '_POD.PNG'
        }
      } catch (error) {

      }

      const TrackResponse = await trackuse.parseTrackingEvents(result, parsedMappings, Carrier, CarrierTrackStatuses, plannedeventlist, TrackingNumber);


      lbntrackreq.trackingEvents = TrackResponse;
      const latestUpdate = TrackResponse.reduce((latest, current) => {
        return new Date(current.DateTime) > new Date(latest.DateTime) ? current : latest;
      }, TrackResponse[0]);

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

    } catch (error) {
      return response.status(500).json({ error: error?.message || "Internal server error" });
    }


    try {
      const sapEventRequest = await trackuse.buildSAP_EventRequest(deliveryno, orderId, salesorderno, TrackingNumber, lbntrackreq.trackingEvents, podbase64, docType, podfileName);
      console.log(sapEventRequest);
     

      const [csrfToken,cookies] = await getCSRFToken();
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
      if (error.response) {
        console.log('Response headers:', error.response.headers);
        console.log('Response status:', error.response.status);
      }
    }

    const token = await getLBNToken();


    const lbnEventRequest = await trackuse.buildLBN_EventRequest(request.body, TrackingNumber, lbntrackreq.trackingEvents, Carrier, CarrierTrackStatuses, podbase64, strmimeType, podfileName);

    // console.log(JSON.stringify(lbnEventRequest));
    try {
      const sapRes = await axios.post(process.env.LBN_CLOUD_ORDEREVENTS_URL, lbnEventRequest, { headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` } });

      const logEntryets =
      {
        id: uniqueid,
        dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
        endpointURL: process.env.LBN_CLOUD_ORDEREVENTS_URL,
        EventType: "EXTERNAL_SYSTEM-BN4L_NETWORK",
        request: JSON.stringify(lbnEventRequest),
        response: JSON.stringify(sapRes.data),
        StatusCode: 200
      }
      await dbCon.dbSAP_TRACK_transactionssave(logEntryets);
      console.log('success');
      return response.status(200).json(sapRes.data);
    } catch (error) {
      const logEntryets =
      {
        id: uniqueid,
        dateTime: new Date().toISOString(), //"2025-04-26T00:00:00",
        endpointURL: process.env.LBN_CLOUD_ORDEREVENTS_URL,
        EventType: "EXTERNAL_SYSTEM-BN4L_NETWORK",
        request: JSON.stringify(lbnEventRequest),
        response: JSON.stringify(error?.response?.data || { message: error.message }),
        StatusCode: 500
      }
      await dbCon.dbSAP_TRACK_transactionssave(logEntryets);
      console.log("SAP API request failed", error.message);
      return response.status(500).json({ error: "SAP API request failed" });
    }
  } catch (error) {
    return response.status(500).json({ error: error?.message });
  }
});



module.exports = router;
