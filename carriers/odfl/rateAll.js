const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');

module.exports = async function ODFLRateAll(request) {

    let accountNumber = request.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    const SLSS = request.SHIPMENT_LVL_SPECIAL_SERVICES;
    const chargeCodes = request?.chargeCodeData;
    let rateShopResponse = [];

    try {
        // Your request preparation code here...
        const rateurl = request.CARRIER_DETAILS.RATEURL || process.env.ODFL_RATE;
        let USERID = request.CARRIER_DETAILS.USERID;
        let PASSWORD = request.CARRIER_DETAILS.PASSWORD;
        const [datePart, timePart] = request.HEADER_INFO.SHIP_DATE.split('T');
        let xmlRequest = ''
        xmlRequest += '<?xml version="1.0" encoding="UTF-8"?>';
        xmlRequest += '<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ';
        xmlRequest += 'xmlns:myr="http://myRate.ws.odfl.com/">';
        xmlRequest += '<soapenv:Header />';
        xmlRequest += '<soapenv:Body>';
        xmlRequest += '<myr:getLTLRateEstimate>';
        xmlRequest += '<arg0>';

        // ✅ Liftgate Pickup
        if (isTrue(SLSS?.LIFT_GATE_PICKUP)) { xmlRequest += '<accessorials>HYO</accessorials>'; }
        // ✅ Liftgate Delivery
        if (isTrue(SLSS?.LIFT_GATE_DELIVERY)) { xmlRequest += '<accessorials>HYD</accessorials>'; }
        // ✅ Overlength
        if (isTrue(SLSS?.OVER_LENGTH)) { xmlRequest += '<accessorials>OVL</accessorials>'; }
        // ✅ Delivery Appointment (Scheduled Appointment Delivery)
        if (isTrue(SLSS?.DELIVERY_APPOINTMENT)) { xmlRequest += '<accessorials>CA</accessorials>'; }
        // ✅ Inside Pickup
        if (isTrue(SLSS?.INSIDE_PICKUP)) { xmlRequest += '<accessorials>IPC</accessorials>'; }
        // ✅ Inside Delivery
        if (isTrue(SLSS?.INSIDE_DELIVERY)) { xmlRequest += '<accessorials>IDC</accessorials>'; }
        // ✅ Hazmat
        if (isTrue(SLSS?.HAZMAT)) { xmlRequest += '<accessorials>HAZ</accessorials>'; }
        // ✅ Residential Pickup
        if (isTrue(SLSS?.RESIDENTIAL_PICKUP)) { xmlRequest += '<accessorials>RPC</accessorials>'; }
        // ✅ Residential Delivery
        if (isTrue(SLSS?.RESIDENTIAL_DELIVERY)) { xmlRequest += '<accessorials>RDC</accessorials>'; }
        // ✅ Limited Access Pickup
        if (isTrue(SLSS?.LIMITED_ACCESS_PICKUP)) { xmlRequest += '<accessorials>LPC</accessorials>'; }
        // ✅ Construction Site Pickup
        if (isTrue(SLSS?.CONSTRUCTION_SITE_PICKUP)) { xmlRequest += '<accessorials>CSP</accessorials>'; }
        // ✅ Construction Site Delivery
        if (isTrue(SLSS?.CONSTRUCTION_SITE_DELIVERY)) { xmlRequest += '<accessorials>CSD</accessorials>'; }
        // ✅ Delivery Notification (Prior to Delivery Notification)
        if (isTrue(SLSS?.DELIVERY_NOTIFICATION)) { xmlRequest += '<accessorials>ARN</accessorials>'; }
        // ✅ Single Shipment Charge
        if (isTrue(SLSS?.SINGLE_SHIPMENT)) { xmlRequest += '<accessorials>SCR</accessorials>'; }
        // Airport Delivery
        if (isTrue(SLSS?.AIRPORT_DELIVERY)) { xmlRequest += '<accessorials>AID</accessorials>'; }
        // Airport Pickup
        if (isTrue(SLSS?.AIRPORT_PICKUP)) { xmlRequest += '<accessorials>AIP</accessorials>'; }
        // School/College/Church Delivery
        if (isTrue(SLSS?.SchoolDelivery)) { xmlRequest += '<accessorials>CDC</accessorials>'; }
        // School/College/Church Pickup
        if (isTrue(SLSS?.SchoolPickup)) { xmlRequest += '<accessorials>CPC</accessorials>'; }
        // Mine/Oil Field Delivery
        if (isTrue(SLSS?.MineDelivery)) { xmlRequest += '<accessorials>DSM</accessorials>'; }
        // Mine/Oil Field Pickup
        if (isTrue(SLSS?.MinePickup)) { xmlRequest += '<accessorials>PSM</accessorials>'; }
        // Solar/Wind Delivery
        if (isTrue(SLSS?.SolarDelivery)) { xmlRequest += '<accessorials>DSW</accessorials>'; }
        // Solar/Wind Pickup
        if (isTrue(SLSS?.SolarPickup)) { xmlRequest += '<accessorials>PSW</accessorials>'; }
        // Trade Show Delivery
        if (isTrue(SLSS?.TRADE_SHOW_DELIVERY)) { xmlRequest += '<accessorials>EXD</accessorials>'; }
        // Trade Show Pickup
        if (isTrue(SLSS?.TRADE_SHOW_PICKUP)) { xmlRequest += '<accessorials>EXO</accessorials>'; }
        if (isTrue(SLSS?.GUARANTEED_DELIVERY)) { xmlRequest += '<accessorials>GTD</accessorials>'; }
        if (isTrue(SLSS?.HH_SameDayDest)) xmlRequest += '<accessorials>HDP</accessorials>';
        if (isTrue(SLSS?.HH_GTD_2Hr_Origin)) xmlRequest += '<accessorials>HGO</accessorials>';
        if (isTrue(SLSS?.HH_LiveLoad)) xmlRequest += '<accessorials>HHL</accessorials>';
        if (isTrue(SLSS?.HH_HandTruck)) xmlRequest += '<accessorials>HHT</accessorials>';
        if (isTrue(SLSS?.HH_LiveUnload)) xmlRequest += '<accessorials>HHU</accessorials>';
        if (isTrue(SLSS?.HH_5Straps)) xmlRequest += '<accessorials>HH5</accessorials>';
        if (isTrue(SLSS?.HH_10Straps)) xmlRequest += '<accessorials>H10</accessorials>';
        if (isTrue(SLSS?.HH_15Straps)) xmlRequest += '<accessorials>H15</accessorials>';
        if (isTrue(SLSS?.HH_20Straps)) xmlRequest += '<accessorials>H20</accessorials>';
        if (isTrue(SLSS?.HH_25Straps)) xmlRequest += '<accessorials>H25</accessorials>';
        if (isTrue(SLSS?.HH_ScaleOrigin)) xmlRequest += '<accessorials>HSO</accessorials>';
        if (isTrue(SLSS?.HH_SameDayOrigin)) xmlRequest += '<accessorials>HSP</accessorials>';
        if (isTrue(SLSS?.LIMITED_ACCESS_DELIVERY)) { xmlRequest += '<accessorials>LDC</accessorials>'; }
        if (isTrue(SLSS?.LIMITED_ACCESS_DELIVERY)) { xmlRequest += '<accessorials>LDC</accessorials>'; }
        if (isTrue(SLSS?.LumperOrigin)) { xmlRequest += '<accessorials>LUO</accessorials>'; }
        if (isTrue(SLSS?.LumperDestination)) { xmlRequest += '<accessorials>LUD</accessorials>'; }
        if (isTrue(SLSS?.PROTECT_FROM_FREEZING)) { xmlRequest += '<accessorials>PFF</accessorials>'; }
        if (isTrue(SLSS?.SORT_AND_SEGREGATE)) { xmlRequest += '<accessorials>STR</accessorials>'; }
        if (isTrue(SLSS?.SelfStorageDelivery)) { xmlRequest += '<accessorials>SWD</accessorials>'; }
        if (isTrue(SLSS?.SORT_AND_SEGREGATE)) { xmlRequest += '<accessorials>SSC</accessorials>'; }
        if (isTrue(SLSS?.SecurityDivider)) { xmlRequest += '<accessorials>SDS</accessorials>'; }
        if (SLSS?.InsuranceAmount && Number(SLSS.InsuranceAmount) > 0) {
            xmlRequest += '<accessorials>IND</accessorials>';
            xmlRequest += `<insuranceAmount>${SLSS.InsuranceAmount}</insuranceAmount>`;
        }
        xmlRequest += `<destinationCountry>${getCounty3(request.SHIPTO.COUNTRY)}</destinationCountry>`;
        xmlRequest += `<destinationPostalCode>${request.SHIPTO.ZIPCODE}</destinationPostalCode>`;
        xmlRequest += `<email>${request.SHIPTO.EMAIL}</email>`;
        xmlRequest += '<freightItems>';
        try {
            request.PACKAGES.forEach((element) => {
                xmlRequest += `<actualClass>${element.LTL_CLASS || 50}</actualClass>`;
                xmlRequest += `<ratedClass>${element.LTL_CLASS || 50}</ratedClass>`;
                if (element?.DIMENSION) {
                    const dims = element.DIMENSION.toUpperCase().split('X');
                    xmlRequest += `<width>${Number(dims[1])}</width>`;
                    xmlRequest += `<height>${Number(dims[2])}</height>`;
                    xmlRequest += `<length>${Number(dims[0])}</length>`;
                    xmlRequest += `<dimensionUnits>${element.DIMENSION_UNITS || 'IN'}</dimensionUnits>`;

                }
                xmlRequest += `<weight>${Number(element.WEIGHT)}</weight>`;
            });
        } catch (ex2) {
            console.error('Error processing freight items:', ex2);
        }

        xmlRequest += '</freightItems>';

        xmlRequest += `<numberOfUnits>${request.PACKAGES.length}</numberOfUnits>`;
        xmlRequest += '<movement>O</movement>';
        xmlRequest += `<odfl4MePassword>${PASSWORD}</odfl4MePassword>`;
        xmlRequest += `<odfl4MeUser>${USERID}</odfl4MeUser>`;
        xmlRequest += `<odflCustomerAccount>${request.CARRIER_DETAILS.SHIPPING_ACCOUNT}</odflCustomerAccount>`;
        xmlRequest += `<originCountry>${getCounty3(request.SHIPPER.COUNTRY)}</originCountry>`;
        xmlRequest += `<originPostalCode>${request.SHIPPER.ZIPCODE}</originPostalCode>`;
        xmlRequest += `<email>${request.SHIPPER.EMAIL}</email>`;
        xmlRequest += `<pickupDateTime>${datePart}</pickupDateTime>`;
        xmlRequest += `<deliveryDateTime>${timePart}</deliveryDateTime>`;
        //xmlRequest += `<shipType>LTL</shipType>`;
        // xmlRequest += '<tariff></tariff>';
        xmlRequest += `<weightUnits>${getRateWeightUnit(request.PACKAGES[0].WEIGHT_UNITS)}</weightUnits>`;
        xmlRequest += `</arg0>`;
        xmlRequest += `</myr:getLTLRateEstimate>`;
        xmlRequest += `</soapenv:Body>`;
        xmlRequest += '</soapenv:Envelope>';

        console.log(xmlRequest)



        // ✅ USE AWAIT
        const results = await axios.post(rateurl, xmlRequest, {
            headers: {
                'Content-Type': 'text/xml;charset=UTF-8',
            }
        });

        console.log('ODFL Response is ..:');
        const rateres = reuse.parseAndCleanXML(results.data);
        try {
            if (rateres.Envelope.Body.getLTLRateEstimateResponse.return.success == 'false') {
                return reuse.handleErrorRes('ODFL', rateres.Envelope.Body.getLTLRateEstimateResponse.return.errorMessages);
            }
            else if (rateres.Envelope.Body.getLTLRateEstimateResponse.return.success == 'true') {
                const response = rateres.Envelope.Body.getLTLRateEstimateResponse.return;
                const rates = response.rateEstimate;
                const transitdays = response?.destinationCities?.serviceDays || 1;
                const ETA = reuse.addTransitDays(transitdays, datePart);
                //const publishedFreight = Number(rates.grossFreightCharge || 0);
                const finalStandard = Number(rates.netFreightCharge || 0);
                const guaranteedPM = Number(rates.guaranteedServiceOption || 0);
                const guaranteedNoon = Number(rates.guaranteedByNoonServiceOption || 0);
                // --------------------------------------------------
                // 1️⃣ Build CHARGE_DETAILS (Reusable for all services)
                // --------------------------------------------------
                let CHARGE_DETAILS = [];
                try {
                    if (rates.accessorialCharges) {
                        const accessorials = Array.isArray(rates.accessorialCharges)
                            ? rates.accessorialCharges
                            : [rates.accessorialCharges];
                        accessorials.forEach(acc => {
                            CHARGE_DETAILS.push(reuse.handlesurCharRes('ODFL', acc.description, acc.description, Number(acc.amount || 0), 'USD', chargeCodes));
                        });
                    }
                    // Add Fuel as surcharge (recommended)
                    if (rates.fuelSurcharge) {
                        CHARGE_DETAILS.push(reuse.handlesurCharRes('ODFL', 'Fuel Surcharge', 'Fuel Surcharge', Number(rates.fuelSurcharge), 'USD', chargeCodes));
                    }
                } catch (err) {
                    console.log('Surcharge error', err.message);
                }

                // --------------------------------------------------
                // 2️⃣ STANDARD SERVICE
                // --------------------------------------------------
                let stdRate = reuse.handleRateRes(
                    'ODFL', accountNumber, 'STD', 'ODFL Standard', finalStandard, finalStandard, ETA, transitdays, 'USD', request.HEADER_INFO?.ShippingPoint, request.HEADER_INFO?.SalesOrderDate);
                stdRate.CHARGE_DETAILS = CHARGE_DETAILS;
                rateShopResponse.push(stdRate);
                // --------------------------------------------------
                // 3️⃣ GUARANTEED (PM)
                // --------------------------------------------------
                if (guaranteedPM > 0) {
                    let finalGTD = finalStandard + guaranteedPM;
                    let gtdRate = reuse.handleRateRes('ODFL', accountNumber, 'GTD_PM', 'ODFL Time Critical by 5PM', finalGTD, finalGTD, ETA, transitdays, 'USD', request.HEADER_INFO?.ShippingPoint, request.HEADER_INFO?.SalesOrderDate);
                    // clone surcharge array to avoid reference mutation
                    gtdRate.CHARGE_DETAILS = [...CHARGE_DETAILS];
                    // Add guaranteed charge as separate surcharge
                    gtdRate.CHARGE_DETAILS.push(reuse.handlesurCharRes('ODFL', 'Guaranteed Service', 'Guaranteed Service', guaranteedPM, 'USD', chargeCodes
                    ));
                    rateShopResponse.push(gtdRate);
                }


                // --------------------------------------------------
                // 4️⃣ GUARANTEED BY NOON
                // --------------------------------------------------
                if (guaranteedNoon > 0) {

                    let finalNoon = finalStandard + guaranteedNoon;

                    let noonRate = reuse.handleRateRes(
                        'ODFL',
                        accountNumber,
                        'GTD_NOON',
                        'ODFL Time Critical by Noon',
                        finalNoon,
                        finalNoon,
                        ETA,
                        transitdays,
                        'USD',
                        request.HEADER_INFO?.ShippingPoint,
                        request.HEADER_INFO?.SalesOrderDate
                    );

                    noonRate.CHARGE_DETAILS = [...CHARGE_DETAILS];

                    noonRate.CHARGE_DETAILS.push(
                        reuse.handlesurCharRes(
                            'ODFL',
                            'Guaranteed By Noon',
                            'Guaranteed By Noon',
                            guaranteedNoon,
                            'USD',
                            chargeCodes
                        )
                    );

                    rateShopResponse.push(noonRate);
                }

                return { status: 'Success', rates: rateShopResponse };
            }
        } catch (ex6) {
            return reuse.handleErrorRes('ODFL', ex6);
        }

        return {
            status: 'Success',
            rates: []
        };

    } catch (error) {

        console.log('ODFL Rate Error:', error?.response?.data || error.message);

        return reuse.handleErrorRes('ODFL', error);
    }
};


// Helper function
const isTrue = (val) => String(val).toLowerCase() === 'true';

const getRateWeightUnit = (unit = '') =>
    /^l/i.test(unit) ? 'LBS' :
        /^k/i.test(unit) ? 'KG' :
            'LBS';

function getCounty3(country2) {
    switch (country2) {
        case 'US':
            return 'USA'
            break;
        case 'CA':
            return 'CAN'
            break;
        default:
            return country2
    }
}