const express = require('express');
const router = express.Router();
const axios = require('axios');
const puppeteer = require('puppeteer');
const moment = require('moment');
// const pdf = require('html-pdf');



async function base64HtmlToPdfAndUpload(base64Html) {
  let browser;
  try {
    // 1. Decode Base64 to HTML
    let html = Buffer.from(base64Html, 'base64').toString('utf-8');

    // Replace local resources
    html = html.replace('./ups_logo.gif', 'https://www.ups.com/assets/resources/images/UPS_logo.svg');
    html = html.replace('<IMG src="./ups_banner.gif" ALT="UPS Banner">', '');
    // 2. Launch browser with Docker-friendly settings
    // browser = await puppeteer.launch({
    //   headless: 'new',
    //   executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null, // Use system Chrome in Docker
    //   args: [
    //     '--no-sandbox',
    //     '--disable-setuid-sandbox',
    //     '--disable-dev-shm-usage',
    //     '--disable-gpu',
    //     '--single-process'
    //   ]
    // });

    const page = await browser.newPage();

    // Set reasonable timeout
    await page.setDefaultNavigationTimeout(60000);

    await page.setContent(html, {
      waitUntil: 'networkidle0'
    });

    // Wait a bit more for stability
    await page.waitForTimeout(1000);

    // Generate PDF
    const pdfBuffer = await page.pdf({
      format: 'A4',
      printBackground: true,
      margin: {
        top: '100px',
        right: '20mm',
        bottom: '20mm',
        left: '20mm'
      }
    });

    return pdfBuffer.toString('base64');

  } catch (error) {
    console.error('Error in PDF conversion:', error);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

async function generatePDFWithPuppeteer(base64Html) {
  // 1. Decode Base64 to HTML
  let html = Buffer.from(base64Html, 'base64').toString('utf-8');
  // Replace local resources
  html = html.replace('./ups_logo.gif', 'https://www.ups.com/assets/resources/images/UPS_logo.svg');
  html = html.replace('<IMG src="./ups_banner.gif" ALT="UPS Banner">', '');

  try {
    const browser = await puppeteer.launch({
      headless: true,
      executablePath: process.env.PUPPETEER_EXECUTABLE_PATH,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });

    const page = await browser.newPage();
    await page.setContent(html);
    const pdfBuffer = await page.pdf({ format: 'A4' });
    await browser.close();
    const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');
    // console.log('pdfBase64 is', pdfBase64);

    return pdfBase64;

  } catch (error) {
    console.log('Puppeteer failed, using PDFKit fallback');
    return null;
  }
}
async function generatePDF(base64Html) {
  // 1. Decode Base64 to HTML
  let html = Buffer.from(base64Html, 'base64').toString('utf-8');

  // 2. Create PDF

  const browser = await puppeteer.launch({
    headless: true,
    args: ["--disable-gpu", "--no-sandbox"],
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "networkidle0" });
  await new Promise((resolve) => setTimeout(resolve, 1000));

  const pdfBuffer = await page.pdf({
    format: "A4",
    printBackground: true,
    margin: { top: "40px", right: "20mm", bottom: "20mm", left: "20mm" },
  });

  await browser.close();
  // Convert buffer to base64
  const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

  return pdfBase64;


}

function formatDateTimemoment(value, format) {
  if (!value || !format) return '';

  const m = moment(value, format, true); // strict parsing

  if (!m.isValid()) return '';

  return m
    .seconds(0)
    .milliseconds(0)
    .toISOString();
}


function formatDateTime(strdate) {
  strdate = strdate.replace("Tundefined", "");

  let dateformat;

  // Handle 20250418T16:38:55
  if (/^\d{8}T\d{2}:\d{2}:\d{2}$/.test(strdate)) {
    const [datePart, timePart] = strdate.split("T");
    dateformat = new Date(
      `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart}`
    );
  }
  // Handle 20250418T163855
  else if (/^\d{8}T\d{6}$/.test(strdate)) {
    const datePart = strdate.slice(0, 8);
    const timePart = strdate.slice(9);
    dateformat = new Date(
      `${datePart.slice(0, 4)}-${datePart.slice(4, 6)}-${datePart.slice(6, 8)}T${timePart.slice(0, 2)}:${timePart.slice(2, 4)}:${timePart.slice(4, 6)}`
    );
  }
  // Handle 20250505 or standard ISO string
  else if (/^\d{8}$/.test(strdate)) {
    dateformat = new Date(
      `${strdate.slice(0, 4)}-${strdate.slice(4, 6)}-${strdate.slice(6, 8)}`
    );
  } else {
    dateformat = new Date(strdate);
  }

  // Normalize seconds and milliseconds
  dateformat.setSeconds(0, 0);

  return dateformat.toISOString().replace(".000Z", "Z");
}



async function parseTrackingEvents(result, parsedMappings, Carrier, CarrierTrackStatuses, plannedeventlist, TrackingNo) {
  return result.map(res => {
    const statusCode = getValueByPath(res, parsedMappings?.StatusCode);
    const statusInfo = findCarrierStatusInfo(Carrier, statusCode, CarrierTrackStatuses);

    const dateVal = getValueByPath(res, parsedMappings.DateTime);
    const timeVal = getValueByPath(res, parsedMappings.Time);
    const dateformat = parsedMappings.DateFormat || 'YYYY-MM-DD';
    const datevalue = timeVal ? `${dateVal} ${timeVal}` : dateVal;
    return {
      TrackingNumber: TrackingNo || '', // Optional, if needed
      Carrier_Tracking_Status_Code: statusCode,
      Carrier_Tracking_Status_Description: statusInfo?.carriereventdescription || getValueByPath(res, parsedMappings?.Status),
      LBN_Status_Code: statusInfo?.lbnstatus || "",
      LBN_Status_Status_Description: statusInfo?.lbndescription || "",
      GTT_Relevent: statusInfo?.gttrelevent || false,
      PlannedEvents: plannedeventlist.includes(statusInfo?.lbnstatus) || false,
      Location: {
        City: getValueByPath(res, parsedMappings?.City),
        State: getValueByPath(res, parsedMappings?.State),
        PostalCode: getValueByPath(res, parsedMappings?.PostalCode),
        Country: getValueByPath(res, parsedMappings?.Country)
      },
      // DateTime: formatDateTime(getValueByPath(res, parsedMappings?.DateTime) + 'T' + getValueByPath(res, parsedMappings?.Time))
      DateTime: formatDateTimemoment(datevalue, dateformat)
    };
  });
}

async function buildSAP_EventRequest(deliveryno, orderId, salesorderno, TrackingNumber, trackingEvents, podbase64, docType, podfileName) {

  const EventRequest = {
    Masterwaybillno: TrackingNumber,
    Milestones: [],
    PodDocumentDetails: []
  };

  trackingEvents.forEach(piece => {
    const [hours, minutes, seconds] = piece.DateTime.split('T')[1].replace('Z', '').split(':').map(Number);
    EventRequest.Milestones.push({
      DocumentNo: deliveryno,
      SalesOrder: salesorderno,
      FreightUnit: '',
      FreightOrder: orderId,
      HandlingUnit: '',
      Masterwaybillno: TrackingNumber,
      Waybillno: TrackingNumber,
      StatusCode: piece.Carrier_Tracking_Status_Code,
      StatusDesc: piece.Carrier_Tracking_Status_Description || '',
      StatusDate: piece.DateTime.split('T')[0] + 'T00:00:00',
      StatusTime: `PT${String(hours).padStart(2, '0')}H${String(minutes).padStart(2, '0')}M${String(seconds).padStart(2, '0')}S`,
      StatusLocation: piece.Location?.City + '' + piece.Location?.State + '' + piece.Location?.PostalCode + '' + piece.Location?.Country
    });
  });
  if (podbase64) {
    EventRequest.PodDocumentDetails.push({
      Masterwaybillno: TrackingNumber,
      FileName: podfileName,
      DocumentReference: TrackingNumber,
      DocumentContent: podbase64,
      ContentType: docType
    });
  }
  return EventRequest;
}


async function buildLBN_EventRequest(requestBody, TrackingNumber, trackingEvents, Carrier, CarrierTrackStatuses, podbase64, strmimeType, podfileName) {
  const SapEventRequest = {
    shipper: { shipperLBNID: requestBody.shipper.shipperLBNID },
    carrier: { carrierLBNID: requestBody.carrier.carrierLBNID },
    technicalId: requestBody.technicalId,
    orderId: requestBody.shipment.orderId,
    trackId: TrackingNumber,
    events: []
  };

  if (requestBody?.networkPartner?.networkPartnerLBNID) {
    SapEventRequest.networkPartner = { networkPartnerLBNID: requestBody.networkPartner.networkPartnerLBNID };
  }

  trackingEvents.forEach(piece => {
    const statusInfo = findCarrierStatusInfo(Carrier, piece.Carrier_Tracking_Status_Code, CarrierTrackStatuses);
    const eventType = statusInfo?.lbnstatus || ""

    if (["DELIVERED", "POD"].includes(eventType.trimEnd().toUpperCase()) && podbase64) {
      const stopInfo = getStopIdByEventType(eventType, requestBody.shipment.stops);
      //  if (stopInfo) {
      SapEventRequest.events.push({
        natureOfEvent: '01',
        reportedBy: 'CARRIER',
        eventType,
        transportationMode: '',
        eventDateTimeUTC: piece.DateTime,
        stopId: stopInfo?.stopId || '',
        ordinalNo: stopInfo?.ordinalNo || '',
        location: {
          Id: '',
          address: { city: piece.Location.City, country: piece.Location.Country, postalCode: piece.Location.PostalCode, region: piece.Location.State }
        },
        attachments: [{
          fileName: podfileName,
          mimeType: strmimeType,
          fileContentBinaryObject: podbase64
        }]
      });

    }
    else if (eventType) {
      const stopInfo = getStopIdByEventType(eventType, requestBody.shipment.stops);
      if (statusInfo?.gttrelevent) {
        SapEventRequest.events.push({
          natureOfEvent: '01',
          reportedBy: 'CARRIER',
          eventType,
          transportationMode: '',
          eventDateTimeUTC: piece.DateTime,
          stopId: stopInfo?.stopId || '',
          ordinalNo: stopInfo?.ordinalNo || '',
          location: {
            Id: '',
            address: { city: piece.Location.City, country: piece.Location.Country, postalCode: piece.Location.PostalCode, region: piece.Location.State }
          },
          attachments: []
        });
      }
    }



  });

  return SapEventRequest;
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
function getStopIdByEventType(eventType, stops) {
  for (const stop of stops) {
    if (stop.plannedEvents.some(event => event.eventType === eventType)) {
      return { stopId: stop.stopId, ordinalNo: stop.ordinalNo };

    }
  }
  return null;
}

function getValueByPath(data, path) {
  try {
    return path.split('.').reduce((acc, key) => {
      if (acc === undefined || acc === null) return undefined;

      // case: [0]
      if (key.startsWith('[')) {
        const index = parseInt(key.replace(/\[|\]/g, ''), 10);
        return acc[index];
      }

      // case: history[0]
      if (key.includes('[')) {
        const [prop, index] = key.split(/\[|\]/).filter(Boolean);
        return acc[prop]?.[parseInt(index, 10)];
      }
      return acc[key];
    }, data);
  } catch {
    return undefined;
  }
}

const FedExPOD = async (TrackingNumber, token) => {
  try {
    let podRequest = {
      trackDocumentDetail: {
        documentType: 'SIGNATURE_PROOF_OF_DELIVERY',
        documentFormat: 'PNG'
      },
      trackDocumentSpecification: [{
        trackingNumberInfo: {
          trackingNumber: TrackingNumber
        }
      }]
    }
    const PodRes = await axios.post('https://apis.fedex.com/track/v1/trackingdocuments', podRequest, {
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`
      }
    });
    return PodRes.data.output.documents[0];
  } catch (error) {
    return '';
  }


};


module.exports = {
  formatDateTime,
  parseTrackingEvents,
  buildLBN_EventRequest,
  findCarrierStatusInfo,
  getValueByPath,
  FedExPOD,
  buildSAP_EventRequest,
  generatePDF,
  generatePDFWithPuppeteer, formatDateTimemoment
};

