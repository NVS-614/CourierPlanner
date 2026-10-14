const db = require('../database/db');
// Helper functions for conversions and formatting
const weightUnitsMap = {
    'KG': 'LB',
    'G': 'OZ',
    'LB': 'LB',
    'OZ': 'OZ'
};

const dimensionUnitsMap = {
    'M': 'IN',
    'CM': 'IN',
    'IN': 'IN',
    'FT': 'IN'
};

function convertWeight(weightKg, fromUnit) {
    if (fromUnit === 'KG') {
        return (weightKg * 2.20462).toFixed(2); // Convert KG to LB
    }
    return weightKg.toString();
}

function convertDimensions(length, width, height, fromUnit) {
    if (fromUnit === 'M') {
        // Convert meters to inches
        const lengthIn = (length * 39.3701).toFixed(2);
        const widthIn = (width * 39.3701).toFixed(2);
        const heightIn = (height * 39.3701).toFixed(2);
        return `${lengthIn}x${widthIn}x${heightIn}`;
    }
    return `${length}x${width}x${height}`;
}

function formatDate(dateString) {
    if (!dateString) {
        return new Date().toISOString();
    }
    return new Date(dateString).toISOString();
}

async function getService(servicecode, servicelist, carrier) {
    const found = servicelist.find(item =>
        item.details.sapRefServiceCode === servicecode && item.details.CarrierName === carrier
    );
    return found ? found.details.ServiceCode : 'FEDEX_GROUND'

}
async function getShipperFromWarehouse(locationID, shipperslist) {
    const found = shipperslist.find(item =>
        item.details.shippingpoint === locationID
    );
    return found ? {
        COMPANY: found.details.LocationName || 'DEFAULT_SHIPPER',
        CONTACT: found.details.Contact || '',
        ADDRESS_LINE1: found.details.AddressLine1 || '',
        ADDRESS_LINE2: found.details.AddressLine2 || '',
        ADDRESS_LINE3: '', // Not in your DB structure
        CITY: found.details.City || '',
        STATE: found.details.State || '',
        ZIPCODE: found.details.ZipCode || '',
        COUNTRY: found.details.Country || 'US',
        PHONE: found.details.Phone || '',
        EMAIL: found.details.Email || ''
    } :
        {
            COMPANY: 'DEFAULT_SHIPPER',
            CONTACT: '',
            ADDRESS_LINE1: '',
            ADDRESS_LINE2: '',
            ADDRESS_LINE3: '',
            CITY: '',
            STATE: '',
            ZIPCODE: '',
            COUNTRY: 'US',
            PHONE: '',
            EMAIL: ''
        };
}
async function getShipToFromPartner(partners) {
    const shipToPartner = partners.find(p => p.role === 'SH');
    if (!shipToPartner) {
        return {
            COMPANY: '',
            CONTACT: '',
            ADDRESS_LINE1: '',
            ADDRESS_LINE2: '',
            ADDRESS_LINE3: '',
            CITY: '',
            STATE: '',
            ZIPCODE: '',
            COUNTRY: 'US',
            PHONE: '',
            EMAIL: ''
        };
    }

    const address = shipToPartner.address || {};
    return {
        COMPANY: shipToPartner.id || '',
        CONTACT: shipToPartner.name || '',
        ADDRESS_LINE1: `${address.street || ''} ${address.houseNumber || ''}`.trim(),
        ADDRESS_LINE2: address.district || '',
        ADDRESS_LINE3: '',
        CITY: address.city || '',
        STATE: address.region || '',
        ZIPCODE: address.postalCode || '',
        COUNTRY: address.country || 'US',
        PHONE: address.phone || '',
        EMAIL: address.email || ''
    };
}
async function mapCarrierCredentials(dbcarrier, ServiceName, CarrierCredentialsData) {
    const found = CarrierCredentialsData.find(item =>
        item.details.CarrierName === dbcarrier
    ); //&& item.details.Account === dbaccount  * Need to add

    return found ? {
        Carrier: found.details.CarrierName,
        ServiceName: ServiceName || "FEDEX_GROUND",
        PaymentType: "Sender",
        SHIPPING_ACCOUNT: found.details.Account,
        USERID: found.details.USERID,
        PASSWORD: found.details.PASSWORD,
        LabelType: found.details.LabelType || "PDF"
    } :
        {
            Carrier: 'FEDEX',
            ServiceName: "FEDEX_GROUND",
            PaymentType: "Sender",
            SHIPPING_ACCOUNT: "740561073",
            USERID: "l7e48144d986db4a25a418bcb9a186383e",
            PASSWORD: "d73181e3e6044eba83160516b0e8d987",
            LabelType: "PDF"
        };
}

// Main transformation function
async function transformData(sourceData, CarrierCredentialsData, shipperslist, serviceMapList) {
    // Use Promise.all() to await all async operations in parallel
    const transformedItems = await Promise.all(
        sourceData.map(async item => {
            const { header, partners, packages = [] } = item;
            let carrier = header.Carrier || 'FEDEX';
            let service = header.shippingCondition
                ? await getService(header.shippingCondition, serviceMapList, carrier) : 'FEDEX_GROUND';
            // Await the async database calls
            const shipper = await getShipperFromWarehouse(header.shippingPoint, shipperslist);
            const shipTo = await getShipToFromPartner(partners);
            const carrierinfo = await mapCarrierCredentials(carrier, service, CarrierCredentialsData);

            // Transform packages
            const transformedPackages = packages.map(pkg => ({
                Weight: convertWeight(pkg.GrossWeight || 0, pkg.WeightUnit || 'KG'),
                Weightunits: weightUnitsMap[pkg.WeightUnit] || 'LB',
                Dimension: convertDimensions(
                    pkg.HandlingUnitLength || 0,
                    pkg.HandlingUnitWidth || 0,
                    pkg.HandlingUnitHeight || 0,
                    pkg.UnitOfMeasureDimension || 'M'
                ),
                DimensionUnits: dimensionUnitsMap[pkg.UnitOfMeasureDimension] || 'IN',
                Sno: pkg.HandlingUnitExternalID || '',
                HU: pkg.HighestLevelHandlingUnitNumber || '',
                Class: '',
                // PackingType: pkg.PackagingMaterialType || '',
                //subPackingType: pkg.PackagingMaterial || '',
                PACKAGE_LVL_SPECIAL_SERVICES: {}
            }));

            // Return transformed object
            return {
                HEADER_INFO: {
                    FeederSystem: '',
                    DocumentNumber: header.deliveryId || '',
                    DocumentType: header.deliveryType || '',
                    ShipDate: formatDate(),
                    ShipmentType: header.shippingCondition || '',
                    Location: header.shippingPoint || header.warehouseId || '',
                    ERP: 'SAP EWM'
                },
                Shipper: shipper,
                ShipTo: shipTo,
                CARRIER_DETAILS: carrierinfo,
                Packages: transformedPackages.length > 0 ? transformedPackages : [{
                    Weight: "20",
                    Weightunits: "LB",
                    Dimension: "10x10x10",
                    DimensionUnits: "IN",
                    Sno: "",
                    HU: "",
                    Class: "",
                    PackingType: "",
                    subPackingType: "",
                    PACKAGE_LVL_SPECIAL_SERVICES: {}
                }],
                SHIPMENT_LVL_SPECIAL_SERVICES: {},
                INTERNATIONAL_DETAILS: {
                    ITEM_INFO: []
                }
            };
        })
    );

    return transformedItems;
}

async function mapCarrierCredentialsold(carrier, account, ServiceName) {
    let defaultobj = {
        Carrier: carrier || 'FEDEX',
        ServiceName: ServiceName || "FEDEX_GROUND",
        PaymentType: "Sender",
        SHIPPING_ACCOUNT: account || "740561073",
        USERID: "l7e48144d986db4a25a418bcb9a186383e",
        PASSWORD: "d73181e3e6044eba83160516b0e8d987",
        LabelType: "PDF"
    }
    try {
        const query = `SELECT details FROM public.carrieraccounts WHERE details->>'IsActive' = 'true' AND details->>'CarrierName' = $1 LIMIT 1`;
        const result = await db.query(query, [carrier]);
        // Check if any rows were returned
        if (result.length === 0) {
            console.log(`No active carrier found for: ${carrier}`);
            return defaultobj;
        }
        // Extract the details from the first row
        const details = result[0].details;
        return {
            Carrier: details.CarrierName || carrier,
            ServiceName: ServiceName,
            PaymentType: details.PAYMENT_TYPE || "Sender",
            SHIPPING_ACCOUNT: details.Account,
            USERID: details.USERID,
            PASSWORD: details.PASSWORD,
            LabelType: details.LabelType || "PDF"
        };

    } catch (error) {
        console.error('Error mapping carrier credentials:', error);
        return defaultobj
    }
}

// Or use it in your application
module.exports = { transformData };