const express = require('express');
const router = express.Router();
const axios = require('axios');
const { create } = require('xmlbuilder2');
const reuse = require('../../Reuse/utilityfunctions.js');

module.exports = async function fedexVoid(request) {

    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

    const tokenurl = request.body.CARRIER_DETAILS.TOKENURL || process.env.BLUEDART_TOKEN;
    const voidurl = request.body.CARRIER_DETAILS.VOIDURL || process.env.BLUEDART_VOID;

    let config = {
        method: 'get',
        maxBodyLength: Infinity,

        url: tokenurl,
        headers: {
            'ClientID': request.body.CARRIER_DETAILS.USERID,
            'clientSecret': request.body.CARRIER_DETAILS.PASSWORD
        }
    };

    const tdata = await axios.request(config)
        .catch((ex) => {
            console.log(ex);
            console.log('token Exception:', JSON.stringify(ex.response.data));
            request.body['status'] = 'Error';
            request.body['Errors'] = [];

            request.body.Errors.push(ex.error - response)



            response.send(request.body).status(ex.response.status);
        });

    if (!tdata || !tdata.data) return;

    try {

        let shiprequestJson = {

            Request: {
                AWBNo: request.body.PACKAGES[0]?.TRACKING_NUMBER,
            },
            Profile: {
                Api_type: "S",
                LicenceKey: request.body.CARRIER_DETAILS?.ACCESS_KEY,
                LoginID: request.body.CARRIER_DETAILS?.BILLING_ACCOUNT,
            },
        };
        //  console.log(JSON.stringify(shiprequestJson, null, 2));

        axios.post(
            voidurl, shiprequestJson,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'JWTToken': tdata.data.JWTToken
                },
            },
        ).then((Shipres) => {
            console.log('bluedart Response is ..:');
            //console.log(Shipres.data);


            try {
                if (Shipres.data.CancelWaybillResult.IsError === true) {
                    request.body['status'] = 'Error';
                    request.body['Errors'] = [];
                    request.body.Errors.push(Shipres.data.CancelWaybillResult.Status.StatusInformation);
                }
                else if (Shipres.data.CancelWaybillResult.IsError === false) {
                    let VoidResponse = {}
                    VoidResponse['TrackingNumber'] = request.body.PACKAGES[0]?.TRACKING_NUMBER;
                    VoidResponse['status'] = 'SUCCESS';
                    VoidResponse['TRACKING_STATUS'] = 'Cancelled';
                    response.send(VoidResponse).status(200);
                }

            } catch (ex) { }
        })
            .catch((ex) => {
                console.log('-------------------------------------------------------------------------------Exception is...: ')

                let cleanData = (ex.response.data);
               // cleanData = JSON.parse(cleanData.replace(/(\r\n|\n|\r)/gm, "").replace(/([{,]){2,}/g, "$1").replace('}}', '}')); // Remove redundant braces
                //console.log(cleanData)
                if (cleanData['error-response'][0].IsError === true) {
                    request.body['status'] = 'Error';
                    request.body['Errors'] = [];
                    request.body.Errors.push(cleanData['error-response'][0].Status[0].StatusCode + '_' + cleanData['error-response'][0].Status[0].StatusInformation);

                }
                else;
                response.send(request.body).status(ex.response.status);
            })

    } catch (ex5) {
        console.log(ex5.message)
        response.send(ex5.message).status(200);
    }






    //  response.send('working').status(ex.response.status);
};

module.exports = router;