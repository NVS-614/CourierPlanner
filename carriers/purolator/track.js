// carriers/fedex/track.js

const axios = require('axios');
const getToken = require('../../Reuse/fedex_token_manager.js');
const reuse = require('../../Reuse/utilityfunctions.js');
const { buildTrackResponse, buildEvent } = require('../../Reuse/trackResponseFormatter');
require('dotenv').config();

module.exports = async (request) => {
    const TRACK_RESPONSE = buildTrackResponse();

    try {
        const user = request.body.CARRIER_DETAILS.USERID;
        const password = request.body.CARRIER_DETAILS.PASSWORD;
        const trackurl = request.body.CARRIER_DETAILS.TRACKURL || process.env.PUROLATOR_TRACK;
        const trackAction = request.body.CARRIER_DETAILS.TRACK_KEY || process.env.PUROLATOR_TRACK_ACTION;
        const basicauth = 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64')

        const trackRequest = `<?xml version="1.0" encoding="UTF-8"?>
       <soapenv:Envelope 
           xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" 
           xmlns:v1="http://purolator.com/pws/datatypes/v1">
       
           <soapenv:Header>
               <v1:RequestContext>
                   <v1:Version>1.0</v1:Version>
                   <v1:Language>en</v1:Language>
                   <v1:GroupID></v1:GroupID>
                   <v1:RequestReference>Purolator</v1:RequestReference>
                   <v1:UserToken>${request.body.CARRIER_DETAILS.Token}</v1:UserToken>
               </v1:RequestContext>
           </soapenv:Header>
       
           <soapenv:Body>
               <v1:TrackPackagesByPinRequest>
                   <v1:PINs>
                       <v1:PIN>
                           <v1:Value>${request.body.PACKAGES?.[0]?.TRACKING_NUMBER}</v1:Value>
                       </v1:PIN>
                   </v1:PINs>
               </v1:TrackPackagesByPinRequest>
           </soapenv:Body>
       
       </soapenv:Envelope>`;

        console.log(trackRequest);




        const trackResult = await axios.post(trackurl, trackRequest, {
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
                'SOAPAction': trackAction,
                'Authorization': basicauth

            }
        });

        console.log('purolator Track Response:');
        console.log(trackResult?.data);
        const trackRes = reuse.parseAndCleanXML(trackResult.data);
        if (trackRes?.messages?.message?.description) {
            TRACK_RESPONSE.ERRORS = [trackRes.messages.message.description];
        }



        trackRes["tracking-detail"]["significant-events"]["item"].forEach(eventItem => {
            eventItem.package.forEach(pkg => {

                const EVENT_RES = buildEvent({
                    trackingNumber: pkg.trackingNumber,
                    status: pkg["event-description"],
                    statusCode: pkg["event-identifier"],
                    dateTime: pkg["event-date"],
                    location: {
                        city: pkg["event-site"],
                        state: '',
                        postalCode: '',
                        country: '',
                        latitude: '',
                        longitude: ''
                    }
                });
                TRACK_RESPONSE.EVENTS.push(EVENT_RES);

                // Expected Delivery
                try {
                    TRACK_RESPONSE.EXPECTED_DELIVERY_DATE =
                        '';
                } catch {
                    TRACK_RESPONSE.EXPECTED_DELIVERY_DATE = '';
                }

            });
        });
        return TRACK_RESPONSE;

    } catch (error) {
        TRACK_RESPONSE.ERRORS.push([reuse.handleShipErrorRes(error)]);
    }
};

