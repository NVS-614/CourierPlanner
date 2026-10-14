const express = require('express');
const router = express.Router();
const axios = require('axios');
const bol = require("../ShippingDocuments/bol.js");
const documentprocess = require("../ShippingDocuments/documents.js");
const { json } = require('body-parser');

router.post('/', async (request, response) => {

    var weightunit = 'LB'
    var currency = 'USD'
    var rateShopResponse = []


    try {

            request.body['HUDocuments'] = []
            request.body['status'] = 'Success'
        
            var docp = [];
            docp.push(bol.generateBOLPdf(request.body))
           
            Promise.all(docp).then(data => {

                data.forEach(docdata => {
                    request.body.HUDocuments.push(docdata);
                })

                response.send(request.body).status(200);

            })




        }
    catch (ex) {
            console.log(ex.message)
            finalResponse = {};
            request.body['status'] = 'Error';
            request.body['Errors'] = [];
            request.body.Errors.push(ex.message)
            response.send(request.body).status(400);

        }

    });


module.exports = router;

