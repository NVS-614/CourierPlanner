const axios = require('axios');
const moment = require('moment');
const reuse = require('../../Reuse/utilityfunctions.js');
const trackuse = require("../../SAPTRACK/trackUtilities.js");
const { getupsToken } = require('../../Reuse/ups_token_manager.js');
const { buildTrackResponse, buildEvent } = require('../../Reuse/trackResponseFormatter');
require('dotenv').config();

module.exports = async (request) => {

    const TRACK_RESPONSES = [];

    try {

        const tokenurl =
            request.CARRIER_DETAILS.TOKENURL || process.env.UPS_TOKEN;

        const trackurl =
            request.CARRIER_DETAILS.TRACKURL || process.env.UPS_TRACK;

        const token = await getupsToken(
            tokenurl,
            request.CARRIER_DETAILS.USERID,
            request.CARRIER_DETAILS.PASSWORD,
            request.CARRIER_DETAILS.SHIPPING_ACCOUNT
        );

        // PARALLEL REQUESTS
        //  const trackPromises = request.PACKAGES.map(async (pkg) => {
        const trackPromises = request.PACKAGES.map(pkg => async () => {
            const TRACK_RESPONSE = buildTrackResponse();
            const trackingNumber = pkg.TRACKING_NUMBER;

            TRACK_RESPONSE.TRACKING_NUMBER = trackingNumber;

            try {

                const trackRes = await axios.get(
                    trackurl + trackingNumber +
                    '?locale=en_US&returnSignature=true&returnMilestones=true&returnPOD=true',
                    {
                        headers: {
                            'content-type': 'application/json',
                            authorization: `Bearer ${token}`,
                            transId: request.CARRIER_DETAILS?.REFERENCE1 || 'tracking',
                            transactionSrc: 'SIG'
                        }
                    }
                );

                const shipments = trackRes.data?.trackResponse?.shipment || [];

                for (const shipment of shipments) {

                    if (shipment.warnings?.length) {

                        shipment.warnings.forEach(w =>
                            TRACK_RESPONSE.ERRORS.push(w.message)
                        );

                        continue;
                    }

                    for (const packageData of shipment.package || []) {

                        // EVENTS
                        for (const activity of packageData.activity || []) {

                            const EVENT = buildEvent({
                                trackingNumber,
                                status: activity.status?.description,
                                statusCode: activity.status?.code,
                                dateTime: moment(
                                    activity.date + 'T' + activity.time,
                                    'YYYYMMDDTHHmmss'
                                ).format('YYYY-MM-DDTHH:mm:ss'),
                                location: {
                                    city: activity.location?.address?.city,
                                    state: activity.location?.address?.stateProvince,
                                    postalCode: activity.location?.address?.postalCode,
                                    country: activity.location?.address?.country
                                }
                            });

                            // DELIVERY FILES
                            if (activity.status?.description?.trim() === 'DELIVERED') {

                                try {

                                    if (packageData.deliveryInformation?.pod) {

                                        EVENT.POD =
                                            await trackuse.generatePDFWithPuppeteer(
                                                packageData.deliveryInformation.pod.content
                                            );
                                    }

                                    if (packageData.deliveryInformation?.signature) {

                                        EVENT.SIGNATURE =
                                            packageData.deliveryInformation.signature.image;
                                    }

                                    if (
                                        packageData.deliveryInformation?.deliveryPhoto
                                            ?.photoCaptureInd === 'Y'
                                    ) {

                                        EVENT.PHOTO =
                                            packageData.deliveryInformation.deliveryPhoto.photo;
                                    }

                                } catch (err) {

                                    console.log('POD Error:', err.message);
                                }
                            }

                            TRACK_RESPONSE.EVENTS.push(EVENT);
                        }

                        // EXPECTED DELIVERY DATE
                        try {

                            let delDate = '';
                            let delTime = '';

                            const delObj =
                                packageData.deliveryDate?.find(d => d.type === 'DEL');

                            if (delObj) delDate = delObj.date;

                            if (packageData.deliveryTime?.type === 'DEL') {
                                delTime = packageData.deliveryTime.endTime || '';
                            }

                            if (!delDate) {
                                const sdd =
                                    packageData.deliveryDate?.find(d => d.type === 'SDD');
                                if (sdd) delDate = sdd.date;
                            }

                            if (!delTime && packageData.deliveryTime?.type === 'CDW') {
                                delTime = packageData.deliveryTime.startTime || '';
                            }

                            if (!delDate && packageData.activity?.length) {

                                const latest = packageData.activity[0];
                                delDate = latest.date;
                                delTime = latest.time;
                            }

                            if (delDate) {

                                TRACK_RESPONSE.EXPECTED_DELIVERY_DATE =
                                    moment(delDate + (delTime || '000000'), "YYYYMMDDHHmmss")
                                        .format("YYYY-MM-DDTHH:mm:ss");
                            }

                        } catch (err) {

                            console.log("UPS Delivery Date Parse Error:", err.message);
                        }

                        // CURRENT STATUS
                        TRACK_RESPONSE.CURRENT_STATUS = {
                            STATUS: packageData.currentStatus?.description,
                            STATUS_CODE: packageData.currentStatus?.code
                        };

                        // ORIGIN / DESTINATION
                        for (const addr of packageData.packageAddress || []) {

                            if (addr.type === 'ORIGIN') {

                                TRACK_RESPONSE.ORIGIN = {
                                    CITY: addr.address?.city,
                                    STATE: addr.address?.stateProvince,
                                    POSTAL_CODE: addr.address?.postalCode,
                                    COUNTRY: addr.address?.countryCode
                                };

                            } else {

                                TRACK_RESPONSE.DESTINATION = {
                                    CITY: addr.address?.city,
                                    STATE: addr.address?.stateProvince,
                                    POSTAL_CODE: addr.address?.postalCode,
                                    COUNTRY: addr.address?.countryCode
                                };
                            }
                        }
                    }
                }

            } catch (error) {

                TRACK_RESPONSE.ERRORS.push(
                    reuse.handleShipErrorRes(error)
                );
            }

            return TRACK_RESPONSE;

        });

        //  const results = await Promise.all(trackPromises);
        const results = await promisePool(trackPromises, 5);
        return results;

    } catch (error) {

        return request.PACKAGES.map(pkg => {

            const TRACK_RESPONSE = buildTrackResponse();

            TRACK_RESPONSE.TRACKING_NUMBER = pkg.TRACKING_NUMBER;

            TRACK_RESPONSE.ERRORS.push(
                reuse.handleShipErrorRes(error)
            );

            return TRACK_RESPONSE;
        });
    }
};

async function promisePool(tasks, poolSize = 5) {

    const results = [];
    const executing = [];

    for (const task of tasks) {

        const p = Promise.resolve().then(() => task());
        results.push(p);

        if (poolSize <= tasks.length) {

            const e = p.then(() =>
                executing.splice(executing.indexOf(e), 1)
            );

            executing.push(e);

            if (executing.length >= poolSize) {
                await Promise.race(executing);
            }
        }
    }

    return Promise.all(results);
}