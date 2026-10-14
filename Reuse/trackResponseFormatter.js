const { normalizeToISO } = require('../Reuse/dateNormalizer');

const buildTrackResponse = () => ({
    TRACKING_NUMBER: null,
    EXPECTED_DELIVERY_DATE: null,
    ORIGIN: null,
    DESTINATION: null,
    CURRENT_STATUS: null,
    EVENTS: [],
    ERRORS: []
});

const buildEvent = ({
    trackingNumber,
    status,
    statusCode,
    dateTime,
    location
}) => ({
    TRACKING_NUMBER: trackingNumber,
    STATUS: status,
    STATUS_CODE: statusCode,
    DATE_TIME: normalizeToISO(dateTime),
    LOCATION: {
        CITY: location?.city || null,
        STATE: location?.state || null,
        POSTAL_CODE: location?.postalCode || null,
        COUNTRY: location?.country || null,
        LATITUDE: location?.latitude || null,
        LONGITUDE: location?.longitude || null
    }
});

module.exports = {
    buildTrackResponse,
    buildEvent
};