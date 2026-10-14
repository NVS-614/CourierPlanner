const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');

module.exports = async function dhlRateAll(request) {
  const chargeCodes = request?.chargeCodeData;
  const carrierDetails = request.CARRIER_DETAILS;
  const accountNumber = carrierDetails?.SHIPPING_ACCOUNT;
  const rateurl =
    carrierDetails?.RATEURL || process.env.DHL_RATE;

  let rateShopResponse = [];

  try {
    /* =============================
       BUILD RATE REQUEST
    ============================== */

    const rateRequest = {
      customerDetails: {
        shipperDetails: buildAddress(request.SHIPPER),
        receiverDetails: buildAddress(request.SHIPTO)
      },
      accounts: buildAccounts(carrierDetails),
      valueAddedServices: buildValueAddedServices(
        request?.SHIPMENT_LVL_SPECIAL_SERVICES
      ),
      plannedShippingDateAndTime: new Date(
        request?.HEADER_INFO?.SHIP_DATE || Date.now()
      ),
      unitOfMeasurement: 'metric',
      estimatedDeliveryDate: { isRequested: true },
      packages: buildPackages(request.PACKAGES),
      productTypeCode: 'all'
    };

    /* =============================
       CUSTOMS (INTERNATIONAL)
    ============================== */

    if (request.SHIPPER.COUNTRY !== request.SHIPTO.COUNTRY) {
      const totalCustomValue =
        request?.INTERNATIONAL_DETAILS?.ITEM_INFO?.reduce(
          (sum, item) =>
            sum + Number(item.QUANTITY) * Number(item.UNIT_COST),
          0
        ) || 0;

      rateRequest.isCustomsDeclarable = true;
      rateRequest.monetaryAmount = [
        {
          typeCode: 'declaredValue',
          value: totalCustomValue,
          // BUGFIX: was hardcoded 'USD' — now read from request like the rest of the codebase
          currency: request?.INTERNATIONAL_DETAILS?.CUSTOMS_VALUE_CURRENCY
            || request?.HEADER_INFO?.CURRENCY
            || 'USD'
        }
      ];
    } else {
      rateRequest.isCustomsDeclarable = false;
    }

    console.log('DHL Rate Request:', JSON.stringify(rateRequest));

    /* =============================
       API CALL
    ============================== */

    const response = await axios.post(rateurl, rateRequest, {
      headers: {
        'content-type': 'application/json',
        authorization:
          'Basic ' +
          Buffer.from(
            `${carrierDetails.USERID}:${carrierDetails.PASSWORD}`
          ).toString('base64')
      }
    });

    console.log('DHL Rate Response:', JSON.stringify(response.data));

    /* =============================
       HANDLE RESPONSE
    ============================== */

    response?.data?.products?.forEach(product => {
      const billcTotal = product?.totalPrice?.find(
        p => p.currencyType === 'BILLC'
      );

      const rateShop = reuse.handleRateRes(
        'DHL',
        accountNumber,
        product.productCode,
        product.productName,
        billcTotal?.price,
        product?.totalPrice?.[0]?.price,
        product?.deliveryCapabilities?.estimatedDeliveryDateAndTime || '',
        product?.deliveryCapabilities?.totalTransitDays,
        billcTotal?.priceCurrency || '',
        request?.HEADER_INFO?.ShippingPoint,
        request?.HEADER_INFO?.SalesOrderDate
      );

      /* -------- CHARGE_DETAILS -------- */

      const CHARGE_DETAILS = [];

      product?.detailedPriceBreakdown
        ?.filter(dp => dp.currencyType === 'BILLC')
        ?.forEach(dp => {
          dp?.breakdown?.forEach(item => {
            CHARGE_DETAILS.push(
              reuse.handlesurCharRes(
                'DHL',
                item?.serviceTypeCode || 'BASE',
                item?.name || '',
                item?.price || 0,
                dp?.priceCurrency || rateShop.currency,
                chargeCodes
              )
            );
          });
        });

      rateShop.CHARGE_DETAILS = CHARGE_DETAILS;
      rateShopResponse.push(rateShop);
    });

    return { status: 'Success', rates: rateShopResponse };

  } catch (ex) {
    console.error('DHL Rate Error:', ex?.response?.data || ex?.message);

    let errorMessage =
      ex?.response?.data?.detail || ex?.message || 'Unknown Error';

    if (Array.isArray(ex?.response?.data?.additionalDetails)) {
      // Guard: items may be strings or { msg } objects — coerce safely
      const details = ex.response.data.additionalDetails
        .map(d => (typeof d === 'string' ? d : (d?.msg || JSON.stringify(d))));
      errorMessage += '; ' + details.join('; ');
    }

    return reuse.handleErrorRes('DHL', errorMessage);
  }
};

/* ===========================================
   HELPER FUNCTIONS
=========================================== */

function buildAddress(addr = {}) {
  const address = {
    cityName: addr.CITY,
    provinceCode: addr.STATE,
    countryCode: addr.COUNTRY,
    postalCode: addr.ZIPCODE,
    addressLine1: addr.ADDRESS_LINE1
  };

  if (addr.ADDRESS_LINE2) address.addressLine2 = addr.ADDRESS_LINE2;
  if (addr.ADDRESS_LINE3) address.addressLine3 = addr.ADDRESS_LINE3;

  return address;
}

function buildAccounts(carrierDetails = {}) {
  const accounts = [
    { typeCode: 'shipper', number: carrierDetails.SHIPPING_ACCOUNT }
  ];

  if (
    carrierDetails?.PAYMENT_TYPE?.toUpperCase() !== 'SENDER' &&
    carrierDetails?.BILLING_ACCOUNT
  ) {
    accounts.push({
      typeCode: 'payer',
      number: carrierDetails.BILLING_ACCOUNT
    });
  }

  if (carrierDetails?.DUTIES_ACCOUNT) {
    accounts.push({
      typeCode: 'duties-taxes',
      number: carrierDetails.DUTIES_ACCOUNT
    });
  }

  return accounts;
}

function buildValueAddedServices(SLSS = {}) {
  const services = [];

  // Accept the standard field name used in DHL ship.js (ELECTRONIC_TRADE_DOCUMENT)
  // as well as the legacy PaperLessInvoice flag. Match boolean-ish values robustly.
  const isOn = (v) =>
    v === true ||
    (typeof v === 'string' && ['true', 'x', 'yes', '1'].includes(v.toLowerCase().trim()));

  if (isOn(SLSS?.ELECTRONIC_TRADE_DOCUMENT) || isOn(SLSS?.PaperLessInvoice)) {
    services.push({ serviceCode: 'WY' });
  }

  if (isOn(SLSS?.PltUpload) || isOn(SLSS?.PLT_UPLOAD)) {
    services.push({ serviceCode: 'PM' });
  }

  if (isOn(SLSS?.GO_GREEN_PLUS)) {
    services.push({ serviceCode: 'FT' });
  }

  if (isOn(SLSS?.NEUTRAL_DELIVERY)) {
    services.push({ serviceCode: 'NN' });
  }

  return services;
}

function buildPackages(packages = []) {
  return packages.map(pkg => {
    const item = {
      weight: Number(pkg.WEIGHT)
    };

    // Guard against numeric / non-string DIMENSION values and the "0x0x0" placeholder
    if (typeof pkg?.DIMENSION === 'string' && pkg.DIMENSION.trim() && !pkg.DIMENSION.startsWith('0')) {
      const dims = pkg.DIMENSION.toUpperCase().split('X');
      if (dims.length === 3) {
        item.dimensions = {
          length: Number(dims[0]),
          width: Number(dims[1]),
          height: Number(dims[2])
        };
      }
    }

    return item;
  });
}