const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');

module.exports = async function ESTESRateAll(request) {

    let accountNumber = request.CARRIER_DETAILS.SHIPPING_ACCOUNT;
    const chargeCodes = request?.chargeCodeData;
    let rateShopResponse = [];

    try {
        let currency = 'USD';
        const { weightUnit, dimUnit } = getUnits(request.PACKAGES[0].WEIGHT_UNITS);
        const tokenurl = request.CARRIER_DETAILS?.TOKENURL || process.env.ESTES_TOKEN;
        const rateurl = request.CARRIER_DETAILS?.RATEURL || process.env.ESTES_RATE;
        const tdata = await axios.post(tokenurl, '', {
            headers: {
                accept: 'application/json',
                'APIKEY': request.CARRIER_DETAILS?.ACCESS_KEY,
                Authorization: 'Basic ' + Buffer.from(`${request.CARRIER_DETAILS.USERID}:${request.CARRIER_DETAILS.PASSWORD}`).toString('base64')
            },
        })
            .catch((ex) => {
                console.log('token Exception:', JSON.stringify(ex.response?.data));
                resolve(reuse.handleErrorRes('ESTES', ex));
            });
        if (!tdata || !tdata.data) return;

        const [datePart, timePart] = request.HEADER_INFO.SHIP_DATE.split('T');
        let payor = 'Shipper' //C,T
        let terms = 'Prepaid' //C
        if (request.CARRIER_DETAILS.PAYMENT_TYPE == 'Sender') {
            payor = 'Shipper'
            terms = 'Prepaid'
        }

        let ratereq = {};
        ratereq['quoteRequest'] = {};
        ratereq.quoteRequest['shipDate'] = datePart;
        ratereq.quoteRequest['shipTime'] = timePart;
        ratereq.quoteRequest['serviceLevels'] = ["LTL", "LTLTC"]


        ratereq['payment'] = {};
        ratereq.payment['account'] = accountNumber;
        ratereq.payment['payor'] = payor;
        ratereq.payment['terms'] = terms;

        ratereq['commodity'] = {};

        ratereq.commodity['handlingUnits'] = [];
        request.PACKAGES.forEach(element => {
            let commodity = {}
            commodity['count'] = parseInt(element.QUANTITY)
            commodity['type'] = 'SKD';
            commodity['weight'] = parseInt(element.WEIGHT);
            commodity['weightUnit'] = weightUnit;

            //-----> dimensions     
            if (element?.DIMENSION) {
                dims = element.DIMENSION.toUpperCase().split('X');
                commodity['length'] = parseInt(dims[0])
                commodity['width'] = parseInt(dims[1])
                commodity['height'] = parseInt(dims[2])
            }
            commodity['dimensionsUnit'] = dimUnit;


            commodity['lineItems'] = [];
            if (element?.ItemsInfo?.length > 0) {
                element.ItemsInfo.forEach(item => {
                    let lineItem = {}
                    lineItem['description'] = (item.DESCRIPTION)
                    lineItem['weight'] = parseInt(item.ITEM_WEIGHT)
                    lineItem['pieces'] = parseInt(item.QUANTITY)
                    lineItem['packagingType'] = 'BOX'
                    lineItem['hazardous'] = false
                    lineItem['classification'] = item.LTL_CLASS || 50;
                    commodity.lineItems.push(lineItem);
                });
            } else {
                let lineItem = {}
                lineItem['description'] = 'item.DESCRIPTION'
                lineItem['weight'] = parseInt(element.WEIGHT);
                lineItem['pieces'] = 1
                lineItem['packagingType'] = 'BOX'
                lineItem['hazardous'] = false
                lineItem['classification'] = 50;
                commodity.lineItems.push(lineItem);
            }


            ratereq.commodity.handlingUnits.push(commodity);
        });

        //-> Shipper
        ratereq['origin'] = {}
        ratereq.origin['name'] = request.SHIPPER.COMPANY;
        ratereq.origin['address'] = {}
        ratereq.origin.address['stateProvince'] = request.SHIPPER.STATE;
        ratereq.origin.address['city'] = request.SHIPPER.CITY;
        ratereq.origin.address['phone'] = request.SHIPPER.PHONE;
        ratereq.origin.address['address1'] = request.SHIPPER.ADDRESS_LINE1;
        ratereq.origin.address['address2'] = request.SHIPPER.ADDRESS_LINE2;
        ratereq.origin.address['postalCode'] = request.SHIPPER.ZIPCODE;
        ratereq.origin.address['country'] = request.SHIPPER.COUNTRY;
        ratereq.origin['contact'] = {}
        ratereq.origin.contact['name'] = request.SHIPPER.CONTACT;
        ratereq.origin.contact['email'] = request.SHIPPER.EMAIL;

        //->destination
        ratereq['destination'] = {}
        ratereq.destination['name'] = request.SHIPTO.COMPANY;
        ratereq.destination['address'] = {}
        ratereq.destination.address['stateProvince'] = request.SHIPTO.STATE;
        ratereq.destination.address['city'] = request.SHIPTO.CITY;
        ratereq.destination.address['phone'] = request.SHIPTO.PHONE;
        ratereq.destination.address['address1'] = request.SHIPTO.ADDRESS_LINE1;
        ratereq.destination.address['address2'] = request.SHIPTO.ADDRESS_LINE2;
        ratereq.destination.address['postalCode'] = request.SHIPTO.ZIPCODE;
        ratereq.destination.address['country'] = request.SHIPTO.COUNTRY;
        ratereq.destination['contact'] = {}
        ratereq.destination.contact['name'] = request.SHIPTO.CONTACT;
        ratereq.destination.contact['email'] = request.SHIPTO.EMAIL;

        ratereq['accessorials'] = {}
        ratereq.accessorials['codes'] = [];

        const SLSS = request.SHIPMENT_LVL_SPECIAL_SERVICES;
        if (reuse.isTrue(SLSS?.LIFT_GATE_PICKUP)) { ratereq.accessorials.codes.push('LGATEP') }
        if (reuse.isTrue(SLSS?.LIFT_GATE_DELIVERY)) { ratereq.accessorials.codes.push('LGATE') }
        if (reuse.isTrue(SLSS?.IN_BOND)) { ratereq.accessorials.codes.push('INB') }
        if (reuse.isTrue(SLSS?.OVER_LENGTH)) { ratereq.accessorials.codes.push('LONG12') }
        if (reuse.isTrue(SLSS?.DELIVERY_APPOINTMENT)) { ratereq.accessorials.codes.push('APT') }
        if (SLSS?.SIGNATURE_OPTION_TYPE) { ratereq.accessorials.codes.push('HDSIG') }
        if (reuse.isTrue(SLSS?.INSIDE_PICKUP)) { ratereq.accessorials.codes.push('INP') }
        if (reuse.isTrue(SLSS?.INSIDE_DELIVERY)) { ratereq.accessorials.codes.push('INS') }
        if (reuse.isTrue(SLSS?.HAZMAT)) { ratereq.accessorials.codes.push('HAZ') }
        if (reuse.isTrue(SLSS?.RESIDENTIAL_PICKUP)) { ratereq.accessorials.codes.push('HPU') }
        if (reuse.isTrue(SLSS?.RESIDENTIAL_DELIVERY)) { ratereq.accessorials.codes.push('HD') }
        if (reuse.isTrue(SLSS?.LIMITED_ACCESS_PICKUP)) { ratereq.accessorials.codes.push('LADPU') }
        if (reuse.isTrue(SLSS?.CONSTRUCTION_SITE_PICKUP)) { ratereq.accessorials.codes.push('CONSTP') }
        if (reuse.isTrue(SLSS?.CONSTRUCTION_SITE_DELIVERY)) { ratereq.accessorials.codes.push('CONST') }
        if (reuse.isTrue(SLSS?.DELIVERY_NOTIFICATION)) { ratereq.accessorials.codes.push('NCM') }
        if (reuse.isTrue(SLSS?.SINGLE_SHIPMENT)) { ratereq.accessorials.codes.push('SSM') }
        // console.log(JSON.stringify(ratereq));
        // Emit the request object

        console.log(JSON.stringify(ratereq));


        Rareres = await axios.post(rateurl, ratereq,
            {
                headers: {
                    'content-type': 'application/json',
                    'accept': 'application/json',
                    'Authorization': 'Bearer ' + tdata.data.token,
                    'apikey': request.CARRIER_DETAILS?.ACCESS_KEY
                },
            });
        console.log('ESTES Rate Response is ..:', JSON.stringify(Rareres.data));

        Rareres?.data?.data?.forEach((packelement) => {
            if (!packelement.rateFound) return;

            try {
                const chargeItems = packelement?.chargeItems || [];

                let baseCharge = 0;
                let surchargeTotal = 0;

                chargeItems.forEach(item => {
                    const amount = Number(item.charge) || 0;

                    if (item.description === 'Minimum Charge') {
                        baseCharge = amount;
                    } else if (!item.description.startsWith('Discount')) {
                        surchargeTotal += amount;
                    }
                });

                const publishedFreight = baseCharge + surchargeTotal;
                const discountFreight = Number(packelement?.quoteRate?.totalCharges) || 0;

                let rateShop = reuse.handleRateRes(
                    'ESTES',
                    accountNumber,
                    packelement.serviceLevelId,
                    `ESTES ${packelement.serviceLevelText}`,
                    discountFreight,          // final pay
                    publishedFreight,         // base + fuel + accessorials
                    packelement?.dates?.transitDeliveryDate
                        ? `${packelement.dates.transitDeliveryDate}T${packelement.dates.transitDeliveryTime}`
                        : '',
                    packelement?.transitDetails?.transitDays || '',
                    'USD', request.HEADER_INFO.ShippingPoint, request.HEADER_INFO.SalesOrderDate
                );

                // ---- CHARGE_DETAILS details
                const CHARGE_DETAILS = [];

                packelement?.quoteRate?.ratedAccessorials?.forEach(subpack => {
                    CHARGE_DETAILS.push(
                        reuse.handlesurCharRes('ESTES',
                            subpack.code,
                            subpack.description,
                            subpack.charge,
                            'USD', chargeCodes
                        )
                    );
                });
                CHARGE_DETAILS.push(reuse.handlesurCharRes('ESTES', 'BASE', 'Base Charge', baseCharge, 'USD', chargeCodes)

                );
                rateShop.CHARGE_DETAILS = CHARGE_DETAILS;
                rateShopResponse.push(rateShop);

            } catch (ex) {
                console.error('ESTES rate parse error:', ex);
            }
        });

        return { status: 'Success', rates: rateShopResponse };

    } catch (error) {

        console.log('ESTES Rate Error:', error.message);

        return reuse.handleErrorRes('ESTES', error);
    }
};

const getUnits = (w) => ({
    weightUnit: w?.toUpperCase().startsWith('K') ? 'Kilograms' : 'Pounds',
    dimUnit: w?.toUpperCase().startsWith('K') ? 'CM' : 'Inches'
});