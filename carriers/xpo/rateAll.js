const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');

module.exports = async function abfRateAll(request) {

    let accountNumber = request.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    const chargeCodes = request?.chargeCodeData;
    let rateShopResponse = [];

};