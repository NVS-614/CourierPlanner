// carriers/ups/void.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getupsToken } = require('../../Reuse/ups_token_manager');
module.exports = async function upsVoid(request) {

  const carrierDetails = request.CARRIER_DETAILS;
  const trackingNumber = request?.PACKAGES?.[0]?.TRACKING_NUMBER;
  // NOTE: This file is currently a copy of carriers/ups/void.js and points at UPS endpoints.
  // Falls back to UPS_* env vars until a real USPS void implementation is added.
  const tokenurl = carrierDetails.TOKENURL || process.env.UPS_TOKEN;
  const voidurl = carrierDetails.VOIDURL || process.env.UPS_VOID;

  try {

    // ✅ Get token (cached or fresh)

    const token = await getupsToken(tokenurl, carrierDetails.USERID, carrierDetails.PASSWORD, carrierDetails.SHIPPING_ACCOUNT);


    let shipmentidentificationnumber = request.PACKAGES[0]?.TRACKING_NUMBER;

    //console.log(voidurl)
    const cancelRes = await axios.delete(voidurl + `${shipmentidentificationnumber}?trackingnumber=${request.PACKAGES[0]?.TRACKING_NUMBER}`,
      {
        headers: {
          'content-type': 'application/json',
          'authorization': 'Bearer ' + token,
          'transId': '1 ' + request.CARRIER_DETAILS?.SHIPPING_ACCOUNT,
          'transactionSrc': 'SHIPPING_ACCOUNT'
        },
      },
    )

    console.log(cancelRes?.data || cancelRes)


    return {
      STATUS: 'Success',
      TRACKING_NUMBER: trackingNumber,
      TRACKING_STATUS: 'Cancelled'
    };


  } catch (error) {
    console.error('ups Void Error:', error?.response?.data || error.message);
    return {
      STATUS: 'Error',
      TRACKING_NUMBER: trackingNumber,
      ERRORS: [reuse.handleShipErrorRes(error)]
    };
  }
};