const bol = require("../../ShippingDocuments/bol.js");
const documentprocess = require("../../ShippingDocuments/documents.js");

module.exports = async (request) => {

    var weightunit = 'LB'
    var currency = 'USD'
    let FINALRESPONSE = {
        STATUS: 'Success',
        TRACKING_STATUS: 'Shipped',
        PACKAGES: [],
        CHARGE_DETAILS: [],
        SHIPPING_DOCUMENTS: [],
        ERRORS: [],
        HEADER_INFO: request.HEADER_INFO
    };

    try {

        let date_ob = new Date();
        let date = ("0" + date_ob.getDate()).slice(-2);
        let month = ("0" + (date_ob.getMonth() + 1)).slice(-2);
        let year = date_ob.getFullYear();


        var totalweight = 0;
        var intFreight = 0;
        try {
            if (request?.TOTAL_WEIGHT) {
                totalweight = request.TOTAL_WEIGHT
            } else {
                request.PACKAGES.forEach(element => {
                    totalweight = Number(totalweight) + Number(element.WEIGHT)
                });
            }
        } catch (ex) { totalweight = 1 }
        try {
            request.PACKAGES.forEach((piece, index) => {
                FINALRESPONSE.PACKAGES.push({
                    TRACKING_NUMBER: piece?.PRO_TRACKING_NUMBER || year + month + date + date_ob.getHours() + date_ob.getMinutes() + date_ob.getMilliseconds()
                });

            });
            FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = FINALRESPONSE.PACKAGES[0].TRACKING_NUMBER
        } catch (ex) { console.log(ex.response) }


        try {
            if (request.CARRIER_DETAILS?.SERVICE_CODE.toUpperCase() == 'EXPRESS') {
                intFreight = Number(totalweight * 8.64).toFixed(2);
            } else if (request.CARRIER_DETAILS?.SERVICE_CODE.toUpperCase() == 'PRIORITY') {
                intFreight = Number(totalweight * 11.20).toFixed(2)
            }
            else if (request.CARRIER_DETAILS?.SERVICE_CODE.toUpperCase() == 'OVERNIGHT') {
                intFreight = Number(totalweight * 10.50).toFixed(2);
            }
            else if (request.CARRIER_DETAILS?.SERVICE_CODE.toUpperCase() == 'STANDARD') {
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
            FINALRESPONSE.CHARGE_DETAILS.push(pChargers);
        } catch (ex) {
            console.log(ex.response);
        }
        try {

            var dChargers = {}
            dChargers['description'] = 'Discounted Freight';
            dChargers['amount'] = intFreight;
            dChargers['currency'] = 'USD';
            FINALRESPONSE.CHARGE_DETAILS.push(dChargers);
        } catch (ex) {
            console.log(ex.response);
        }

        return FINALRESPONSE;
    }
    catch (ex) {
        console.log('main catch', ex.message)
        FINALRESPONSE.STATUS = 'Error';
        FINALRESPONSE.ERRORS.push(ex.message)
        return FINALRESPONSE;

    }

};

