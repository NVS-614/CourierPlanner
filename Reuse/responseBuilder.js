function buildFinalResponse(request = {}) {

    const {
        HEADER_INFO = {},
        CARRIER_DETAILS = {}
    } = request;

    return {
        STATUS: '',
        TRACKING_STATUS: '',
        CARRIER: CARRIER_DETAILS.CARRIER || '',
        ACCOUNT_NUMBER: CARRIER_DETAILS.ACCOUNT_NUMBER || '',
        SERVICE_CODE: CARRIER_DETAILS.SERVICE_CODE || '',
        SERVICE_NAME: CARRIER_DETAILS.SERVICE_NAME || '',
        DISCOUNTED_FREIGHT: '',
        PUBLISHED_FREIGHT: '',
        EXPECTED_DELIVERY_DATE: '',
        TRANSIT_DAYS: '',
        CURRENCY: '',
        PACKAGES: [],
        CHARGE_DETAILS: [],
        SHIPPING_DOCUMENTS: [],
        ERRORS: [],
        HEADER_INFO
    };
}

module.exports = { buildFinalResponse };