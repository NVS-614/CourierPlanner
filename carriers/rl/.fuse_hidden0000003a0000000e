// carriers/randl/ship.js

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


module.exports = async (request,chargeCodes) => {

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
    const shipurl = CARRIER_DETAILS.SHIPURL || process.env.RL_SHIP;
    const bolurl = CARRIER_DETAILS.BOLURL || CARRIER_DETAILS.BolURL || process.env.RL_BOL;
    const rateurl = CARRIER_DETAILS.RATEURL || process.env.RL_RATE;


    const service = CARRIER_DETAILS?.SERVICE_CODE || CARRIER_DETAILS?.SERVICE_NAME;

    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES;
    try {
        // Get rates first
        const strRateQuote = await GetRandLrates(request, rateurl, FINALRESPONSE, service,chargeCodes);
        console.log('Rate Quote:', strRateQuote);

        // Prepare shipment request
        const [datePart] = HEADER_INFO.SHIP_DATE.split('T');
        const payment = CARRIER_DETAILS.PAYMENT_TYPE.toUpperCase() === 'SENDER' ? 'Prepaid' : '';

        const shipReq = {
            BillOfLading: {
                DeclaredValue: { Amount: 1 },
                BOLDate: moment(datePart, 'YYYY-MM-DD').format('MM/DD/yyyy'),
                Shipper: buildAddress(SHIPPER),
                Consignee: buildAddress(SHIPTO),
                Items: PACKAGES.map(buildPackageItem) || [],
                AdditionalServices: [],
                SpecialInstructions: CARRIER_DETAILS.NOTE,
                ReferenceNumbers: {
                    ShipperNumber: CARRIER_DETAILS.SHIPPING_ACCOUNT,
                    RateQuoteNumber: strRateQuote || "",
                    PONumber: CARRIER_DETAILS.REFERENCE2
                },
                FreightChargePaymentMethod: payment,
                ServiceLevel: Getcode.getRLServiceName(service),
                GenerateUniversalPro: false
            }
        };

        if (SLSS?.INSIDE_PICKUP === 'true') { shipReq.BillOfLading.AdditionalServices.push('InsidePickup') }
        if (SLSS?.INSIDE_DELIVERY) { shipReq.BillOfLading.AdditionalServices.push('InsideDelivery') }
        if (SLSS?.RESIDENTIAL_PICKUP) { shipReq.BillOfLading.AdditionalServices.push('ResidentialPickup') }
        if (SLSS?.RESIDENTIAL_DELIVERY) { shipReq.BillOfLading.AdditionalServices.push('ResidentialDelivery') }
        if (SLSS?.LIMITED_ACCESS_PICKUP) { shipReq.BillOfLading.AdditionalServices.push('LimitedAccessPickup') }
        if (SLSS?.LIMITED_ACCESS_DELIVERY) { shipReq.BillOfLading.AdditionalServices.push('LimitedAccessDelivery') }
        if (SLSS?.LIFT_GATE_PICKUP === 'true') { shipReq.BillOfLading.AdditionalServices.push('OriginLiftgate') }
        if (SLSS?.LIFT_GATE_DELIVERY === 'true') { shipReq.BillOfLading.AdditionalServices.push('DestinationLiftgate') }
        if (SLSS?.DELIVERY_APPOINTMENT === 'true') { shipReq.BillOfLading.AdditionalServices.push('DeliveryAppointment') }
        if (SLSS?.SORT_AND_SEGREGATE === 'true') { shipReq.BillOfLading.AdditionalServices.push('SortandSegregate') }
        if (SLSS?.HAZMAT === 'true') { shipReq.BillOfLading.AdditionalServices.push('Hazmat') }
        if (SLSS?.PROTECT_FROM_FREEZING === 'true') { shipReq.BillOfLading.AdditionalServices.push('Freezable') }
        if (SLSS?.OVER_LENGTH === 'true') {
            shipReq.BillOfLading.AdditionalServices.push('OverDimension')
            shipReq.BillOfLading['OverDimensions'] = [{
                Pieces: 1, Inches: 90
            }];

        }


        // Handle special service cases
        if (CARRIER_DETAILS?.SERVICE_CODE === 'GSHW') {
            shipReq.BillOfLading.HourlyWindow = {
                Start: HEADER_INFO.READY_TIME,
                End: HEADER_INFO.CLOSE_TIME,
            };
        }

        if (CARRIER_DETAILS.PickupRequest === 'TRUE') {
            shipReq.BillOfLading.PickupRequest = {
                PickupInformation: {
                    PickupDate: moment(datePart, 'YYYY-MM-DD').format('MM/dd/yyyy'),
                    ReadyTime: HEADER_INFO.READY_TIME,
                    CloseTime: HEADER_INFO.CLOSE_TIME,
                    AdditionalInstructions: CARRIER_DETAILS.NOTE
                },
                Contact: {
                    Name: SHIPPER.CONTACT,
                    CompanyName: SHIPPER.COMPANY,
                    PhoneNumber: SHIPPER.PHONE,
                    EmailAddress: SHIPPER.EMAIL
                },
                SendEmailConfirmation: true
            };
        }

        console.log('RL Ship Request:', JSON.stringify(shipReq, null, 2));

        // Create shipment
        const sres = await axiosInstance.post(shipurl, shipReq, {
            headers: {
                'Content-Type': 'application/json',
                'apiKey': CARRIER_DETAILS?.ACCESS_KEY
            }
        });

        console.log('RL Ship Response:', sres.data);

        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Shipped';
        // Update tracking numbers
        PACKAGES.forEach(pkg => {
            pkg.TrackingNumber = sres.data.ProNumber;
            FINALRESPONSE.PACKAGES.push({ TRACKING_NUMBER: sres.data.ProNumber });
        });
        FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER = FINALRESPONSE.PACKAGES[0]?.TRACKING_NUMBER;
        // Get BOL document
        try {
            const bolRes = await axiosInstance.get(bolurl + `${sres.data.ProNumber}`,
                {
                    headers: {
                        'Accept': 'application/json',
                        'apiKey': CARRIER_DETAILS?.ACCESS_KEY
                    }
                }
            );
            const docName = `${FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER}_BOL.PDF`;
            FINALRESPONSE.SHIPPING_DOCUMENTS.push(
                reuse.formatShipDoc('RL', 'Bill Of Lading', 1, docName, bolRes.data.BolDocument, 'PDF')
            );
        } catch (bolError) {
            console.error('BOL fetch failed:', bolError.message);
        }

        let docp = [];
        // Generate other documents
        if (CARRIER_DETAILS?.LABELTYPE === 'ZPL') {
            docp.push(documentprocess.preparelabel_ZPL(request));
        } else if (CARRIER_DETAILS?.LABELTYPE === 'PNG') {
            docp.push(documentprocess.prepareLabel_png_sharp(request));
        } else {
            docp.push(labeldocprocess.preparelabel_pdfkit(request));
        }
        docp.push(documentprocess.preparePackingSlip_pdfkit(request));

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
        console.error("randl Ship Error:", ex?.response?.data || ex.message);
        FINALRESPONSE.STATUS = 'Error';
        let errordesc = reuse.handleShipErrorRes(ex);
        FINALRESPONSE.ERRORS = errordesc;
        return FINALRESPONSE;
    }
};
// Helper functions
const buildAddress = (data) => ({
    CompanyName: data.COMPANY,
    AddressLine1: data.ADDRESS_LINE1,
    AddressLine2: data.ADDRESS_LINE2,
    PhoneNumber: data.PHONE,
    EmailAddress: data.EMAIL,
    City: data.CITY,
    StateOrProvince: data.STATE,
    ZipOrPostalCode: data.ZIPCODE,
    CountryCode: reuse.getCountry3(data.COUNTRY)
});

const buildPackageItem = (pkg) => ({
    Pieces: pkg?.QUANTITY || 1,
    PackageType: pkg?.PACKING_TYPE || 'BAG',
    Class: pkg?.LTL_CLASS || '50',
    Description: pkg?.DESCRIPTION || 'itemdetails',
    IsHazmat: false,
    Weight: Math.floor(Number(pkg.WEIGHT)),
    ...((pkg?.DIMENSION) && {
        Length: pkg.DIMENSION.toUpperCase().split('X')[0],
        Width: pkg.DIMENSION.toUpperCase().split('X')[1],
        Height: pkg.DIMENSION.toUpperCase().split('X')[2],
    })
});

// if (pkg?.DIMENSION) {
//   const dims = pkg.DIMENSION.toUpperCase().split('X');
//   [item.Length, item.Width, item.Height] = dims.map(Number);
// }

// Rate quote function
async function GetRandLrates(request, url, FINALRESPONSE, service,chargeCodes) {

    try {
        const rateReq = {
            RateQuote: {
                CODAmount: 0,
                DeclaredValue: 0,
                Origin: {
                    City: request.SHIPPER.CITY,
                    StateOrProvince: request.SHIPPER.STATE,
                    ZipOrPostalCode: request.SHIPPER.ZIPCODE,
                    CountryCode: reuse.getCountry3(request.SHIPPER.COUNTRY)
                },
                Destination: {
                    City: request.SHIPTO.CITY,
                    StateOrProvince: request.SHIPTO.STATE,
                    ZipOrPostalCode: request.SHIPTO.ZIPCODE,
                    CountryCode: reuse.getCountry3(request.SHIPTO.COUNTRY)
                },
                Items: request.PACKAGES.map(buildPackageItem),
                AdditionalServices: []
            }
        };

        // Add additional services
        const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES;
        const services = [
            { condition: SLSS?.INSIDE_PICKUP === 'true', name: 'InsidePickup' },
            { condition: SLSS?.INSIDE_DELIVERY, name: 'InsideDelivery' },
            { condition: SLSS?.RESIDENTIAL_PICKUP, name: 'ResidentialPickup' },
            { condition: SLSS?.RESIDENTIAL_DELIVERY, name: 'ResidentialDelivery' },
            { condition: SLSS?.LIMITED_ACCESS_PICKUP, name: 'LimitedAccessPickup' },
            { condition: SLSS?.LIMITED_ACCESS_DELIVERY, name: 'LimitedAccessDelivery' },
            { condition: SLSS?.LIFT_GATE_PICKUP === 'true', name: 'OriginLiftgate' },
            { condition: SLSS?.LIFT_GATE_DELIVERY === 'true', name: 'DestinationLiftgate' },
            { condition: SLSS?.DELIVERY_APPOINTMENT === 'true', name: 'DeliveryAppointment' },
            { condition: SLSS?.SORT_AND_SEGREGATE === 'true', name: 'SortandSegregate' },
            { condition: SLSS?.HAZMAT === 'true', name: 'Hazmat' },
            { condition: SLSS?.PROTECT_FROM_FREEZING === 'true', name: 'Freezable' }
        ];

        services.forEach(({ condition, name }) => {
            if (condition) rateReq.RateQuote.AdditionalServices.push(name);
        });

        if (SLSS?.OVER_LENGTH === 'true') {
            rateReq.RateQuote.AdditionalServices.push('OverDimension');
            rateReq.RateQuote.OverDimensions = [{ Pieces: 1, Inches: 90 }];
        }

        console.log('RL Rate Request:', JSON.stringify(rateReq, null, 2));

        const rateRes = await axiosInstance.post(url, rateReq, {
            headers: {
                'Content-Type': 'application/json',
                'apiKey': request.CARRIER_DETAILS?.ACCESS_KEY
            }
        });

        let strRateQuote = '';
        let stdcharge = 0;

        // Find standard charge first
        const stdService = rateRes.data.RateQuote.ServiceLevels.find(s => s.Code === 'STD');
        if (stdService) {
            stdcharge = parseFloat(stdService.Charge.replace(/[$,]/g, ''));
        }

        // Find matching service
        const matchedService = rateRes.data.RateQuote.ServiceLevels.find(
            s => s.Code === service
        );

        if (!matchedService) {
            throw new Error('Rate Quote not found for the specified service.');
        }

        strRateQuote = matchedService.QuoteNumber;

        // Add charges to request body
        const serviceCharge = parseFloat(matchedService.Charge.replace(/[$,]/g, ''));
        const totalCharge = matchedService.Code === 'STD' ? serviceCharge : serviceCharge + stdcharge;
        FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipRateRes('Discounted Freight', totalCharge, 'USD', 'DISC'));
        FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipRateRes('Published Freight', totalCharge, 'USD', 'LIST'));

        // Add additional charges if they exist
        if (rateRes.data.RateQuote.Charges) {
            rateRes.data.RateQuote.Charges.forEach(charge => {
                  const type = charge.Type?.toUpperCase().trim();
                FINALRESPONSE.CHARGE_DETAILS.push(reuse.ShipSurRateRes(charge.Title, parseFloat(charge.Amount.replace(/[$,]/g, '')), 'USD', type, 'RL', chargeCodes));
            });
        }

        return strRateQuote;
    } catch (error) {
        console.error('Rate quote error:', error.response?.data || error.message);
        //throw error;
    }
}