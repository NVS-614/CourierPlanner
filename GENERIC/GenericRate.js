const express = require('express');
const router = express.Router();

const ExcelJS = require('exceljs');

router.post('/', async (request, response) => {

  try {

    var weightunit = 'LBS'
    var currency = 'USD'
    var totalweight = 0;


    if (request.body?.TOTAL_WEIGHT) {
      totalweight = request.body.TotalWeight
    } else {
      request.body.PACKAGES.forEach(element => {
        totalweight = Number(totalweight) + Number(element.WEIGHT)
      });
    }

    var rateShopResponse = []


    // const [datePart, timePart] = request.body.HEADER_INFO.SHIP_DATE.split('T');

    var erateShop = {}
    erateShop['Carrier'] = request.body.CARRIER_DETAILS.CARRIER;
    erateShop['AccountNumber'] = request.body.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    erateShop['serviceCode'] = 'Express';
    erateShop['serviceName'] = 'Express';
    erateShop['publishedFreight'] = Number(totalweight * 8.64).toFixed(2);
    erateShop['discountFreight'] = Number(totalweight * 8.64).toFixed(2);
    try {
      erateShop['expectedDeliveryDate'] = '';
      erateShop['transitDays'] = '';
    } catch (ex) { }
    rateShopResponse.push(erateShop);
    var prateShop = {}
    prateShop['Carrier'] = request.body.CARRIER_DETAILS.CARRIER;
    prateShop['AccountNumber'] = request.body.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    prateShop['serviceCode'] = 'Priority';
    prateShop['serviceName'] = 'Priority';
    prateShop['publishedFreight'] = Number(totalweight * 11.20).toFixed(2);
    prateShop['discountFreight'] = Number(totalweight * 11.20).toFixed(2);
    try {
      prateShop['expectedDeliveryDate'] = '';
      prateShop['transitDays'] = '';
    } catch (ex) { }
    rateShopResponse.push(prateShop);
    var orateShop = {}
    orateShop['Carrier'] = request.body.CARRIER_DETAILS.CARRIER;
    orateShop['AccountNumber'] = request.body.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    orateShop['serviceCode'] = 'Overnight';
    orateShop['serviceName'] = 'Overnight';
    orateShop['publishedFreight'] = Number(totalweight * 10.50).toFixed(2);
    orateShop['discountFreight'] = Number(totalweight * 10.50).toFixed(2);
    try {
      orateShop['expectedDeliveryDate'] = '';
      orateShop['transitDays'] = '';
    } catch (ex) { }
    rateShopResponse.push(orateShop);
    var srateShop = {}
    srateShop['Carrier'] = request.body.CARRIER_DETAILS.CARRIER;
    srateShop['AccountNumber'] = request.body.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    srateShop['serviceCode'] = 'Standard';
    srateShop['serviceName'] = 'Standard';
    srateShop['publishedFreight'] = Number(totalweight * 6.60).toFixed(2);
    srateShop['discountFreight'] = Number(totalweight * 6.60).toFixed(2);
    try {
      srateShop['expectedDeliveryDate'] = '';
      srateShop['transitDays'] = '';
    } catch (ex) { }
    rateShopResponse.push(srateShop);
    response.send(rateShopResponse).status(200);





  } catch (error) {
    console.error('Error :', error);
  }

  //  response.send('working').status(ex.response.status);
});


module.exports = router;