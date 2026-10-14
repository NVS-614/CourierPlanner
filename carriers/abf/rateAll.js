const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');

module.exports = async function abfRateAll(request) {

    let accountNumber = request.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    const chargeCodes = request?.chargeCodeData;
    let rateShopResponse = [];

    try {
        // Your request preparation code here...
        const rateurl = request.CARRIER_DETAILS.RATEURL || process.env.ABF_RATE;
        // -----------------------------
        // 1️⃣ Ship Date Parsing
        // -----------------------------
        const [datePart] = request.HEADER_INFO.SHIP_DATE.split('T');
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
        params.ID = request.CARRIER_DETAILS?.ACCESS_KEY;

        // -----------------------------
        // 4️⃣ Payment Logic (Cleaned)
        // -----------------------------
        const paymentType = request.CARRIER_DETAILS.PAYMENT_TYPE?.toUpperCase();

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
            ShipName: request.SHIPPER.COMPANY,
            ShipAddr: request.SHIPPER.ADDRESS_LINE1,
            ShipCity: request.SHIPPER.CITY,
            ShipState: request.SHIPPER.STATE,
            ShipZip: request.SHIPPER.ZIPCODE?.substring(0, 5) || '',
            ShipCountry: request.SHIPPER.COUNTRY,
            ShipAcct: accountNumber || ''
        });

        // -----------------------------
        // 6️⃣ Consignee
        // -----------------------------
        Object.assign(params, {
            ConsName: request.SHIPTO.COMPANY,
            ConsAddr: request.SHIPTO.ADDRESS_LINE1,
            ConsCity: request.SHIPTO.CITY,
            ConsState: request.SHIPTO.STATE,
            ConsZip: request.SHIPTO.ZIPCODE?.substring(0, 5) || '',
            ConsCountry: request.SHIPTO.COUNTRY,
            ConsAcct: request.CARRIER_DETAILS?.BILLING_ACCOUNT || ''
        });

        // -----------------------------
        // 7️⃣ Third Party (Only if needed)
        // -----------------------------
        if (params.TPBAff === 'Y' && request.SoldTo) {
            Object.assign(params, {
                TPBName: request.SOLDTO.COMPANY,
                TPBAddr: request.SOLDTO.ADDRESS_LINE1,
                TPBCity: request.SOLDTO.CITY,
                TPBState: request.SOLDTO.STATE,
                TPBZip: request.SOLDTO.ZIPCODE?.substring(0, 5) || '',
                TPBCountry: request.SOLDTO.COUNTRY,
                TPBAcct: request.CARRIER_DETAILS?.BILLING_ACCOUNT || ''
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
        request.PACKAGES.forEach((piece, index) => {
            const i = index + 1;

            params[`Class${i}`] = piece.LTL_CLASS || 50;
            params[`Wgt${i}`] = Math.floor(Number(piece.WEIGHT));
            params[`UnitNo${i}`] = piece.QUANTITY || 1;
            params[`UnitType${i}`] = piece.PACKING_TYPE || 'BAG';

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
        const results = await axios.post(rateurl, null, {
            params,
            timeout: 15000
        });

        console.log('ABF Response received');

        const rateres = reuse.parseAndCleanXML(results.data);

        if (rateres?.ABF?.NUMERRORS > 0) {
            return reuse.handleErrorRes('ABF', rateres.ABF.ERROR.ERRORMESSAGE);
        }

        if (rateres?.ABF?.NUMERRORS == 0) {

            let transitDays = rateres.ABF?.ADVERTISEDDUEDATE?.substring(0, 1) || '';

            let rateShop = reuse.handleRateRes(
                'ABF', accountNumber, 'STD', 'ABF Standard', rateres.ABF.CHARGE, rateres.ABF.CHARGE, rateres.ABF?.ADVERTISEDDUEDATE, transitDays, 'USD',
                request?.HEADER_INFO?.ShippingPoint, request?.HEADER_INFO?.SalesOrderDate);
            rateShop.CHARGE_DETAILS = [];
            rateShop.CHARGE_DETAILS.push(
                reuse.handlesurCharRes('ABF', 'BASE', 'Base Surcharge', rateres.ABF.CHARGE,
                    'USD', chargeCodes)
            );
            rateShopResponse.push(rateShop);
            return {
                status: 'Success',
                rates: rateShopResponse
            };
        }

        return {
            status: 'Success',
            rates: []
        };

    } catch (error) {

        console.log('ABF Rate Error:', error.response?.data || error.message);

        return reuse.handleErrorRes('ABF', error);
    }
};