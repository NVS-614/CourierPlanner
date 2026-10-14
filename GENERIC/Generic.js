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

        let date_ob = new Date();
        let date = ("0" + date_ob.getDate()).slice(-2);
        let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
        let year = date_ob.getFullYear();


        var totalweight = 0;
        var intFreight = 0;
        try {
            if (request.body?.TOTAL_WEIGHT) {
                totalweight = request.body.TotalWeight
            } else {
                request.body.PACKAGES.forEach(element => {
                    totalweight = Number(totalweight) + Number(element.WEIGHT)
                });
            }
        } catch (ex) {totalweight = 1 }
        try {
            request.body.PACKAGES.forEach((piece, index) => {
                request.body.Packages[index].TrackingNumber = year + month + date + date_ob.getHours() + date_ob.getMinutes() + date_ob.getMilliseconds();
              
            })
        } catch (ex) { console.log(ex.response) }
            request.body['SHIPPING_DOCUMENTS'] = []
            request.body['status'] = 'Success'
            request.body['TRACKING_STATUS'] = 'Shipped'

            request.body['shippingCharges'] = []

            // Example 2: if else if else ladder

            try {
                if (request.body.CARRIER_DETAILS?.SERVICE_CODE.toUpperCase() == 'EXPRESS') {
                    intFreight = Number(totalweight * 8.64).toFixed(2);
                } else if (request.body.CARRIER_DETAILS?.SERVICE_CODE.toUpperCase() == 'PRIORITY') {
                    intFreight = Number(totalweight * 11.20).toFixed(2)
                }
                else if (request.body.CARRIER_DETAILS?.SERVICE_CODE.toUpperCase() == 'OVERNIGHT') {
                    intFreight = Number(totalweight * 10.50).toFixed(2);
                }
                else if (request.body.CARRIER_DETAILS?.SERVICE_CODE.toUpperCase() == 'STANDARD') {
                    intFreight = Number(totalweight * 6.60).toFixed(2);
                }
                else {

                    intFreight = Number(totalweight * 6.60).toFixed(2);
                }
            } catch (ex) {
                intFreight = Number(totalweight * 6.60).toFixed(2);
            }
            try {
                var pChargers = {}
                pChargers['description'] = 'Published Freight';
                pChargers['amount'] = intFreight;
                pChargers['currency'] = 'USD';
                request.SHIPPING_CHARGES.push(pChargers);
            } catch (ex) {
                console.log(ex.response);
            }
            try {

                var dChargers = {}
                dChargers['description'] = 'Discounted Freight';
                dChargers['amount'] = intFreight;
                dChargers['currency'] = 'USD';
                request.SHIPPING_CHARGES.push(dChargers);
            } catch (ex) {
                console.log(ex.response);
            }




            var docp = [];

           docp.push(bol.generateBOLPdf(request.body))
           docp.push(documentprocess.prepareLabel_png_sharp(request.body))
           //  docp.push(documentprocess.preparePackingSlip_pdfkit(request.body))
          //   docp.push(documentprocess.prepareCommercialInvoice(request.body))
           //  docp.push(documentprocess.prepareCOO(request.body))

            Promise.all(docp).then(data => {

                data.forEach(docdata => {
                    request.body.SHIPPING_DOCUMENTS.push(docdata);
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

