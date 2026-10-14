// carriers/fedex/void.js

const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getFedexToken } = require('../../Reuse/fedex_token_manager.js');
const { getCSPFedexToken } = require('../../Reuse/fedex_csptoken_manager.js');

module.exports = async function fedexVoid(request) {

  const carrierDetails = request.CARRIER_DETAILS || {};
  const HeaderInfo = request.HEADER_INFO || {};

  // Pick tracking number from PACKAGES first, otherwise fall back to MASTER_TRACKING_NUMBER
  const trackingNumber =
    request?.PACKAGES?.[0]?.TRACKING_NUMBER ||
    HeaderInfo?.MASTER_TRACKING_NUMBER;

  const tokenurl = carrierDetails.TOKENURL || process.env.FEDEX_TOKEN;

  // Decide the VOID URL based on the ACTION flag
  let voidurl;
  if (HeaderInfo?.ACTION === 'IPDMASTER') {
    voidurl = carrierDetails.VOIDURL || process.env.FEDEX_VOID_IPDMASTER;
  } else if (HeaderInfo?.ACTION === 'IPDCHILD') {
    voidurl = carrierDetails.VOIDURL || process.env.FEDEX_VOID_IPDCHILD;
  } else {
    voidurl = carrierDetails.VOIDURL || process.env.FEDEX_VOID_SHIPMENT;
  }

  const CSPuserId = carrierDetails.CSP_USER || process.env.FEDEX_CSPUSER;
  const CSPpassword = carrierDetails.CSP_PASSWORD || process.env.FEDEX_CSPPASSWORD;

  try {
    const token = await getCSPFedexToken(
      tokenurl,
      CSPuserId,
      CSPpassword,
      carrierDetails.USERID,
      carrierDetails.PASSWORD,
      carrierDetails.SHIPPING_ACCOUNT
    );

    // Build the void payload as per the ACTION
    let voidRequest;

    if (HeaderInfo?.ACTION === 'IPDMASTER') {
      // Format SHIP_DATE to YYYY-MM-DD for consolidationKey.date
      const shipDate = HeaderInfo?.SHIP_DATE
        ? String(HeaderInfo.SHIP_DATE).split('T')[0]
        : new Date().toISOString().split('T')[0];

      voidRequest = {
        accountNumber: {
          value: carrierDetails.SHIPPING_ACCOUNT
        },
        consolidationKey: {
          date: shipDate,
          index: trackingNumber,
          type: HeaderInfo?.CONSOLIDATION_TYPE ||
            carrierDetails?.CONSOLIDATION_TYPE ||
            'INTERNATIONAL_PRIORITY_DISTRIBUTION'
        },
        trackingId: {
          trackingIdType: HeaderInfo?.TRACKING_ID_TYPE || 'EXPRESS',
          formId: HeaderInfo?.FORM_ID || '0201',
          trackingNumber: trackingNumber
        }
      };

    } else if (HeaderInfo?.ACTION === 'IPDCHILD') {
      voidRequest = {
        accountNumber: {
          value: carrierDetails.SHIPPING_ACCOUNT
        },
        deletionControl: 'DELETE_ONE_PACKAGE',
        trackingNumber: trackingNumber,
        resourceKey: HeaderInfo?.RESOURCE_KEY || carrierDetails?.RESOURCE_KEY
      };

    } else {
      // Existing/default void (single or multi-piece cancel)
      voidRequest = {
        accountNumber: {
          value: carrierDetails.SHIPPING_ACCOUNT
        },
        // senderCountryCode: request?.SHIPPER?.COUNTRY,
        deletionControl: 'DELETE_ALL_PACKAGES',
        trackingNumber: trackingNumber
      };
    }

    const cancelRes = await axios.put(voidurl, voidRequest, {
      headers: {
        'content-type': 'application/json',
        'authorization': `Bearer ${token}`
      }
    });

    const output = cancelRes?.data?.output;
    const isEmptyObject = output && Object.keys(output).length === 0;

    if (
      output?.cancelledShipment === true ||
      (isEmptyObject && cancelRes.status === 200)
    ) {
      return {
        STATUS: 'Success',
        TRACKING_NUMBER: trackingNumber,
        TRACKING_STATUS: 'Cancelled'
      };
    }

    // ❌ Shipment not cancelled
    return {
      STATUS: 'Error',
      TRACKING_NUMBER: trackingNumber,
      ERRORS: [output?.message || 'No shipment found']
    };

  } catch (error) {
    console.error('FedEx Void Error:', error?.response?.data || error.message);
    return {
      STATUS: 'Error',
      TRACKING_NUMBER: trackingNumber,
      ERRORS: [reuse.handleShipErrorRes(error)]
    };
  }
};