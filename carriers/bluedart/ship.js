const express = require('express');
const router = express.Router();
const axios = require('axios');
const { create } = require('xmlbuilder2');
const xml2js = require('xml2js');
const reuse = require('../../Reuse/utilityfunctions.js');
const fs = require('fs');

const labeldocprocess = require("../../ShippingDocuments/labeldocuments.js");
const documentprocess = require("../../ShippingDocuments/documents.js");

router.post('/', async (request, response) => {



    response.header("Access-Control-Allow-Origin", "*");
    response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

    try {
        const tokenurl = request.CARRIER_DETAILS.TOKENURL || process.env.BLUEDART_TOKEN;
        const shipurl = request.CARRIER_DETAILS.SHIPURL || process.env.BLUEDART_SHIP;


        let config = {
            method: 'get',
            maxBodyLength: Infinity,

            url: tokenurl,
            headers: {
                'ClientID': request.CARRIER_DETAILS.USERID,
                'clientSecret': request.CARRIER_DETAILS.PASSWORD
            }
        };

        const tdata = await axios.request(config)
            .catch((ex) => {
                console.log(ex);
                console.log('token Exception:', JSON.stringify(ex?.response?.data) || ex);
                request['status'] = 'Error';
                request['Errors'] = [];
                request.Errors.push(ex.error - response)
                response.send(request).status(ex.response?.status);
            });

        if (!tdata || !tdata.data) return;


        console.log(tdata.data.JWTToken)
        let ShipPay = '';
        if (request.CARRIER_DETAILS.PAYMENT_TYPE.toUpperCase() === 'B2B') { ShipPay = '' }
        else if (request.CARRIER_DETAILS.PAYMENT_TYPE.toUpperCase() === 'SENDER') { ShipPay = 'P' }
        else if (request.CARRIER_DETAILS.PAYMENT_TYPE.toUpperCase() == 'COLLECT') { ShipPay = 'C' }
        else { ShipPay = '' }


        const [datePart, timePart] = request.HEADER_INFO.SHIP_DATE.split('T');
        let OriginArea = 'HYD';
        let CollactableAmount = 0;
        // Create an XML document

        let shiprequestJson = {

            Request: {
                Consignee: {
                    ConsigneeAddress1: request.SHIPTO.ADDRESS_LINE1,
                    ConsigneeAddress2: request.SHIPTO.ADDRESS_LINE2,
                    ConsigneeAddress3: request.SHIPTO.ADDRESS_LINE3,
                    ConsigneeMobile: request.SHIPTO.PHONE,
                    ConsigneeName: request.SHIPTO.COMPANY,
                    ConsigneePincode: request.SHIPTO.ZIPCODE,
                    ConsigneeEmailID: request.SHIPTO.EMAIL,
                },
                Services: {
                    ActualWeight: request.PACKAGES[0].Weight,
                    CreditReferenceNo: request.HEADER_INFO.DOCUMENT_NUMBER,
                    DeclaredValue: 1,
                    Dimensions: request.Packages
                        .filter((element) => element?.DIMENSION)
                        .map((element) => {
                            const dims = element.DIMENSION.toUpperCase().split('X');
                            return {
                                Breadth: Number(dims[1]),
                                Count: 1,
                                Height: Number(dims[2]),
                                Length: Number(dims[0]),
                            };
                        }),

                    PickupTime: timePart.substring(0, 5).replace(':', ''),
                    PieceCount: request.PACKAGES.length,
                    ProductCode: request.CARRIER_DETAILS?.SERVICE_CODE,
                    SubProductCode: ShipPay,
                    CollactableAmount: (request?.SHIPMENT_LVL_SPECIAL_SERVICES?.COD_amount)
                },
                Shipper: {
                    CustomerAddress1: request.SHIPPER.ADDRESS_LINE1,
                    CustomerAddress2: request.SHIPPER.ADDRESS_LINE2,
                    CustomerCode: request.CARRIER_DETAILS.SHIPPING_ACCOUNT,
                    CustomerMobile: request.SHIPPER.PHONE,
                    CustomerName: request.SHIPPER.COMPANY,
                    CustomerPincode: request.SHIPPER.ZIPCODE,
                    CustomerEmailID: request.SHIPPER.EMAIL,
                  //  isToPayCustomer: true,
                    OriginArea: request?.SHIPMENT_LVL_SPECIAL_SERVICES?.Origin || 'HYD',
                },
            },
            Profile: {
                Api_type: "S",
                LicenceKey: request.CARRIER_DETAILS?.ACCESS_KEY,
                LoginID: request.CARRIER_DETAILS.MeterId,

            },

        };

        console.log(JSON.stringify(shiprequestJson, null, 2));


        axios.post(shipurl, shiprequestJson,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'JWTToken': tdata.data.JWTToken
                },
            },
        ).then((Shipres) => {
            console.log('bluedart Response is ..:');
            //  console.log(Shipres?.data || Shipres);
            try {

                if (Shipres.data?.GenerateWayBillResult?.AWBNo) {
                  //  request.PACKAGES[0]?.TRACKING_NUMBER = Shipres.data.GenerateWayBillResult.AWBNo;
                    request['SHIPPING_DOCUMENTS'] = []
                    request['status'] = 'Success'
                    request['TRACKING_STATUS'] = 'Shipped'
                    request['shippingCharges'] = []

                    const AWBPrintContent = Shipres.data.GenerateWayBillResult.AWBPrintContent; // Replace with your actual AWBPrintContent

                    // Step 1: Decode the Base64 content into binary data
                    const binaryData = Buffer.from(AWBPrintContent,);
                    const base64String = binaryData.toString('base64');

                    try {
                        fs.writeFile('./Labels/' + Shipres.data.GenerateWayBillResult.AWBNo + '.pdf', binaryData, (err) => {
                            if (err) {
                                console.error('Error writing PDF file:', err);
                            } else {
                                console.log('PDF file has been successfully created: waybill.pdf');
                            }
                        });
                    } catch (error) {
                        console.log(error.message)
                    }
                    // Step 2: Write the binary data to a PDF file

                    strLabel = {};
                    strLabel['contentType'] = 'Label'
                    strLabel['copiesToPrint'] = '1'
                    strLabel['encodedLabel'] = base64String
                    strLabel['docType'] = 'PDF'
                    request.SHIPPING_DOCUMENTS.push(strLabel);


                    let docp = [];

                    docp.push(documentprocess.preparePackingSlip_pdfkit(request))
                    //docp.push(labeldocprocess.preparelabel_pdfkit(request))

                    Promise.all(docp).then(data => {

                        data.forEach(docdata => {
                            if (Array.isArray(docdata)) {
                                docdata.forEach(packdata => {
                                    request.SHIPPING_DOCUMENTS.push(packdata);
                                });
                            }
                            else {
                                request.SHIPPING_DOCUMENTS.push(docdata);
                            }
                        })

                        response.send(request).status(200);

                    })
                }

            } catch (ex) { console.log(ex.message) }



        })
            .catch((ex) => {
                console.log('-------------------------------------------------------------------------------Exception is...: ')
                let cleanData = (ex.response?.data);
                console.log(cleanData)

                // cleanData = JSON.parse(cleanData.replace(/(\r\n|\n|\r)/gm, "").replace(/([{,]){2,}/g, "$1").replace('}}', '}')); // Remove redundant braces
                finalResponse = {};
                request['status'] = 'Error';
                request['Errors'] = [];
                // ex.response.data.error - response.forEach((er) => {
                request.Errors.push(cleanData['error-response'][0].Status[0].StatusCode + '_' + cleanData['error-response'][0].Status[0].StatusInformation);

                //  request.Errors.push((cleanData));
                // });
                response.send(request).status(ex.response.status);
            })
    } catch (ex5) {
        console.log(ex5.message)
        response.send(ex5.message).status(200);
    }






    //  response.send('working').status(ex.response.status);
});

module.exports = router;