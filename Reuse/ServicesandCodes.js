const fs = require('fs');

function getTermsOfSaleCode(termsOfSale) {
  const termsMap = {
    'Delivered Duty Paid': 'DDP',
    'Delivered Duty Unpaid': 'DDU',
    'Ex Works': 'EXW',
    'Carriage Paid To': 'CPT',
    'Costs, Insurance Paid': 'CIP',
    'Deliver at Place of Unloading': 'DPU',
    'Delivered at Place': 'DAP'
  };
  return termsMap[termsOfSale] || termsOfSale;
}


function getRLServiceName(code) {
  const serviceMap = {
    'STD': 'Standard',
    'GSDS': 'Guaranteed',
    'GSHW': 'GuaranteedHourlyWindow',
    'GSAM': 'GuaranteedByNoon',
    'EXPD': 'Expedited'
  };

  return serviceMap[code] || code;
}

function getTforceLTLServiceName(serviceCode) {
  const serviceMapCA = {
    '308': 'TForce Freight LTL',
    '309': 'TForce Freight LTL - Guaranteed',
    '334': 'TForce Freight LTL Guaranteed A.M.',
    '349': 'Standard LTL'
  };

  return serviceMapCA[serviceCode] || serviceCode;
}
function getUSPSPBServiceName(serviceCode) {
  const serviceMap = {
    'BPM': 'Bound Printed Matter',
    'FCM': 'First-Class Mail',
    'LIB': 'Library Mail',
    'MEDIA': 'Media Mail',
    'PRCLSEL': 'Parcel Select',
    'PSLW': 'Parcel Select Lightweight',
    'PM': 'Priority Mail',
    'EM': 'Priority Mail Express',
    'UGA': 'Ground Advantage',
    'FCMI': 'First-Class Mail International',
    'FCPIS': 'First-Class Package International Service',
    'EMI': 'Priority Mail Express International',
    'PMI': 'Priority Mail International'
  };

  return serviceMap[serviceCode] || serviceCode;
}

function getUSPSPBAccessorialName(serviceCode) {
  const accessorialMap = {
    'Ins': 'Insured Mail',
    'InsRD': 'Insured Mail with Restricted Delivery',
    'DelCon': 'Delivery Confirmation',
    'Sig': 'Signature Confirmation',
    '08': 'UPS Worldwide Expedited',
    '190': 'EXTENDED AREA',
    '199': 'HAZ MAT',
    '200': 'DRY ICE',
    '205': 'ISC ALCOHOLIC BEVERAGES',
    '206': 'ISC BIOLOGICAL SUBSTANCES',
    '220': 'HOLD FOR PICKUP',
    '240': 'ORIGIN CERTIFICATE',
    '250': 'PRINT RETURN LABEL',
    '260': 'PRINT N MAIL',
    '270': 'RESIDENTIAL ADDRESS',
    '300': 'SATURDAY DELIVERY',
    '310': 'SATURDAY INTERNATIONAL PROCESSING FEE',
    '350': 'ELECTRONIC RETURN LABEL',
    '375': 'FUEL SURCHARGE',
    '376': 'DELIVERY AREA',
    '377': 'LARGE PACKAGE',
    '378': 'SHIPPER PAYS DUTY TAX',
    '379': 'SHIPPER PAYS DUTY TAX UNPAID',
    '380': 'EXPRESS PLUS SURCHARGE',
    '400': 'INSURANCE',
    '401': 'SHIP ADDITIONAL HANDLING',
    '452': 'REFRIGERATION',
    '480': 'SECURITY SURCHARGE',
    '500': 'SHIPMENT COD',
    '510': 'LIFT GATE FOR PICKUP',
    '511': 'LIFT GATE FOR DELIVERY',
    '520': 'OVERSIZE PALLET'
  };

  return accessorialMap[serviceCode] || serviceCode;
}

function getUPSServiceName(serviceCode) {
  const serviceMap = {
    '03': 'UPS Ground',
    '01': 'UPS Next Day Air',
    '02': 'UPS 2nd Day Air',
    '07': 'UPS Worldwide Express',
    '08': 'UPS Worldwide Expedited',
    '11': 'UPS Standard',
    '12': 'UPS 3 Day Select',
    '13': 'UPS Next Day Air Saver',
    '14': 'UPS Next Day Air Early',
    '17': 'UPS® Worldwide Economy DDU',
    '54': 'UPS Worldwide Express Plus',
    '59': 'UPS 2nd Day Air A.M.',
    '65': 'UPS Worldwide Saver',
    'M2': 'UPS First-Class Mail',
    'M3': 'UPS Priority Mail'
  };

  return serviceMap[serviceCode] || serviceCode;
}

function getUPSServiceNameCA(serviceCode) {
  const serviceMapCA = {
    '03': 'UPS Ground',
    '01': 'UPS Express',
    '02': 'UPS Expedited',
    '07': 'UPS Worldwide Express',
    '08': 'UPS Worldwide Expedited',
    '11': 'UPS Standard',
    '12': 'UPS 3 Day Select',
    '13': 'UPS Express Saver',
    '14': 'UPS Express Early',
    '17': 'UPSTM Worldwide Economy DDU',
    '54': 'UPS Worldwide Express Plus',
    '59': 'UPS 2nd Day Air A.M.',
    '65': 'UPS Express Saver',
    '70': 'UPS Access Point Economy',
    '72': 'UPSTM Worldwide Economy DDP'
  };

  return serviceMapCA[serviceCode] || serviceCode;
}
function getUPSAccessorialName(Code) {
  const serviceMap = {
    '100': 'Additional Handling',
    '110': 'Cod',
    '120': 'Delivery Confirmation',
    '121': 'Ship Delivery Confirmation',
    '08': 'Ups Worldwide Expedited',
    '190': 'Extended Area',
    '199': 'Haz Mat',
    '200': 'Dry Ice',
    '205': 'Isc Alcoholic Beverages',
    '206': 'Isc Biological Substances',
    '220': 'Hold For Pickup',
    '240': 'Origin Certificate',
    '250': 'Print Return Label',
    '260': 'Print N Mail',
    '270': 'Residential Address',
    '300': 'Saturday Delivery',
    '310': 'Saturday International Processing Fee',
    '350': 'Electronic Return Label',
    '375': 'Fuel Surcharge',
    '376': 'Delivery Area',
    '377': 'Large Package',
    '378': 'Shipper Pays Duty Tax',
    '379': 'Shipper Pays Duty Tax Unpaid',
    '380': 'Express Plus Surcharge',
    '400': 'Insurance',
    '401': 'Ship Additional Handling',
    '430': 'Peak Season',
    '434': 'Surge Fee',
    '452': 'Refrigeration',
    '480': 'Security Surcharge',
    '500': 'Shipment Cod',
    '510': 'Lift Gate For Pickup',
    '511': 'Lift Gate For Delivery',
    '520': 'Oversize Pallet',
    '540': 'Direct to Retail',
    '541': 'Direct Delivery Only',
    '542': 'Deliver to Addressee Only',
    '543': 'Direct to Retail COD',
    '544': 'Retail Access Point',
    '545': 'Shipping Ticket Notification'
  };

  return serviceMap[Code] || Code;
}


function packagingTypeCodes(Code) {
  const packagingMap = {
    'BAG': 'BAG',
    'BALE': 'BAL',
    'BARREL': 'BAR',
    'BUNDLE': 'BDL',
    'BOX': 'BOX',
    'BASKET': 'BSK',
    'SKID': 'SKD',
    'TUBE': 'TBE',
    'ROLL': 'ROL',
    'PALLET': 'PLT',
    'CAS': 'CASE',
    '240': 'ORIGIN CERTIFICATE',
    '250': 'PRINT RETURN LABEL',
    '260': 'PRINT N MAIL',
    '270': 'RESIDENTIAL ADDRESS',
    '300': 'SATURDAY DELIVERY',
    '310': 'SATURDAY INTERNATIONAL PROCESSING FEE',
    '350': 'ELECTRONIC RETURN LABEL',
    '375': 'FUEL SURCHARGE',
    '376': 'DELIVERY AREA',
    '377': 'LARGE PACKAGE',
    '378': 'SHIPPER PAYS DUTY TAX',
    '379': 'SHIPPER PAYS DUTY TAX UNPAID',
    '380': 'EXPRESS PLUS SURCHARGE',
    '400': 'INSURANCE',
    '401': 'SHIP ADDITIONAL HANDLING',
    '430': 'PEAK SEASON',
    '452': 'REFRIGERATION',
    '480': 'SECURITY SURCHARGE',
    '500': 'SHIPMENT COD',
    '510': 'LIFT GATE FOR PICKUP',
    '511': 'LIFT GATE FOR DELIVERY',
    '520': 'OVERSIZE PALLET'
  };

  return packagingMap[Code] || Code;
}

module.exports = { packagingTypeCodes, getUPSAccessorialName, getUPSServiceNameCA, getUPSServiceName, getUSPSPBAccessorialName, getUSPSPBServiceName, getTforceLTLServiceName, getTermsOfSaleCode, getRLServiceName }
