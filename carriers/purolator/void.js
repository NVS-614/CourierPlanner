// carriers/purolator/void.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');

module.exports = async function purolatorVoid(request) {
  try {
    const voidurl = request.CARRIER_DETAILS.VOIDURL || process.env.PUROLATOR_VOID;
    const VoidRequest = `<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope 
    xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
    xmlns:v2="http://purolator.com/pws/datatypes/v2">

    <soapenv:Header>
        <v2:RequestContext>
            <v2:Version>2.0</v2:Version>
            <v2:Language>en</v2:Language>
            <v2:GroupID></v2:GroupID>
            <v2:RequestReference>Purolator</v2:RequestReference>
            <v2:UserToken>${request.CARRIER_DETAILS.ACCESS_KEY}</v2:UserToken>
        </v2:RequestContext>
    </soapenv:Header>

    <soapenv:Body>
        <v2:VoidShipmentRequest>
            <v2:PIN>
                <v2:Value>${request.PACKAGES?.[0]?.TRACKING_NUMBER}</v2:Value>
            </v2:PIN>
        </v2:VoidShipmentRequest>
    </soapenv:Body>

</soapenv:Envelope>`;

    console.log(VoidRequest);
    const cancelRes = await axios.post(voidurl, VoidRequest, {
      headers: {
        'Content-Type': 'text/xml;charset=UTF-8',
        'SOAPAction': request.CARRIER_DETAILS.VOID_ACTION || process.env.PUROLATOR_VOID_ACTION,
        'Authorization': 'Basic ' + Buffer.from(`${request.CARRIER_DETAILS.USERID}:${request.CARRIER_DETAILS.PASSWORD}`).toString('base64')

      },
    });

    const Voidres = reuse.parseAndCleanXML(cancelRes.data);
    const responseInfo = Voidres?.Envelope?.Body?.VoidShipmentResponse;
    if (responseInfo.ShipmentVoided === 'true') {
      return {
        STATUS: 'Success',
        TRACKING_NUMBER: request.PACKAGES[0]?.TRACKING_NUMBER,
        TRACKING_STATUS: 'Cancelled'
      };

    } else if (responseInfo?.ResponseInformation?.Errors?.Error) {
      return {
        STATUS: 'Error',
        TRACKING_NUMBER: request.PACKAGES[0]?.TRACKING_NUMBER,
        ERRORS: [responseInfo.ResponseInformation.Errors.Error?.Description || 'No shipment found']
      };
    }
  } catch (error) {
    console.error('purolator Void Error:', error?.response?.data || error?.message);
    if (error?.response?.data) {
      const Voidres = reuse.parseAndCleanXML(error.response?.data);
      return {
        STATUS: 'Error',
        TRACKING_NUMBER: request.PACKAGES[0]?.TRACKING_NUMBER,
        ERRORS: [Voidres.Envelope.Body.Fault.faultstring._ || 'No shipment found']
      };
    }
    else {
      return {
        STATUS: 'Error',
        TRACKING_NUMBER: request.PACKAGES[0]?.TRACKING_NUMBER,
        ERRORS: [error?.message || 'No shipment found']
      };
    }

  }
};