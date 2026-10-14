const express = require('express');
const router = express.Router();
const axios = require('axios');

module.exports = async function ESTESRateAll(request) {
    const rateurl = request.CARRIER_DETAILS.RATEURL || process.env.AVERITT_RATE;

    let weightunit = 'LBS'
    let currency = 'USD'
    let rateShopResponse = []

    try {

        let date_ob = new Date();
        let date = ("0" + date_ob.getDate()).slice(-2);
        let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
        let year = date_ob.getFullYear();



        let rateRequest = {};
        rateRequest['accountNumber'] = request.CARRIER_DETAILS.SHIPPING_ACCOUNT;
        let paymentType = 'Prepaid'; //Collect
        let customerType = 'Shipper'; //Consignee ,Third Party
        //If the account is the origin location then the value is 'Shipper'.
        //If the account is the destination then 'Consignee'.
        //account is neither the origin nor destination then 'Third Party'.
        if (request.CARRIER_DETAILS.PAYMENT_TYPE == 'Sender') { paymentType = 'Prepaid'; customerType = 'Shipper' }
        else if (request.CARRIER_DETAILS.PAYMENT_TYPE == 'Recipient') { paymentType = 'Collect' }
        else if (request.CARRIER_DETAILS.PAYMENT_TYPE == 'ThirdParty') { paymentType = 'Collect' }
        else if (request.CARRIER_DETAILS.PAYMENT_TYPE == 'Collect') { paymentType = 'Collect' }

        rateRequest['customerType'] = customerType;

        //->Shipper
        rateRequest['originCity'] = request.SHIPPER.CITY;
        rateRequest['originState'] = request.SHIPPER.STATE;
        rateRequest['originZip'] = request.SHIPPER.ZIPCODE;
        //->consignee 
        rateRequest['destinationCity'] = request.SHIPTO.CITY;
        rateRequest['destinationState'] = request.SHIPTO.STATE;
        rateRequest['destinationZip'] = request.SHIPTO.ZIPCODE;
        rateRequest['shipDate'] = request.HEADER_INFO.SHIP_DATE;
        rateRequest['paymentType'] = paymentType;

        rateRequest['shipmentInfo'] = {}
        rateRequest.shipmentInfo['items'] = []

        let cubicFeet = 0;
        request.PACKAGES.forEach(element => {
            xlineItem = {}
            xlineItem['shipmentClass'] = element.LTL_CLASS;
            xlineItem['shipmentWeight'] = Number(element.WEIGHT);
            rateRequest.shipmentInfo.items.push(xlineItem)
            if (element?.DIMENSION) {
                dims = element.DIMENSION.toUpperCase().split('X');
                cubicFeet = cubicFeet + (Number(dims[0]) * Number(dims[1]) * Number(dims[2])) / 1728;
            }
        });
        rateRequest.shipmentInfo['accessorials'] = {};
        const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES;
        if (SLSS?.DELIVERY_NOTIFICATION === 'true') { rateRequest.shipmentInfo.accessorials['arrivalNotify'] = true }
        if (SLSS?.CONVENTION_CENTER_DELIVERY === 'true') { rateRequest.shipmentInfo.accessorials['conventionCenterDelivery'] = true }
        if (SLSS?.CONSTRUCTION_SITE_DELIVERY === 'true') { rateRequest.shipmentInfo.accessorials['constructionSiteDelivery'] = true }
        if (SLSS?.INSIDE_DELIVERY === 'true') { rateRequest.shipmentInfo.accessorials['insideDelivery'] = true }
        if (SLSS?.LIFT_GATE_DELIVERY === 'true') { rateRequest.shipmentInfo.accessorials['liftgate'] = true }
        if (SLSS?.HAZMAT === 'true') { rateRequest.shipmentInfo.accessorials['hazmat'] = true }
        if (SLSS?.RESIDENTIAL_DELIVERY === 'true') { rateRequest.shipmentInfo.accessorials['residentialDelivery'] = true }
        if (SLSS?.NON_COMMERCIAL_PICKUP_DELIVERY === 'true') { rateRequest.shipmentInfo.accessorials['nonCommercialPickupDelivery'] = true }
        if (SLSS?.SECURITY_INSPECTION === 'true') { rateRequest.shipmentInfo.accessorials['securityInspection'] = true }




        rateRequest.shipmentInfo['numPieces'] = request.PACKAGES.length;
        rateRequest.shipmentInfo['numHandlingUnits'] = request.PACKAGES.length;
        rateRequest.shipmentInfo['cubicFeet'] = cubicFeet.toString();
        if (SLSS?.OVER_LENGTH === 'true') { rateRequest.shipmentInfo['overLength'] = 'OVL8' } //OVL8', 'OVL12', 'OVL16', 'OVL20'

        //shipmentInfo.additionalCargoLiability

        rateRequest['deliveryOption'] = 'All'
        //'Standard' or 'GuaranteedBy5' or 'All'. If this field is omitted or blank then 'Standard' will be used.


        console.log('Averitt Rate Request is')
        console.log(JSON.stringify(rateRequest))

        response.header("Access-Control-Allow-Origin", "*");
        response.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");

        let URL = rateurl + `?api_key=${request.CARRIER_DETAILS.Token}`

        axios.post(
            URL, rateRequest,
            {
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'Host': ' api.averittexpress.com',
                },
            },
        ).then((sres) => {
            console.log('Averitt Rate Response is ..:');
            console.log(JSON.stringify(sres.data))

            let rateShop = {}
            rateShop['Carrier'] = 'Averitt'
            rateShop['AccountNumber'] = request.CARRIER_DETAILS.SHIPPING_ACCOUNT;
            rateShop['serviceCode'] = 'Standard';
            rateShop['serviceName'] = 'Standard';
            rateShop['publishedFreight'] = sres.data.quoteDetails.totalCharge;
            rateShop['discountFreight'] = sres.data.quoteDetails.totalCharge;
            try {
                rateShop['expectedDeliveryDate'] = sres.data.quoteDetails.estimatedDeliveryDate;
                rateShop['transitDays'] = sres.data.quoteDetails.estimatedServiceDays;
            } catch (ex) { }
            try {
                surCharges = [];
                sres.data.accessorialCharges.forEach((packelement) => {

                    let surChargeslist = {}
                    surChargeslist['type'] = packelement.description;
                    surChargeslist['description'] = packelement.description;
                    surChargeslist['amount'] = packelement.value;


                    surCharges.push(surChargeslist);

                });
                rateShop.surCharges = surCharges;
            } catch (ex) { }

            rateShopResponse.push(rateShop);

            try {
                if (sres.data.quoteDetails.guaranteedBy5TotalCharge) {
                    let rateShop5 = {}
                    rateShop5['Carrier'] = 'Averitt'
                    rateShop5['AccountNumber'] = request.CARRIER_DETAILS.SHIPPING_ACCOUNT;
                    rateShop5['serviceCode'] = 'guaranteedBy5';
                    rateShop5['serviceName'] = 'guaranteedBy5';
                    rateShop5['publishedFreight'] = sres.data.quoteDetails.guaranteedBy5TotalCharge;
                    rateShop5['discountFreight'] = sres.data.quoteDetails.guaranteedBy5TotalCharge;
                    try {
                        rateShop5['expectedDeliveryDate'] = sres.data.quoteDetails.guaranteedBy5estimatedDeliveryDate;
                        rateShop5['transitDays'] = sres.data.quoteDetails.estimatedServiceDays;
                    } catch (ex) { }
                    rateShopResponse.push(rateShop5);
                }
            } catch (ex) { }


            response.send(rateShopResponse).status(200);



        })
            .catch((ex) => {
                console.log('--------------------------------Exception is...: ')
                // console.log(ex.response)

                console.log(ex.response.data.message)

                finalResponse = {};
                request['status'] = 'Error';
                request['Errors'] = [];
                if (ex.response.status) {
                    request.Errors.push(ex.response.data);
                    //  request.Errors.push(ex.response.statusText);
                }


                // ex.response.data.errors.forEach((er) => { 
                //     request.Errors.push(er.message);
                //     request.Errors.push(er.code);
                //     //console.log(er.message) 
                // });
                response.send(request).status(ex.response.status);
            })


    }
    catch (ex) {
        console.log(ex.message)
        request['status'] = 'Error';
        request['Errors'] = [ex.message];
        response.send(request).status(400);
    }
};
