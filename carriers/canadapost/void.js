// carriers/CP/void.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');

module.exports = async function CPVoid(request) {
  try {

    const carrierDetails = request.body.CARRIER_DETAILS;
    const trackingNumber = request.body?.PACKAGES?.[0]?.TRACKING_NUMBER;

    if (!trackingNumber) {
      throw {
        statusCode: 400,
        data: {
          status: 'Error',
          message: 'TrackingNumber is required'
        }
      };
    }


    const voidurl = carrierDetails.VOIDURL || process.env.CANADAPOST_VOID;

    let voidReq = '';

    voidReq += '<?xml version="1.0" encoding="UTF-8"?>';
    voidReq += '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:v8="http://www.canadapost.ca/ws/soap/shipment/v8">';
    voidReq += '<soapenv:Header>';
    voidReq += '<wsse:Security xmlns:wsse="http://docs.oasis-open.org/wss/2004/01/oasis-200401-wss-wssecurity-secext-1.0.xsd">';
    voidReq += '<wsse:UsernameToken>';
    voidReq += `<wsse:Username>${user}</wsse:Username>`;
    voidReq += `<wsse:Password>${password}</wsse:Password>`;
    voidReq += '</wsse:UsernameToken>';
    voidReq += '</wsse:Security>';
    voidReq += '</soapenv:Header>';
    voidReq += '<soapenv:Body>';
    voidReq += '<v8:void-shipment-request>';
    voidReq += `<mailed-by>${account}</mailed-by>`;
    voidReq += '<locale>EN</locale>';
    voidReq += `<shipment-id>${trackingNumber}</shipment-id>`;
    voidReq += '</v8:void-shipment-request>';
    voidReq += '</soapenv:Body>';
    voidReq += '</soapenv:Envelope>';

    console.log('voidReq', voidReq)
    /* ---------- CALL SHIP API ---------- */

    const shipres = await axiosInstance.post(
      voidurl,
      voidReq,
      {
        headers: {
          'Content-Type': 'text/xml;charset=UTF-8',
          'SOAPAction': carrierDetails.VOID_ACTION || process.env.CANADAPOST_VOID_ACTION,
          //'Authorization': basicAuth
        }
      }
    );

    const sres = reuse.parseAndCleanXML(shipres.data);
    if (sres?.cancelledShipment === true) {
      return {
        status: 'Success',
        TrackingNumber: trackingNumber,
        TRACKING_STATUS: 'Cancelled'
      };
    }

    // ❌ Shipment not cancelled
    return {
      status: 'Error',
      TrackingNumber: trackingNumber,
      Errors: [output?.message || 'No shipment found']
    };

  } catch (error) {

    console.error('CP Void Error:', error?.response?.data || error.message);

    throw {
      statusCode: 400,
      data: {
        status: 'Error',
        Errors: [reuse.handleShipErrorRes(error)]
      }
    };
  }
};