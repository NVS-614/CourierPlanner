// carriers/PITTOHIO/ship.js

const axios = require('axios');
const moment = require('moment');
const reuse = require('../../Reuse/utilityfunctions.js');
const Getcode = require('../../Reuse/ServicesandCodes.js');
const labeldocprocess = require("../../ShippingDocuments/labeldocuments.js");
const documentprocess = require("../../ShippingDocuments/documents.js");

const { buildFinalResponse } = require('../../Reuse/responseBuilder');

const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});


module.exports = async (request, chargeCodes) => {

    const { CARRIER_DETAILS, PACKAGES } = request;

    let FS = buildFinalResponse(request);
    const rateurl = CARRIER_DETAILS.RATEURL || process.env.PITTOHIO_RATE;
    const shipurl = CARRIER_DETAILS.SHIPURL || process.env.PITTOHIO_SHIP;
    const bolurl = CARRIER_DETAILS.BOLURL || process.env.PITTOHIO_BOL;
    const labelurl = CARRIER_DETAILS.LABELURL || process.env.PITTOHIO_LABEL;
    const user = CARRIER_DETAILS.USERID;
    const pswd = CARRIER_DETAILS.PASSWORD;
    const service = CARRIER_DETAILS?.SERVICE_CODE || CARRIER_DETAILS?.SERVICE_NAME;
    const SLSS = request?.SHIPMENT_LVL_SPECIAL_SERVICES;
    try {
        // Get rates first
        // const strRateQuote = await GetPITTOHIOrates(request, rateurl, FS, service, chargeCodes);
        //  console.log('Rate Quote:', strRateQuote);
        const bolPayload = buildBOLPayload(request, user, pswd);
        //console.log('PITTOHIO Ship Request:', JSON.stringify(bolPayload, null, 2));
        // Create shipment
        const sres = await axiosInstance.post(shipurl, bolPayload, {
            headers: {
                'Content-Type': 'application/json',
                Accept: 'application/json',
            }
        });
        //console.log('PITTOHIO Ship Response:', sres.data);
        if (sres.data.Errors && sres.data.Errors.length > 0) {
            FS.STATUS = 'Error';
            FS.TRACKING_STATUS = '';
            FS.ERRORS = sres.data.Errors;
            return FS;
        }
        FS.STATUS = 'Success';
        FS.TRACKING_STATUS = 'Shipped';
        const bolid = sres.data.BillOfLading.BillOfLadingId;
        // Update tracking numbers  BillOfLadingId to PreAssignedPittPro in PRODUCTION
        PACKAGES.forEach(pkg => {
            FS.PACKAGES.push({ TRACKING_NUMBER: sres.data.BillOfLading.BillOfLadingId });
        });
        FS.HEADER_INFO.MASTER_TRACKING_NUMBER = FS.PACKAGES[0]?.TRACKING_NUMBER;
        // Get Label document
        try {
            const labelRes = await axiosInstance.get(labelurl + `${bolid}?email=${user}&pwd=${pswd}&startPos=1&count=1`, {
                responseType: 'arraybuffer'
            });
            const pdfBase64 = Buffer.from(labelRes.data).toString('base64');
            const docName = `${FS.HEADER_INFO.MASTER_TRACKING_NUMBER}_LABEL.PDF`;
            FS.SHIPPING_DOCUMENTS.push(
                reuse.formatShipDoc('PITTOHIO', 'Bill Of Lading', 1, docName, pdfBase64, 'PDF')
            );
        } catch (bolError) {
            console.error('BOL fetch failed:', bolError.message);
        }
        // Get BOL document
        try {
            const bolRes = await axiosInstance.get(bolurl + `${bolid}?email=${user}&pwd=${pswd}`, {
                responseType: 'arraybuffer'
            });
            console.log(bolRes.headers['content-type']);
            const pdfBase64 = Buffer.from(bolRes.data).toString('base64');
            const docName = `${FS.HEADER_INFO.MASTER_TRACKING_NUMBER}_BOL.PDF`;
            FS.SHIPPING_DOCUMENTS.push(
                reuse.formatShipDoc('PITTOHIO', 'Bill Of Lading', 1, docName, pdfBase64, 'PDF')
            );
        } catch (bolError) {
            console.error('BOL fetch failed:', bolError.message);
        }

        let docp = [];
        // // Generate other documents
        // if (CARRIER_DETAILS?.LABELTYPE === 'ZPL') {
        //     docp.push(documentprocess.preparelabel_ZPL(request));
        // } else if (CARRIER_DETAILS?.LABELTYPE === 'PNG') {
        //     docp.push(documentprocess.prepareLabel_png_sharp(request));
        // } else {
        //     docp.push(labeldocprocess.preparelabel_pdfkit(request));
        // }
        // docp.push(documentprocess.preparePackingSlip_pdfkit(request));

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
                                FS.SHIPPING_DOCUMENTS.push(rdocdata)
                            );
                        } else if (docdata) {
                            FS.SHIPPING_DOCUMENTS.push(docdata);
                        }
                    } catch (err) {
                        console.error("Document parse error:", err.message);
                    }
                });
            }
        } catch (docError) {
            console.error("Document processing failed:", docError.message);
            FS.ERRORS.push(docError.message);
        }

        return FS;

    } catch (ex) {
        console.error("PITTOHIO Ship Error:", ex?.response?.data || ex.message);
        FS.STATUS = 'Error';
        let errordesc = ex?.response?.statusText || '';
        FS.ERRORS.push(errordesc);
        if (ex?.response?.data) {
            const apiErrors = reuse.handleShipErrorRes(ex) || [];
            FS.ERRORS.push(...apiErrors);
        } else if (ex?.message) {
            FS.ERRORS.push(ex.message);
        }
        return FS;
    }
};


function buildBOLPayload(req, user, pswd) {
    const header = req.HEADER_INFO || {};
    const shipper = req.SHIPPER || {};
    const shipto = req.SHIPTO || {};
    const packages = req.PACKAGES || [];
    const slss = req.SHIPMENT_LVL_SPECIAL_SERVICES || {};
    // Prepare shipment request
    const [datePart] = req.HEADER_INFO.SHIP_DATE.split('T');
    const [paymentterms, paymentpayer] =
        PAYMENT_MAP[req.CARRIER_DETAILS?.PAYMENT_TYPE] || ['PPD', 'SHIPPER'];


    // 🔹 Helper to map package details
    const buildDetails = (packages) => {
        return packages.map((pkg) => ({
            Pieces: Number(pkg.QUANTITY || 1),
            PackageType: (pkg?.PACKING_TYPE && packagingTypeCodes(pkg.PACKING_TYPE)) || 'packages',
            Weight: Number(pkg.WEIGHT || 0),
            Hazmat: slss.HAZMAT === true,
            Description: pkg.DESCRIPTION || "GOODS",
            Class: pkg.LTL_CLASS || ""
        }));
    };

    // 🔹 Build final payload
    const payload = {
        EmailAddress: user,
        Password: pswd,

        BillOfLading: {
            BillOfLadingId: Number(header.DOCUMENT_NUMBER || 0),

            // 🔹 SHIPPER
            ShipperName: shipper.COMPANY || "",
            ShipperAddress: shipper.ADDRESS_LINE1 || "",
            ShipperAddress2: shipper.ADDRESS_LINE2 || "",
            ShipperCity: shipper.CITY || "",
            ShipperState: shipper.STATE || "",
            ShipperZip: shipper.ZIPCODE || "",
            ShipperContactPhone: shipper.PHONE || "",
            ShipperContactFax: "",
            ShipperContactEmail: shipper.EMAIL || "",
            ShipperContactName: shipper.CONTACT || "",

            // 🔹 CONSIGNEE
            ConsigneeName: shipto.COMPANY || "",
            ConsigneeAddress: shipto.ADDRESS_LINE1 || "",
            ConsigneeAddress2: shipto.ADDRESS_LINE2 || "",
            ConsigneeCity: shipto.CITY || "",
            ConsigneeState: shipto.STATE || "",
            ConsigneeZip: shipto.ZIPCODE || "",
            ConsigneeContactPhone: shipto.PHONE || "",
            ConsigneeContactFax: "",
            ConsigneeContactEmail: shipto.EMAIL || "",
            ConsigneeContactName: shipto.CONTACT || "",

            // 🔹 THIRD PARTY (optional mapping)
            ThirdPartyName: "",
            ThirdPartyAddress: "",
            ThirdPartyAddress2: "",
            ThirdPartyCity: "",
            ThirdPartyState: "",
            ThirdPartyZip: "",
            ThirdPartyContactPhone: "",
            ThirdPartyContactFax: "",
            ThirdPartyContactEmail: "",
            ThirdPartyContactName: "",

            // 🔹 ADDITIONAL INFO
            // SpecialInstructions: buildSpecialInstructions(slss),
            BolNumber: header.DOCUMENT_NUMBER || "",
            PoNumber: header.DOCUMENT_NUMBER || "",
            EmergencyContactInfo: slss.EMERGENCY_CONTACT || "",
            RequesterName: "SYSTEM",
            RequesterPhone: shipper.PHONE || "",
            RequesterEmail: shipper.EMAIL || user,
            RequesterRole: paymentpayer,
            PaymentTerms: paymentterms || "",
            ShipmentDate: datePart,
            PreAssignedPittPro: "",
            Skids: packages.length.toString(),

            // 🔹 DETAILS LOOP
            Details: buildDetails(packages)
        }
    };

    return payload;
}


function packagingTypeCodes(name) {
    const packagingMap = {
        BUNDLE: 'bundles',
        CRATE: 'crates',
        CYLINDER: 'cylinders',
        PACKAGE: 'packages',
        PAIL: 'pails',
        PALLET: 'skids/plts - stackable',
        REEL: 'reels',
        SKID: 'skids/plts - non-stackable',
        TOTE: 'totes'

        //  [
        //     "bundles",
        //     "cartons/boxes",
        //     "crates",
        //     "drums",
        //     "gaylords",
        //     "packages",
        //     "reels",
        //     "skids/plts - stackable",
        //     "skids/plts - non-stackable",
        //     "totes",
        //     "articles exceeding 8 feet",
        //     "pails",
        //     "cylinders",
        //     "other"
        // ]
    };

    return packagingMap[name?.toUpperCase()] || name;
}
const PAYMENT_MAP = Object.freeze({
    Sender: ['PPD', 'SHIPPER'],
    Recipient: ['COL', 'CONSIGNEE'],
    Collect: ['COL', 'CONSIGNEE'],
    ThirdParty: ['3RD', 'THIRDPARTY']
});
