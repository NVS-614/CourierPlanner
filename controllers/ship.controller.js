// controllers/ship.controller.js
const ipdchild = require("../carriers/fedex/ipdchild.js");
const ipdclose = require("../carriers/fedex/ipdclose.js");
const ipdmaster = require("../carriers/fedex/ipdmaster.js");
const dbCon = require("../database/dbsaveandupdate.js");
const carrierFactory = require('../factories/carrier.factory');
const docEngine = require('../lib/docEngineClient.js');

exports.ship = async (req, res, next) => {
    try {
        const CarrierDetails = req.body?.CARRIER_DETAILS || req.body?.REQUEST?.CARRIER_DETAILS;
        const HeaderInfo = req.body?.HEADER_INFO || req.body?.REQUEST?.HEADER_INFO;

        let RESPONSE = null;
        const carrierName = CarrierDetails?.CARRIER;
        if (!carrierName) {
            return res.status(400).json({
                RESPONSE: { STATUS: 'Error', ERRORS: ['Carrier is required in request body'] }
            });
        }
        // ── IPD flows — NO validations, straight to handler ──────────────────
        if (HeaderInfo?.ACTION) {
            if (HeaderInfo.ACTION === 'IPDMASTER') {
                RESPONSE = await ipdmaster(req.body.REQUEST);
            } else if (HeaderInfo.ACTION === 'IPDCHILD') {
                RESPONSE = await ipdchild(req.body.REQUEST);
            } else if (HeaderInfo.ACTION === 'IPDCLOSE') {
                RESPONSE = await ipdclose(req.body.REQUEST);
            } else if (HeaderInfo.ACTION === 'IPDDOCS') {
                RESPONSE = await ipdclose(req.body.REQUEST);   // reuse ipdclose for IPDDOCS
            } else {
                return res.status(400).json({
                    RESPONSE: { STATUS: 'Error', ERRORS: [`Unknown ACTION: ${HeaderInfo.ACTION}`] }
                });
            }

        } else {
            // ── Standard ship flow — run all validations ──────────────────────

            const service = CarrierDetails?.SERVICE_CODE || CarrierDetails?.SERVICE_NAME;
            if (!service) {
                return res.status(400).json({
                    RESPONSE: { STATUS: 'Error', ERRORS: ['Service is required in request body'] }
                });
            }

            if (CarrierDetails?.PAYMENT_TYPE) {
                if (CarrierDetails.PAYMENT_TYPE.toUpperCase() === 'SENDER') {
                    if (!CarrierDetails?.SHIPPING_ACCOUNT) {
                        return res.status(400).json({
                            RESPONSE: { STATUS: 'Error', ERRORS: [`ShippingAccount is required when PaymentType is SENDER for ${carrierName}`] }
                        });
                    }
                } else {
                    if (!CarrierDetails?.BILLING_ACCOUNT) {
                        return res.status(400).json({
                            RESPONSE: { STATUS: 'Error', ERRORS: [`BillingAccount is required when PaymentType is 3rd Party or Recipient for ${carrierName}.`] }
                        });
                    }
                }
            }

            const GenericProNo = req.body?.HEADER_INFO?.PRO_TRACKING_NUMBER || req.body?.REQUEST?.HEADER_INFO?.PRO_TRACKING_NUMBER;
            const integrationType = (CarrierDetails?.INTEGRATION_TYPE || '').toUpperCase();
            if (integrationType !== 'API' && CarrierDetails?.SHIPPING_ACCOUNT === '') {
                if (!GenericProNo) {
                    return res.status(400).json({
                        RESPONSE: { STATUS: 'Error', ERRORS: ['PRO_TRACKING_NUMBER is required for non-API integrations'] }
                    });
                }
            }
            const carrier = carrierFactory.getCarrier(carrierName, CarrierDetails);
            if (!carrier.ship) {
                return res.status(400).json({
                    RESPONSE: { STATUS: 'Error', ERRORS: [`Ship not supported for ${carrierName}`] }
                });
            }

            console.log('Ship Request to SIG is', JSON.stringify(req.body));
            const chargeCodeData = await dbCon.fetchChargeCodes();
            RESPONSE = await carrier.ship(req.body.REQUEST, chargeCodeData);
        }

        // ── Only generate documents on successful ship ────────────────────────
        if (RESPONSE?.STATUS === 'Success') {
            let docp = [];
            const forms = req.body.REQUEST?.FORMS || {};

            Object.keys(forms).forEach(formKey => {
                if (forms[formKey] === "GENERIC") {
                    docp.push(
                        docEngine.generateDoc(formKey, req.body.REQUEST, RESPONSE.HEADER_INFO, RESPONSE.PACKAGES)
                    );
                }
            });

            const promiseTimeout = (promise, ms = 15000) =>
                Promise.race([
                    promise,
                    new Promise((_, reject) =>
                        setTimeout(() => reject(new Error("Document processing timeout")), ms)
                    )
                ]);

            try {
                if (docp.length > 0) {
                    const docsData = await promiseTimeout(Promise.allSettled(docp), 15000);
                    docsData.forEach(result => {
                        if (result.status === "fulfilled") {
                            const docdata = result.value;
                            if (Array.isArray(docdata)) {
                                RESPONSE.SHIPPING_DOCUMENTS.push(...docdata);
                            } else if (docdata) {
                                RESPONSE.SHIPPING_DOCUMENTS.push(docdata);
                            }
                        } else {
                            RESPONSE.ERRORS.push(result.reason?.message);
                        }
                    });
                }
            } catch (docError) {
                console.error("Document processing failed:", docError.message);
                RESPONSE.ERRORS.push(docError.message);
            }
        }
        // ─────────────────────────────────────────────────────────────────────

        try {
            // FIX: await the async DB call so errors are caught by the catch block.
            if (RESPONSE?.STATUS === 'Success')
                await dbCon.dbShipsave(RESPONSE);
        } catch (error) {
            console.log(error.message);
        }

        return res.status(200).json({ RESPONSE });

    } catch (err) {
        return res.status(500).json({
            RESPONSE: { STATUS: 'Error', ERRORS: [err.message] }
        });
    }
};