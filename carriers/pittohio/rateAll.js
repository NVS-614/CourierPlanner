/*(Note: If pallet or unit rates are applicable for a specific pricing plan, and no pallet or unit rates
are included in the URL – the shipment will be rated using LTL rates. Please check your
company’s pricing to determine whether or not you should be utilizing shipment types.)
*/
const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');

module.exports = async function PITTOHIORateAll(request) {

    let accountNumber = request.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    const chargeCodes = request?.chargeCodeData;
    let rateShopResponse = [];

    try {
        // Your request preparation code here...
        const rateurl = request.CARRIER_DETAILS.RATEURL || process.env.PITTOHIO_RATE;
        // -----------------------------
        // 1️⃣ Ship Date Parsing
        // -----------------------------
        const [datePart] = request.HEADER_INFO.SHIP_DATE.split('T');
        const [year, month, day] = datePart.split('-');
        // Get rates first
        const [paymentterms, paymentpayer] =
            PAYMENT_MAP[request.CARRIER_DETAILS?.PAYMENT_TYPE] || ['P', 'Shipper'];
        // -----------------------------
        // 2️⃣ Helpers
        // -----------------------------
        const isTrue = (val) => String(val).toLowerCase() === 'true';
        const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES || {};
        let optlist = [];
        if (isTrue(SLSS?.LIFT_GATE_PICKUP)) { optlist += (optlist ? '|' : '') + 'LGD' }
        if (isTrue(SLSS?.LIFT_GATE_DELIVERY)) { optlist += (optlist ? '|' : '') + 'LGD' }
        if (isTrue(SLSS?.INSIDE_PICKUP)) { optlist += (optlist ? '|' : '') + 'IDL' }
        if (isTrue(SLSS?.INSIDE_DELIVERY)) { optlist += (optlist ? '|' : '') + 'IDL' }
        if (isTrue(SLSS?.LIMITED_ACCESS_PICKUP)) { optlist += (optlist ? '|' : '') + 'LAP' }
        if (isTrue(SLSS?.LIMITED_ACCESS_DELIVERY)) { optlist += (optlist ? '|' : '') + 'LAD' }
        if (isTrue(SLSS?.CONSTRUCTION_SITE_DELIVERY)) { optlist += (optlist ? '|' : '') + 'CSD' }
        if (isTrue(SLSS?.RESIDENTIAL_PICKUP)) { optlist += (optlist ? '|' : '') + 'REP' }
        if (isTrue(SLSS?.RESIDENTIAL_DELIVERY)) { optlist += (optlist ? '|' : '') + 'RES' }
        if (isTrue(SLSS?.DELIVERY_NOTIFICATION)) { optlist += (optlist ? '|' : '') + 'MNC' }
        if (isTrue(SLSS?.PROTECT_FROM_FREEZING)) { optlist += (optlist ? '|' : '') + 'PFF' }
        if (isTrue(SLSS?.OVER_LENGTH)) { optlist += (optlist ? '|' : '') + 'OVR&FrtLen=' + 10 }

        let input = '';
        input = input + `Login=${request.CARRIER_DETAILS.USERID}&`;
        input = input + `password=${request.CARRIER_DETAILS.PASSWORD}&`;
        input = input + `shipcity=${request.SHIPPER.CITY}&`;
        input = input + `shipstate=${request.SHIPPER.STATE}&`;
        input = input + `shipzip=${request.SHIPPER.ZIPCODE}&`;
        input = input + `ShipCountry=${request.SHIPPER.COUNTRY}&`;
        input = input + `acctnum=${accountNumber}&`;
        input = input + `conscity=${request.SHIPTO.CITY}&`;
        input = input + `consstate=${request.SHIPTO.STATE}&`;
        input = input + `conszip=${request.SHIPTO.ZIPCODE}&`;
        input = input + `PayTerms=${paymentterms}&`;
        //input = input + `ShipType=${ShipType}&`;
        input = input + `ShipMonth=${month}&`;
        input = input + `ShipDay=${day}&`;
        input = input + `shipyear=${year}&`;

        request.PACKAGES.forEach((piece, index) => {
            input = input + `class${index + 1}=${piece.LTL_CLASS || 50}&Wgt${index + 1}=${Math.floor(Number(piece.WEIGHT))}&`;
            input = input + `Units${index + 1}=${piece.QUANTITY || 1}&UnitType${index + 1}=${piece?.PACKING_TYPE || 'BAG'}&`;
            //  input = input + `NMFCItem${index+1}=${piece.ItemsInfo[0].NMFC}&NMFCSub${index+1}=${piece.ItemsInfo[0].NMFC}`;
        });
        if (optlist.length > 0) {
            input = input + `accessorials=${optlist}&`;
        }
        if (process.env.PRODFLAG === 'TRUE') {
            input = input + `test=N`;
        } else {
            input = input + `test=Y`;
        }

        console.log(rateurl + input);

        // ✅ USE AWAIT
        const results = await axios.get(rateurl + input, {

        });
        console.log('PITTOHIO Response received');
        const rateres = reuse.parseAndCleanXML(results.data);
        if (rateres.B2BRateCalc.NumErrors !== '0') {
            return reuse.handleErrorRes('PITTOHIO', rateres.B2BRateCalc.Errors.ErrorMessage);
        }
        if (rateres.B2BRateCalc.NumErrors === '0') {
            let ETD = reuse.addTransitDays(rateres.B2BRateCalc.AdvertisedTransit, datePart);
            let rateShop = reuse.handleRateRes(
                'PITTOHIO', accountNumber, 'STD', 'PITTOHIO Standard', rateres.B2BRateCalc.TotalCharges, rateres.B2BRateCalc.TotalCharges, ETD, rateres.B2BRateCalc.AdvertisedTransit, 'USD', request?.HEADER_INFO?.ShippingPoint, request?.HEADER_INFO?.SalesOrderDate);
            rateShop.CHARGE_DETAILS = [];
            rateShop.CHARGE_DETAILS.push(
                reuse.handlesurCharRes('PITTOHIO', 'BASE', 'Base Freight Charges', rateres.B2BRateCalc.FreightCharges, 'USD', chargeCodes),
                reuse.handlesurCharRes('PITTOHIO', 'FSC', 'Fuel SurCharges', rateres.B2BRateCalc.FSC, 'USD', chargeCodes),
                reuse.handlesurCharRes('PITTOHIO', 'OTHER', 'Total Accessorial Charges', rateres.B2BRateCalc.AccessorialCharges, 'USD', chargeCodes)
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
        console.log('PITTOHIO Rate Error:', error.response?.data || error.message);
        return reuse.handleErrorRes('PITTOHIO', error);
    }
};

const PAYMENT_MAP = Object.freeze({
    Sender: ['P', 'Shipper'],
    Recipient: ['I', 'Consignee'],
    Collect: ['I', 'Consignee'],
    ThirdParty: ['3', 'Third Party']
});
