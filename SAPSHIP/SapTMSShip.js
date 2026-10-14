const express = require('express');
const router = express.Router();
const xml2js = require('xml2js');
const axios = require('axios');
const { v4: uuidv4 } = require("uuid");

const FedExShip = require("../CARRIER/FEDEX/SapFedEx.js");
const upsShip = require("../CARRIER/UPS/SapUPS.js");

const dbCon = require("../database/dbsaveandupdate.js");
const reuse = require('../Reuse/utilityfunctions.js');
let CarrierCredentialsData = null;

router.post('/', async (req, res) => {

    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept");
    // Parsed XML/JSON from middleware
    const raw = req.body;
    CarrierCredentialsData = await dbCon.fetchCarrierCredentials();
    // Remove namespaces safely
    const body = stripNamespaces(raw);

    console.log("Received Body:", JSON.stringify(body));

    // Normalize SOAP and non-SOAP formats
    const payload = extractPayload(body);

    console.log("Normalized Payload:", JSON.stringify(payload));

    var shiptpcompany = payload.TransportationOrderRequest.TransportationDocument.TransportationStage.UnloadingLocation.Address?.OrganisationFormattedName
    const shipper = payload.TransportationOrderRequest.TransportationDocument.TransportationStage.LoadingLocation.Address.PhysicalAddress;
    const shipTo = payload.TransportationOrderRequest.TransportationDocument.TransportationStage.UnloadingLocation.Address.PhysicalAddress;
    //  let noOfPacks = (payload.TransportationOrderRequest.TransportationDocument.TransportationStage.ItemAssignment.length);
    const itempackages = payload.TransportationOrderRequest.TransportationDocument.Item || [];
    const ItemAssignmentarray = payload.TransportationOrderRequest.TransportationDocument.TransportationStage.ItemAssignment || [];
    let strLabelType = 'ZPL';
    //let packItems = [];
    // ItemAssignmentarray.forEach(pkg => {
    //     packItems = packItems.concat(
    //         itempackages.filter(x => x.ID === pkg.ItemID && x.CategoryCode === "PKG")
    //     );
    // });

    const packItems = ItemAssignmentarray.flatMap(pkg =>
        itempackages.filter(x => x.ID === pkg.ItemID && x.CategoryCode === "PKG")
    );

    let shipmentData = {
        HEADER_INFO: {
            ShipDate: payload.TransportationOrderRequest?.MessageHeader?.CreationDateTime,

        },
        Shipper: formatAddress(shipper, shiptpcompany),
        ShipFrom: formatAddress(shipper, shiptpcompany),
        ShipTo: formatAddress(shipTo, shiptpcompany),
        Packages: createPackagesArray(packItems)

    };


    const recipientParty = payload.TransportationOrderRequest.MessageHeader.RecipientParty;
    const standardIDs = Array.isArray(recipientParty?.StandardID)
        ? recipientParty.StandardID
        : [recipientParty?.StandardID].filter(Boolean);

    let carrier = standardIDs.find(
        item => item?.$?.schemeAgencyID === "182"
    )?._ ?? "";

    //const res = await pool.query("SELECT * FROM public.\"CARRIER_DETAILS\""); // WHERE \"Carrier\" = 'UPS'
    //   try {
    //     const res = await pool.query("SELECT details 	FROM public.carrieraccounts where details->>'IsActive' = 'true'");
    //     console.log(res.rows);
    //   } catch (error) {
    //     console.log(error.message);
    //   }
    //res.send(jsonObject).status(200);

    var ShipAll = [];
    var ShipResponse = {}
    ShipResponse['Errors'] = [];
    let ServiceName = '';
    if (carrier === 'FDEG' || carrier === 'FDEN' || carrier === 'FEDEX') {
        carrier = 'FEDEX'; ServiceName = 'FEDEX_GROUND'
    }
    if (carrier === 'UPS') {
        ServiceName = '03'
    }
    let carrierResponse;
    shipmentData.CARRIER_DETAILS = await reuse.mapCarrierCredentials(CarrierCredentialsData, carrier, '', ServiceName);
    if (carrier === 'FEDEX') {
        carrierResponse = await FedExShip.SapFedEx(shipmentData);
    } else if (carrier === 'UPS') {
        carrierResponse = await upsShip.SapUPS(shipmentData);
    } else if (carrier === 'RLCA') {
        carrierResponse = await rlShip.SapRL(shipmentData);
    } else if (carrier === 'ABF') {
        carrierResponse = await abfShip.SapABF(shipmentData);
    } else if (carrier.startsWith('UPS')) {
        carrierResponse = await upsShip.SapUPS(shipmentData);
    } else if (carrier.startsWith('DHL')) {
        carrierResponse = await dhlShip.Sapdhl(shipmentData);
    } else {
        carrierResponse = await FedExShip.SapFedEx(shipmentData);
    }

    // Process the carrier response
    const isSuccess = carrierResponse.status?.toUpperCase() === 'SUCCESS';
    let confirmationStatus = isSuccess ? 'AP' : 'RE';
    //const ShipResponse = { Errors: [] };


    if (isSuccess) {
        let responseXml = await buildResponse(payload, packItems, carrierResponse, strLabelType);
        const resultcode = await sendSoapRequest(responseXml)
        return res.status(resultcode).send('');
    }
    else {
        console.log(carrierResponse)
        confirmationStatus = 'RE'
        carrierResponse.message.forEach(er => {
            ShipResponse.Errors.push(er);
        });
        return res.status(500).send('');
    }
});

function extractPayload(body) {
    // Case 1: SOAP Envelope
    if (body?.Envelope?.Body) {
        return body.Envelope.Body;
    }
    // Case 2: Namespaced SOAP Envelope (after stripping namespaces)
    if (body?.Envelope) {
        return body.Envelope;
    }
    // Case 3: Body only
    if (body?.Body) {
        return body.Body;
    }
    // Case 4: Direct XML payload (no Envelope)
    if (body?.TransportationOrderRequest) {
        return body;
    }
    // Case 5: JSON or unknown
    return body;
}

function stripNamespaces(obj) {
    if (Array.isArray(obj)) {
        return obj.map(stripNamespaces);
    }
    else if (obj && typeof obj === 'object') {
        const newObj = {};
        for (let key in obj) {
            const cleanKey = key.includes(':') ? key.split(':')[1] : key;
            newObj[cleanKey] = stripNamespaces(obj[key]);
        }
        return newObj;
    }
    return obj;
}


async function buildResponse(requestJson, packItems, ShipResponse, labeltype) {
    const req = requestJson.TransportationOrderRequest;
    const msgHeader = req.MessageHeader;
    const transDoc = req.TransportationDocument;
    const packages = ShipResponse.Packages || [];
    const SHIPPING_DOCUMENTS = ShipResponse.SHIPPING_DOCUMENTS || [];
    let mimeCode = '', labelext = '';
    if (labeltype === 'ZPL') {
        mimeCode = "text/plain";
        labelext = 'txt'
    } else if (labeltype === 'PNG') {
        mimeCode = "image/png";
        labelext = 'PNG'
    }
    // --- Build MessageHeader for response ---
    const responseHeader = {
        CreationDateTime: msgHeader.CreationDateTime,
        RecipientBusinessSystemID: msgHeader.SenderBusinessSystemID,
        SenderParty: {
            InternalID: req.MessageHeader.RecipientParty.InternalID,
            StandardID: Array.isArray(msgHeader.RecipientParty.StandardID)
                ? msgHeader.RecipientParty.StandardID.find((sid) => sid.$.schemeAgencyID === "310")
                || msgHeader.RecipientParty.StandardID[0]  // Fallback to first if "310" not found
                : msgHeader.RecipientParty.StandardID  // Use as-is if object
        }
    };
    try {
        if (msgHeader.SenderParty) {
            responseHeader.RecipientParty = {
                StandardID: {
                    _: msgHeader.SenderParty.StandardID._,
                    $: { schemeAgencyID: msgHeader.SenderParty.StandardID.$.schemeAgencyID }
                }
            }
        };
    } catch (error) { }
    const attachmentDocs = packages.map((pkg, idx) => ({
        $: { actionCode: "01" },
        PathName: `${pkg.TrackingNumber}_Label.${labelext}`,
        Name: "File",
        SystemAdministrativeData: {
            CreationDateTime: msgHeader.CreationDateTime
        },
        VisibleIndicator: true,
        VersioningEnabledIndicator: true,
        CategoryCode: 2,
        TypeCode: "ATCMT",
        MIMECode: mimeCode,
        Description: `${pkg.TrackingNumber}_Label.${labelext}`,
        FileContentBinaryObject: {
            _: SHIPPING_DOCUMENTS[idx].encodedLabel,
            $: {
                mimeCode: mimeCode,
                fileName: "File"
            }
        }
    }));

    // --- BusinessTransactionDocumentReference (loop over Packages) ---
    const btRefs = packages.flatMap((pkg) => [
        {
            ID: pkg.TrackingNumber,
            TypeCode: "BN",
            IssueDateTime: msgHeader.CreationDateTime
        }
    ]);

    btRefs.push({
        ID: packages[0].TrackingNumber,
        TypeCode: "T67",
        IssueDateTime: msgHeader.CreationDateTime
    },)
    const btitems = packItems.flatMap((pkg, count) => [
        {
            ID: pkg.ID,
            BusinessTransactionDocumentReference: {
                BusinessTransactionDocumentReference: {
                    ID: packages[count].TrackingNumber,
                },
                TransportationDocumentTypeCode: "BN"
            }
        }
    ]);

    // --- Build response object ---

    const responseObj = {
        "soapenv:Envelope": {
            $: {
                "xmlns:soapenv": "http://schemas.xmlsoap.org/soap/envelope/",
                "xmlns:glob": "http://sap.com/xi/SAPGlobal20/Global",
                "xmlns:wsa": "http://www.w3.org/2005/08/addressing"
            },
            "soapenv:Header": {
                "wsa:Action":
                    "http://sap.com/xi/TMS/Global/TransportationOrderConfirmation_In/TransportationOrderConfirmation_InRequest",
                "wsa:MessageID": `uuid:${uuidv4()}`,
                "wsa:To":
                    "https://PCS4H2022.plutocloud.com:8443/sap/bc/srt/xip/scmtms/torci/800/torci/transportationorderconfirmation_in"
            },
            "soapenv:Body": {
                "glob:TransportationOrderConfirmation": {
                    MessageHeader: responseHeader,
                    TransportationDocument: {
                        AcceptanceStatusCode: "AP", //RE
                        RequestForQuoteRejectionReasonCode: "",
                        Driver1Name: "",
                        Driver2Name: "",
                        TransportMeansID: "",
                        TransportMeansHomeCountryCode: "",
                        BaseBusinessTransactionDocumentReference:
                            transDoc.BaseBusinessTransactionDocumentReference,
                        AttachmentFolder: { Document: attachmentDocs },
                        BusinessTransactionDocumentReference: btRefs,
                        Item: btitems
                    },
                    Log: {}
                }
            }
        }
    };

    console.log(JSON.stringify(responseObj))

    // --- Build XML ---
    const builder = new xml2js.Builder({
        xmldec: { version: "1.0", encoding: "UTF-8" }
    });



    return builder.buildObject(responseObj);

}


async function sendSoapRequest(soapXml) {
    try {
        const url =
            "http://PCS4H2022.plutocloud.com:8001/sap/bc/srt/xip/scmtms/torci/800/torci/transportationorderconfirmation_in";

        const username = "raju";
        const password = "Pluto12345";

        const inresult = await axios.post(url, soapXml, {
            headers: {
                "Content-Type": "text/xml;charset=UTF-8",
                "SOAPAction":
                    '"http://sap.com/xi/TMS/Global/TransportationOrderConfirmation_In/TransportationOrderConfirmation_InRequest"',
                "Accept-Encoding": "gzip,deflate",
                Connection: "Keep-Alive",
                "User-Agent": "Apache-HttpClient/4.5.5 (Java/17.0.12)"
            },
            auth: {
                username,
                password
            }
        });

        console.log("Response status:", inresult.status);
        console.log("Response data:", inresult.data);
        return inresult.status;
    } catch (error) {
        console.error("SOAP Request failed:", error.message);
        if (error.response) {

            console.error("Response code:", error.response.status);
            console.error("Response body:", error.response.data);
            return error.response.status;
        } else {
            return error.message;
        }
    }
}

function createPackagesArray(packItems) {
    return packItems
        .filter(item => item?.GrossWeightTransportationQuantity?._)
        .map(item => ({
            Description: item?.DESCRIPTION,
            Weight: item.GrossWeightTransportationQuantity._,
            Weightunits: item.GrossWeightTransportationQuantity.$?.unitCode || '',
            DimensionUnits: 'IN'
        }));
}

// Helper function to format the address object
function formatAddress(addressObj, shiptpcompany) {
    return {
        COMPANY: addressObj?.HouseID || shiptpcompany,
        CONTACT: addressObj?.HouseID || shiptpcompany,
        ADDRESS_LINE1: addressObj?.StreetName || '',
        ADDRESS_LINE2: addressObj?.HouseID || '',
        CITY: addressObj?.CityName || '',
        STATE: addressObj?.RegionCode || '',
        ZIPCODE: addressObj?.StreetPostalCode || '',
        COUNTRY: addressObj?.CountryCode || '',
        PHONE: '',
        EMAIL: ''
    };
}
module.exports = router;
