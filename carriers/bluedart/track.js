const express = require('express');
const router = express.Router();
const axios = require('axios');
const { create } = require('xmlbuilder2');
const reuse = require('../../Reuse/utilityfunctions.js');

router.post('/', async (request, response) => {

    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

    const tokenurl = request.body.CARRIER_DETAILS.TOKENURL || process.env.BLUEDART_TOKEN;
    const trackurl = request.body.CARRIER_DETAILS.TRACKURL || process.env.BLUEDART_TRACK;

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





    //  response.send('working').status(ex.response.status);
});

module.exports = router;