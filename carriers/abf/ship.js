// carriers/abf/ship.js

const axios = require('axios');
const moment = require('moment');
const reuse = require('../../Reuse/utilityfunctions.js');
const Getcode = require('../../Reuse/ServicesandCodes.js');
const labeldocprocess = require("../../ShippingDocuments/labeldocuments.js");
const documentprocess = require("../../ShippingDocuments/documents.js");


const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});


module.exports = async (request, chargeCodes) => {

    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER } = request;

    let FINALRESPONSE = {
        STATUS: '',
        TRACKING_STATUS: '',
        PACKAGES: [],
        CHARGE_DETAILS: [],
        SHIPPING_DOCUMENTS: [],
        ERRORS: [],
        HEADER_INFO
    };
    try {
        // Get rates first
        const strRateQuote = await Getabfrates(request, FINALRESPONSE, chargeCodes);
        console.log('Rate Quote:', strRateQuote);

        const shipurl =
            CARRIER_DETAILS.SHIPURL || process.env.ABF_SHIP;

        // --------------------
        // Prepare BOL Request
        // --------------------
        const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES || {};
        const [datePart] = HEADER_INFO.SHIP_DATE.split('T');
        const [year, month, day] = datePart.split('-');

        const date = `${month}/${day}/${year}`;

        // --------------------
        // Accessorial Flags
        // --------------------
        const accessorials = {
            Acc_GRD_PU: isTrue(SLSS?.LIFT_GATE_PICKUP) ? 'Y' : '',
            Acc_GRD_DEL: isTrue(SLSS?.LIFT_GATE_DELIVERY) ? 'Y' : '',
            Acc_IPU: isTrue(SLSS?.INSIDE_PICKUP) ? 'Y' : '',
            Acc_IDEL: isTrue(SLSS?.INSIDE_DELIVERY) ? 'Y' : '',
            Acc_LAP: isTrue(SLSS?.LIMITED_ACCESS_PICKUP) ? 'Y' : '',
            Acc_LAD: isTrue(SLSS?.LIMITED_ACCESS_DELIVERY) ? 'Y' : '',
            Acc_CSD: isTrue(SLSS?.CONSTRUCTION_SITE_DELIVERY) ? 'Y' : '',
            Acc_RPU: isTrue(SLSS?.RESIDENTIAL_PICKUP) ? 'Y' : '',
            Acc_RDEL: isTrue(SLSS?.RESIDENTIAL_DELIVERY) ? 'Y' : '',
            Acc_SEG: isTrue(SLSS?.SORT_AND_SEGREGATE) ? 'Y' : '',
            Acc_FRE: isTrue(SLSS?.PROTECT_FROM_FREEZING) ? 'Y' : '',
            Acc_SS: isTrue(SLSS?.SINGLE_SHIPMENT) ? 'Y' : '',
            Acc_BOND: isTrue(SLSS?.IN_BOND) ? 'Y' : '',
            Acc_OD: isTrue(SLSS?.OVER_LENGTH) ? 'Y' : '',
            Acc_ARR: isTrue(SLSS?.DELIVERY_NOTIFICATION) ? 'Y' : ''
        };

        const LAPType = accessorials.Acc_LAP ? 'O' : '';
        const LADType = accessorials.Acc_LAD ? 'O' : '';
        const SegPieces = accessorials.Acc_SEG ? '1' : '';

        // --------------------
        // Payment Logic
        // --------------------
        let RequesterType = '1';
        let PayTerms = 'P';

        if (
            CARRIER_DETAILS.PAYMENT_TYPE?.toUpperCase() === 'SENDER'
        ) {
            PayTerms = 'P';
            RequesterType = '1';
        }

        // --------------------
        // Build Query Params
        // --------------------
        const params = [];

        // Basic Info
        params.push(
            `DL=2`,
            `ID=${CARRIER_DETAILS?.ACCESS_KEY}`,
            `Test=Y`,
            `RequesterType=${RequesterType}`,
            `PayTerms=${PayTerms}`,
            `RequesterName=${SHIPPER.CONTACT}`,
            `RequesterEmail=${SHIPPER.EMAIL}`,
            `RequesterPhone=${SHIPPER.PHONE}`
        );

        // Shipper
        params.push(
            `ShipContact=${SHIPPER.CONTACT}`,
            `ShipName=${SHIPPER.COMPANY}`,
            `ShipAddress=${SHIPPER.ADDRESS_LINE1}`,
            `ShipCity=${SHIPPER.CITY}`,
            `ShipState=${SHIPPER.STATE}`,
            `ShipZip=${SHIPPER.ZIPCODE?.substring(0, 5) || ''}`,
            `ShipCountry=${SHIPPER.COUNTRY}`,
            `ShipPhone=${SHIPPER.PHONE}`
        );

        // Consignee
        params.push(
            `ConsContact=${SHIPTO.CONTACT}`,
            `ConsName=${SHIPTO.COMPANY}`,
            `ConsAddress=${SHIPTO.ADDRESS_LINE1}`,
            `ConsCity=${SHIPTO.CITY}`,
            `ConsState=${SHIPTO.STATE}`,
            `ConsZip=${SHIPTO.ZIPCODE?.substring(0, 5) || ''}`,
            `ConsCountry=${SHIPTO.COUNTRY}`,
            `ConsPhone=${SHIPTO.PHONE}`
        );

        // Shipment Info
        params.push(
            `ShipDate=${date}`,
            `PickupDate=${date}`,
            `ShipYear=${year}`,
            `ProAutoAssign=Y`,
            `LWHType=IN`,
            `AT=07:00`,
            `TO=09:00`,
            `FileFormat=A`,
            `InkJetPrinter=Y`
        );

        // --------------------
        // Package Details
        // --------------------
        PACKAGES.forEach((piece, index) => {
            const i = index + 1;

            params.push(
                `HN${i}=${piece.QUANTITY || 1}`,
                `HT${i}=${piece.HANDLING_UNIT_TYPE || 'BAG'}`,
                `CL${i}=${piece.LTL_CLASS || 50}`,
                `WT${i}=${Math.floor(Number(piece.WEIGHT))}`,
                `PN${i}=${piece.QUANTITY || 1}`,
                `PT${i}=${piece.ITEM_PACKING_TYPE || 'BAG'}`
            );

            if (piece.DIMENSION) {
                const [l, w, h] = piece.DIMENSION.toUpperCase().split('X');
                params.push(
                    `FrtLng${i}=${Number(l)}`,
                    `FrtWdth${i}=${Number(w)}`,
                    `FrtHght${i}=${Number(h)}`
                );
            }
        });

        // --------------------
        // Accessorial Params
        // --------------------
        params.push(
            `Acc_GRD_PU=${accessorials.Acc_GRD_PU}`,
            `Acc_IPU=${accessorials.Acc_IPU}`,
            `Acc_LAP=${accessorials.Acc_LAP}`,
            `Acc_RPU=${accessorials.Acc_RPU}`,
            `Acc_CSD=${accessorials.Acc_CSD}`,
            `Acc_GRD_DEL=${accessorials.Acc_GRD_DEL}`,
            `Acc_IDEL=${accessorials.Acc_IDEL}`,
            `Acc_LAD=${accessorials.Acc_LAD}`,
            `Acc_RDEL=${accessorials.Acc_RDEL}`,
            `Acc_OD=${accessorials.Acc_OD}`,
            `Acc_BOND=${accessorials.Acc_BOND}`,
            `Acc_SS=${accessorials.Acc_SS}`,
            `Acc_FRE=${accessorials.Acc_FRE}`,
            `Acc_SEG=${accessorials.Acc_SEG}`,
            `Acc_ARR=${accessorials.Acc_ARR}`,
            `LAPType=${LAPType}`,
            `LADType=${LADType}`,
            `SegPieces=${SegPieces}`
        );

        // Final URL
        const finalUrl = shipurl + params.join('&');

        // --------------------
        // API Call
        // --------------------
        const config = {
            method: 'post',
            maxBodyLength: Infinity,
            url: finalUrl,
            headers: {},
            data: ''
        };

        const bolResponse = await axiosInstance.request(config);
        // Process BOL response
        const Shipres = reuse.parseAndCleanXML(bolResponse.data);

        if (Shipres.ABF.NUMERRORS > 0) {
            FINALRESPONSE.STATUS = 'Error';
            let errorMessage = Shipres.ABF?.ERROR?.ERRORMESSAGE;
            FINALRESPONSE.ERRORS = Array.isArray(errorMessage) ? errorMessage : [errorMessage];
            return FINALRESPONSE;
        }
        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Shipped';
        PACKAGES.forEach(pkg => {
            pkg.TRACKING_NUMBER = Shipres.ABF.PRONUMBER;
            FINALRESPONSE.PACKAGES.push({ TRACKING_NUMBER: Shipres.ABF.PRONUMBER });
        });
        FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = FINALRESPONSE.PACKAGES[0]?.TRACKING_NUMBER;

        try {
            const base64data = await reuse.pdfURLToBase64(Shipres.ABF.DOCUMENT);
            let docName = PACKAGES[0]?.TRACKING_NUMBER + '_BOL.PDF', docNamenew = '';
            try {
                //reuse.uploadbufferFile(base64data.data, docName);
            } catch (error) {
                console.log(error.message)
            }
            const formatDoc = reuse.formatShipDoc('ABF', 'Bill Of Lading', 1, docName, base64data, 'PDF')
            FINALRESPONSE.SHIPPING_DOCUMENTS.push(formatDoc)

        } catch (ex) { console.log(ex.message) }

        let docp = [];
        // Generate other documents
        let labelPromise;
        if (CARRIER_DETAILS?.LABELTYPE === 'ZPL') {
            docp.push(documentprocess.preparelabel_ZPL(request));
        } else if (CARRIER_DETAILS?.LABELTYPE === 'PNG') {
            docp.push(documentprocess.prepareLabel_png_sharp(request));
        } else {
            docp.push(labeldocprocess.preparelabel_pdfkit(request));
        }
        const docs = await Promise.all([
            labelPromise,
            documentprocess.preparePackingSlip_pdfkit(request)
        ]);
        /* ---------------------------
 Promise.all with timeout
----------------------------*/

        const promiseTimeout = (promise, ms) => {
            return Promise.race([
                promise,
                new Promise((_, reject) =>
                    setTimeout(() => reject(new Error("Document processing timeout")), ms)
                )
            ]);
        };
        try {
            if (docp.length > 0) {
                const data = await promiseTimeout(Promise.all(docp), 15000);

                data.forEach(docdata => {
                    try {
                        if (Array.isArray(docdata)) {
                            docdata.forEach(rdocdata =>
                                FINALRESPONSE.SHIPPING_DOCUMENTS.push(rdocdata)
                            );
                        } else if (docdata) {
                            FINALRESPONSE.SHIPPING_DOCUMENTS.push(docdata);
                        }
                    } catch (err) {
                        console.error("Document parse error:", err.message);
                    }
                });
            }
        } catch (docError) {
            console.error("Document processing failed:", docError.message);
            FINALRESPONSE.ERRORS.push(docError.message);
        }

        return FINALRESPONSE;

    } catch (ex) {
        console.error("abf Ship Error:", ex?.response?.data || ex.message);
        FINALRESPONSE.STATUS = 'Error';
        let errordesc = reuse.handleShipErrorRes(ex);
        FINALRESPONSE.ERRORS = errordesc;
        return FINALRESPONSE;
    }
};


async function Getabfrates(request, FINALRESPONSE, chargeCodes) {
    const { HEADER_INFO, CARRIER_DETAILS, PACKAGES, SHIPTO, SHIPPER } = request;

    try {
        const rateurl = CARRIER_DETAILS.RATEURL || process.env.ABF_RATE;
        // -----------------------------
        // 1️⃣ Ship Date Parsing
        // -----------------------------
        const [datePart] = HEADER_INFO.SHIP_DATE.split('T');
        const [year, month, day] = datePart.split('-');
        // -----------------------------
        // 2️⃣ Helpers
        // -----------------------------
        const isTrue = (val) => String(val).toLowerCase() === 'true';
        const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES || {};

        const params = {};

        // -----------------------------
        // 3️⃣ Mandatory
        // -----------------------------
        params.DL = 2;
        params.ID = CARRIER_DETAILS?.ACCESS_KEY;

        // -----------------------------
        // 4️⃣ Payment Logic (Cleaned)
        // -----------------------------
        const paymentType = CARRIER_DETAILS.PAYMENT_TYPE?.toUpperCase();

        if (paymentType === 'SENDER') {
            params.ShipAff = 'Y';
            params.ShipPay = 'Y';
        }
        else if (paymentType === 'RECIPIENT') {
            params.ConsAff = 'Y';
            params.ConsPay = 'Y';
        }
        else if (['THIRD', '3RD'].includes(paymentType)) {
            params.TPBAff = 'Y';
            params.TPBPay = 'Y';
        }

        // -----------------------------
        // 5️⃣ Shipper
        // -----------------------------
        Object.assign(params, {
            ShipName: SHIPPER.COMPANY,
            ShipAddr: SHIPPER.ADDRESS_LINE1,
            ShipCity: SHIPPER.CITY,
            ShipState: SHIPPER.STATE,
            ShipZip: SHIPPER.ZIPCODE?.substring(0, 5) || '',
            ShipCountry: SHIPPER.COUNTRY,
            ShipAcct: CARRIER_DETAILS.SHIPPING_ACCOUNT || ''
        });

        // -----------------------------
        // 6️⃣ Consignee
        // -----------------------------
        Object.assign(params, {
            ConsName: SHIPTO.COMPANY,
            ConsAddr: SHIPTO.ADDRESS_LINE1,
            ConsCity: SHIPTO.CITY,
            ConsState: SHIPTO.STATE,
            ConsZip: SHIPTO.ZIPCODE?.substring(0, 5) || '',
            ConsCountry: SHIPTO.COUNTRY,
            ConsAcct: CARRIER_DETAILS?.BILLING_ACCOUNT || ''
        });

        // -----------------------------
        // 7️⃣ Third Party (Only if needed)
        // -----------------------------
        if (params.TPBAff === 'Y' && SOLDTO) {
            Object.assign(params, {
                TPBName: SOLDTO.COMPANY,
                TPBAddr: SOLDTO.ADDRESS_LINE1,
                TPBCity: SOLDTO.CITY,
                TPBState: SOLDTO.STATE,
                TPBZip: SOLDTO.ZIPCODE?.substring(0, 5) || '',
                TPBCountry: SOLDTO.COUNTRY,
                TPBAcct: CARRIER_DETAILS?.BILLING_ACCOUNT || ''
            });
        }

        // -----------------------------
        // 8️⃣ Ship Date
        // -----------------------------
        params.ShipMonth = month;
        params.ShipDay = day;
        params.ShipYear = year;

        // =======================================================
        // 🔥 9️⃣ SPECIAL OPTIONS (Clean + With Dependencies)
        // =======================================================

        // ---------- PICKUP ----------
        if (isTrue(SLSS.LIFT_GATE_PICKUP)) params.Acc_GRD_PU = 'Y';
        if (isTrue(SLSS.INSIDE_PICKUP)) params.Acc_IPU = 'Y';
        if (isTrue(SLSS.RESIDENTIAL_PICKUP)) params.Acc_RPU = 'Y';

        if (isTrue(SLSS.LIMITED_ACCESS_PICKUP)) {
            params.Acc_LAP = 'Y';
            params.LAPType = 'O';  // Required dependency
        }

        // ---------- DELIVERY ----------
        if (isTrue(SLSS.LIFT_GATE_DELIVERY)) params.Acc_GRD_DEL = 'Y';
        if (isTrue(SLSS.INSIDE_DELIVERY)) params.Acc_IDEL = 'Y';
        if (isTrue(SLSS.RESIDENTIAL_DELIVERY)) params.Acc_RDEL = 'Y';

        if (isTrue(SLSS.LIMITED_ACCESS_DELIVERY)) {
            params.Acc_LAD = 'Y';
            params.LADType = 'O';  // Required dependency
        }
        // Construction Site (Delivery only in your mapping)
        if (isTrue(SLSS.CONSTRUCTION_SITE_DELIVERY)) {
            params.Acc_CSD = 'Y';
        }

        // ---------- FREIGHT OPTIONS ----------

        // Overlength → requires longest side value
        if (isTrue(SLSS.OVER_LENGTH)) {
            params.Acc_OD = 'Y';

            if (SLSS.ODLongestSide) {
                params.ODLongestSide = Number(SLSS.ODLongestSide);
            }
        }

        // Sort & Segregate → requires piece count
        if (isTrue(SLSS.SORT_AND_SEGREGATE)) {
            params.Acc_SEG = 'Y';
            params.SegPieces = Number(SLSS.SEG_PIECE_COUNT || 1);
        }

        if (isTrue(SLSS.PROTECT_FROM_FREEZING)) params.Acc_FRE = 'Y';
        if (isTrue(SLSS.DELIVERY_NOTIFICATION)) params.Acc_ARR = 'Y';
        if (isTrue(SLSS.SINGLE_SHIPMENT)) params.Acc_SS = 'Y';
        if (isTrue(SLSS.IN_BOND)) params.Acc_BOND = 'Y';

        // -----------------------------
        // 🔟 Package Details
        // -----------------------------
        PACKAGES.forEach((piece, index) => {
            const i = index + 1;

            params[`Class${i}`] = piece.LTL_CLASS || 50;
            params[`Wgt${i}`] = Math.floor(Number(piece.WEIGHT));
            params[`UnitNo${i}`] = piece.QUANTITY || 1;
            params[`UnitType${i}`] = piece.ITEM_PACKING_TYPE || 'BAG';

            if (piece.DIMENSION) {
                const [l, w, h] = piece.DIMENSION.toUpperCase().split('X');
                params[`FrtLng${i}`] = Number(l);
                params[`FrtWdth${i}`] = Number(w);
                params[`FrtHght${i}`] = Number(h);
            }
        });

        params.FrtLWHType = 'IN';

        // -----------------------------
        console.log(rateurl, params);

        // ✅ USE AWAIT
        const rateResponse = await axios.post(rateurl, null, {
            params,
            timeout: 15000
        });

        console.log('ABF Response received');
        const Shiprateres = reuse.parseAndCleanXML(rateResponse.data);

        if (Shiprateres.ABF.NUMERRORS > 0) {
            throw new Error(Shiprateres.ABF.ERROR.ERRORMESSAGE);
        }
        const service = CARRIER_DETAILS?.SERVICE_CODE || CARRIER_DETAILS?.SERVICE_NAME;
        // Process standard charges
        if (service === 'STD' || service === 'STD') {
            FINALRESPONSE.CHARGE_DETAILS.push(
                reuse.ShipRateRes('Published Freight', Shiprateres.ABF.CHARGE, 'USD', 'LIST'),
                reuse.ShipRateRes('Discounted Freight', Shiprateres.ABF.CHARGE, 'USD', 'DISC')
            );
        }
        // Process guaranteed options
        if (Shiprateres.ABF.GUARANTEEDOPTIONS?.OPTION) {
            Shiprateres.ABF.GUARANTEEDOPTIONS.OPTION.forEach(element => {

                const timeMatch =
                    (service === 'GTD_NOON' && element.GUARANTEEDBYTIME === '1200') ||
                    (service === 'GTD_PM' && element.GUARANTEEDBYTIME === '1700');

                if (timeMatch) {
                    FINALRESPONSE.CHARGE_DETAILS.push(
                        reuse.ShipRateRes('Published Freight', element.GUARANTEEDCHARGE, 'USD', 'LIST'),
                        reuse.ShipRateRes('Discounted Freight', element.GUARANTEEDCHARGE, 'USD', 'LIST')
                    );
                }
            });
        }

        // Process itemized charges
        if (Shiprateres.ABF.ITEMIZEDCHARGES?.ITEM) {
            const items = Array.isArray(Shiprateres.ABF.ITEMIZEDCHARGES.ITEM)
                ? Shiprateres.ABF.ITEMIZEDCHARGES.ITEM
                : [Shiprateres.ABF.ITEMIZEDCHARGES.ITEM];

            items.forEach(subpack => {
                if (subpack.TYPE === 'CHARGE') {
                    FINALRESPONSE.CHARGE_DETAILS.push(
                        reuse.ShipSurRateRes(subpack.DESCRIPTION, subpack.AMOUNT, 'USD', subpack.FOR, 'ABF', chargeCodes)
                    );
                }
            });
        }
    } catch (error) {
        console.error('Rate processing error:', error.message);
        throw error;
    }
}

const isTrue = (val) =>
    String(val).toLowerCase() === 'true';

