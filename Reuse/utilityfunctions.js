const fs = require('fs');
const sharp = require('sharp');
//const Jimp = require('jimp'); // replace to sharp
const axios = require('axios');
const xml2js = require('xml2js');
const { STATUS_CODES } = require('http');


function escapeXml(str) {
  return str.replace(/[&<>"']/g, function (char) {
    switch (char) {
      case '&': return '&amp;';
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '"': return '&quot;';
      case "'": return '&apos;';
    }
  });
}


function getOrDefault(value, defaultValue) {
  return (value != null && value.trim?.() !== '') ? value : defaultValue;
}
function isValid(value) {
  if (value !== null && value !== "" && value !== undefined && value != 0) {
    // Value is neither null nor an empty string
    return true;
  }
  return false;
}

// Canonical boolean coercion — accepts true / "true" / "x" / "yes" / "1" (case-insensitive).
// Use this everywhere instead of String(x).toLowerCase() === 'true' for consistency.
function isTrue(val) {
  return val === true ||
    (typeof val === 'string' && ['true', 'x', 'yes', '1'].includes(val.toLowerCase().trim()));
}

function saveBase64ZPLToFile(base64ZPL, outputPath) {
  const base64Data = base64ZPL.replace(/^data:application\/x-zpl;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');
  fs.writeFile(outputPath, buffer);
}
function saveBase64ToPNG(base64String, outputPath) {
  const base64Data = base64String.replace(/^data:image\/png;base64,/, '');
  const buffer = Buffer.from(base64Data, 'base64');

  fs.writeFile(outputPath, buffer, (err) => {
    if (err) {
      console.error('Error saving file:', err);
    }


  });
}
async function pdfURLToBase64(url) {
  try {
    const response = await axios.get(url, { responseType: 'arraybuffer' });
    const base64 = Buffer.from(response.data, 'binary').toString('base64');
    return base64;
  } catch (error) {
    console.error('Error fetching PDF:', error);
    return null;
  }
}

function Rotatebase64Data(base64Data) {
  const dataWithoutPrefix = base64Data.replace(/^data:image\/\w+;base64,/, '');
  const buffer = Buffer.from(dataWithoutPrefix, 'base64');
  return sharp(buffer).rotate(90).toBuffer()

}

function LogfileSave(fileName, requestData) {
  const timestamp = new Date().toISOString().replace(/[:.-]/g, '').split('T').join('_'); // "2025-01-02T10:20:30.123Z" => "20250102_102030123Z"
  const filePath = '../LOGS/' + fileName + '_' + timestamp + '.json';
  const jsonData = JSON.stringify(requestData, null, 2);
  fs.writeFile(filePath, jsonData, (err) => {
    if (err) {
      console.error('Error saving request:', err);
    } else {
      //console.log('Request saved successfully.');
    }
  });

}

function LogfileSavexml(fileName, requestData) {
  const filePath = '../LOGS/' + fileName + '.xml';

  fs.writeFile(filePath, requestData, (err) => {
    if (err) {
      console.error('Error saving request:', err);
    } else {
      //console.log('Request saved successfully.');
    }
  });

}

function removeDollarSigns(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeDollarSigns);
  } else if (typeof obj === 'object') {
    const newObj = {};
    for (const key in obj) {
      if (key === '$') {
        Object.assign(newObj, removeDollarSigns(obj[key]));
      } else {
        newObj[key] = removeDollarSigns(obj[key]);
      }
    }
    return newObj;
  }
  return obj;
}


function addTransitDays(transitDays, date) {
  let addedDays = 0; // Track days added
  const resultDate = new Date(date); // Start from the given date

  while (addedDays < transitDays) {
    resultDate.setDate(resultDate.getDate() + 1); // Move to the next day
    const day = resultDate.getDay(); // Get the day of the week (0: Sunday, 6: Saturday)

    // Skip weekends (Saturday and Sunday)
    if (day !== 0 && day !== 6) {
      addedDays++;
    }
  }

  return resultDate;
}
function getCountry3(countryCode) {
  const countryMap = {
    US: 'USA',
    CA: 'CAN'
  };
  return countryMap[countryCode] || countryCode;
}

function parseAndCleanXML(xmlData) {
  try {
    // Step 1: Remove namespaces
    const xmlWithoutNamespaces = xmlData.replace(/xmlns[^=]*="[^"]*"-/g, '');
    // Step 2: Parse XML into JSON
    let parsedResult;
    xml2js.parseString(xmlWithoutNamespaces, { explicitArray: false }, (error, result) => {
      if (error) {
        throw new Error(`Error parsing XML: ${error.message}`);
      } else {
        parsedResult = removeNamespacePrefix(result);
      }
    });
    console.log(JSON.stringify(parsedResult))
    return parsedResult;
  } catch (error) {
    console.error('Error processing XML:', error.message);
    return null;
  }
}

// Function to remove namespace prefixes recursively
function removeNamespacePrefix(obj) {
  if (Array.isArray(obj)) {
    return obj.map(removeNamespacePrefix);
  } else if (obj !== null && typeof obj === 'object') {
    const newObj = {};
    Object.keys(obj).forEach((key) => {
      // Remove prefix before ":" if present
      const cleanKey = key.includes(':') ? key.split(':').pop() : key;

      newObj[cleanKey] = removeNamespacePrefix(obj[key]);
    });
    return newObj;
  }
  return obj; // Return value if not an object or array
}
function removeNamespacePrefix1(obj) {
  if (typeof obj === 'object' && obj.$ && obj.$['xml:lang'] === 'en-CA') {
    delete obj.$['xml:lang'];
  }
  if (typeof obj !== 'object' || obj === null) {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(removeNamespacePrefix);
  }

  const result = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const newKey = key.replace(/^soap:/, '').replace(/^tns:/, '').replace(/^soapenv:/, '').replace(/^ser-root:/, '').replace(/\$/, '').replace(/^s:/, '').replace(/^a:/, '').replace(/^b:/, '');
      result[newKey] = removeNamespacePrefix(obj[key]);
    }
  }

  return result;
}

function identifyType(value) {
  if (typeof value === "string") {
    return "string";
  } else if (Array.isArray(value)) {
    return "array";
  } else if (typeof value === "object" && value !== null) {
    return "object";
  } else {
    return "unknown";
  }
}
//string to object==> JSON.parse() ; objec to string ==> JSON.stringify()
// if (typeof value === "object" && !Array.isArray(value) && value !== null) {
//   console.log("This is an object.");
// }

function formatShipDocSap(doc, docProvider, docName) {
  return {
    // docProvider: docProvider || 'Unknown',
    contentType: 'Label',
    copiesToPrint: doc?.copiesToPrint || '1',
    //   docName: docName || 'Document',
    encodedLabel: doc?.encodedLabel || '',
    docType: doc?.docType || 'Unknown',
  };
}

function formatShipDoc(docProvider, contentType, copies, docName, encodedLabel, docType) {
  return {
    DOC_PROVIDER: docProvider || 'Unknown',
    CONTENT_TYPE: contentType,
    COPIES_TO_PRINT: copies || '1',
    DOC_NAME: docName || 'Document',
    ENCODED_LABEL: encodedLabel,
    DOC_TYPE: docType,
  };
}

function handleErrorRes(CARRIER, error, SHIPPOINT, SalesOrderDate) {

  let Errors = [];
  const base = {
    CARRIER,
    SHIP_POINT: SHIPPOINT,
    SALES_ORDER_DATE: SalesOrderDate
  };


  if (error.response) {
    const { data } = error.response;
    if (data?.response) {
      data.response?.errors.forEach((er) => {
        Errors.push({
          ...base,
          STATUSCODE: er?.code,
          MESSAGE: er.message
        });
      });

    }
    else if (data?.errors?.length) {
      data.errors.forEach((er) => {
        Errors.push({
          ...base,
          STATUSCODE: er?.code,
          MESSAGE: er?.code //er.message
        });
      });
    } else if (data?.errors) {
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        data.errors.forEach((er) => {
          Errors.push({
            ...base,
            STATUSCODE: er?.response?.status,
            MESSAGE: er.message
          });
        });
      } else {
        Errors.push({
          ...base,
          STATUSCODE: '',
          MESSAGE: data.errors?.message || data.errors?.Message,
        });
      }
    } else if (data?.Errors) {
      if (Array.isArray(data.Errors) && data.Errors.length > 0) {
        data.Errors.forEach((er) => {
          Errors.push({
            ...base,
            STATUSCODE: er?.response?.status || data?.Code,
            MESSAGE: er.message || er.ErrorMessage
          });
        });
      } else {
        Errors.push({
          ...base,
          STATUSCODE: '',
          MESSAGE: data.Errors?.message || data.Errors?.ErrorMessage,
        });
      }
    } else if (data?.error?.information) {
      data.error.information.forEach((er) => {
        Errors.push({
          ...base,
          STATUSCODE: data.error?.code,
          MESSAGE: er.message || er.ErrorMessage
        });
      });
    } else if (data?.error?.message) {
      Errors.push({
        ...base,
        STATUSCODE: '',
        MESSAGE: data.error.message
      });
    } else if (data.error) {
      Errors.push({
        ...base,
        STATUSCODE: '',
        MESSAGE: (data?.error_description || '') + ',' + data.error
      });
    } else {
      Errors.push({
        ...base,
        STATUSCODE: '',
        MESSAGE: data
      });
    }
  } else if (error.message) {
    Errors.push({
      ...base,
      STATUSCODE: '',
      MESSAGE: error.message
    });
  } else if (error.error) {
    Errors.push({
      ...base,
      STATUSCODE: '',
      MESSAGE: error.error
    });
  } else {
    Errors.push({
      ...base,
      STATUSCODE: '',
      MESSAGE: String(error)
    });
  }

  return {
    status: 'Error',
    message: Errors
  };
}

function handlesurCharRes(carrier, type, desc, amount, currency, chargeCodes) {
  return {
    DESCRIPTION: desc,
    CHARGE_CODE: type,
    SAP_CHARGE_CODE: chargeCodes ? getsapchargecode(carrier, type, chargeCodes) : null,
    AMOUNT: amount,
    CURRENCY: currency
  };
}

function ShipRateRes(desc, amount, currency, type) {
  return {
    DESCRIPTION: desc,
    CHARGE_CODE: type,
    SAP_CHARGE_CODE: type,
    AMOUNT: amount.toString(),
    CURRENCY: currency
  };
}

function ShipSurRateRes(desc, amount, currency, type, carrier, chargeCodes) {
  return {
    DESCRIPTION: desc,
    CHARGE_CODE: type,
    SAP_CHARGE_CODE: chargeCodes ? getsapchargecode(carrier, type, chargeCodes) : null,
    AMOUNT: amount.toString(),
    CURRENCY: currency
  };
}


function handleRateRes(carrier, accNumber, serCode, serName, disFrt, pubFrt, ETD, TDays, Cur, SHIP_POINT, SalesOrderDate) {
  const rateRes = {
    CARRIER: carrier,
    ACCOUNT_NUMBER: accNumber,
    SERVICE_CODE: serCode,
    SERVICE_NAME: serName,
    DISCOUNTED_FREIGHT: disFrt,
    PUBLISHED_FREIGHT: pubFrt,
    EXPECTED_DELIVERY_DATE: ETD,
    TRANSIT_DAYS: TDays,
    CURRENCY: Cur
  };
  // add only if available
  if (SHIP_POINT) rateRes.SHIP_POINT = SHIP_POINT;
  if (SalesOrderDate) rateRes.SALES_ORDER_DATE = SalesOrderDate;

  return rateRes;
}

function getsapchargecode(carrier, chargeCode, chargeCodes) {
  const found = chargeCodes.find(item =>
    item.details.carrier === carrier &&
    item.details.carrierchatgecode === chargeCode
  );

  return found ? found.details.sapchargecode : null;
}

function handleShipErrorRes(error) {
  let Errors = [];

  if (error.response) {
    const { data } = error.response;

    if (data?.response?.errors?.length) {
      data.response.errors.forEach((er) => {
        Errors.push(er.message);
      });
    } else if (data?.errors) {
      if (Array.isArray(data.errors) && data.errors.length > 0) {
        data.errors.forEach((er) => {
          er?.parameterList?.forEach((plist) => {
            if (plist.value)
              Errors.push(plist.value);
          });

          Errors.push(er.message + '-' + er?.code);
        });
      } else {
        Errors.push(data.errors?.message || data.errors?.Message);
      }
    } else if (data?.Errors) {
      if (Array.isArray(data.Errors) && data.Errors.length > 0) {
        data.Errors.forEach((er) => {
          Errors.push(er.message || er.ErrorMessage);
        });
      } else {
        Errors.push(data.Errors?.message || data.Errors?.ErrorMessage);
      }
    } else if (data?.error?.information) {
      data.error.information.forEach((er) => {
        Errors.push(er.message || er.ErrorMessage
        );
      });
    } else {
      Errors.push(data
      );
    }
  } else if (error.message) {
    Errors.push(error.message
    );
  }
  else if (error.errors) {
    error.errors.forEach((er) => {
      Errors.push(er.message);
      if (er.parameterList) {
        er.parameterList.forEach((suber) => {
          if (suber.value)
            Errors.push(suber.value);
        });
      }

    });
  }
  else {
    Errors.push(String(error));
  }

  return Errors

}
const formatPhoneTo10Digits = (phone) => {
  if (!phone) return '';
  const digitsOnly = phone.replace(/\D/g, '');
  const paddedPhone = digitsOnly.padStart(10, '0');
  return paddedPhone;
};
async function mapCarrierCredentials(CarrierCredentialsData, carrier, account, ServiceName) {
  const found = CarrierCredentialsData.find(item =>
    item.details.CarrierName === carrier
  ); //&& item.details.Account === account  * Need to add

  return found ? {
    Carrier: found.details.CarrierName,
    ServiceName: ServiceName, //"FEDEX_GROUND",
    PaymentType: "Sender",
    SHIPPING_ACCOUNT: found.details.Account, //"740561073",
    USERID: found.details.USERID,  //"l7e48144d986db4a25a418bcb9a186383e",
    PASSWORD: found.details.PASSWORD,  //"d73181e3e6044eba83160516b0e8d987"
    LabelType: found.details?.LabelType || "PDF"
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

function parseEDI214(filePath) {
  try {
    // Read EDI 214 File
    const ediContent = fs.readFileSync(filePath, 'utf8');

    // Initialize EDI Parser
    const parser = new X12Parser(true);
    const interchange = parser.parse(ediContent);

    // Extract AT7 (Shipment Status Details) segments
    let milestones = [];
    interchange.functionalGroups.forEach(group => {
      group.transactions.forEach(transaction => {
        transaction.segments.forEach(segment => {
          let obj = {};
          // if (segment.tag === 'AT7') {

          //         eventCode: segment.elements[0],  // AT7-01 - Shipment Status Code
          //         eventDate: segment.elements[3],  // AT7-04 - Date (YYYYMMDD)
          //         eventTime: segment.elements[4],  // AT7-05 - Time (HHMM)
          //         timeZone: segment.elements[5],   // AT7-06 - Time Zone

          // }
          milestones.push(obj);
        });
      });
    });

    return milestones;
  } catch (error) {
    console.error("Error parsing EDI file:", error);
    return [];
  }
}
function validatePhNo(phone) {
  const DEFAULT_PHONE = '9999999999';
  if (!phone) return DEFAULT_PHONE;
  let cleaned = String(phone).toLowerCase();
  cleaned = cleaned.split(/ext|x|extension/)[0];
  let digits = cleaned.replace(/\D/g, '');
  if (digits.length > 10) { digits = digits.slice(-10); }
  if (digits.length !== 10) { return DEFAULT_PHONE; }
  return digits;
}
module.exports = { validatePhNo, formatPhoneTo10Digits, mapCarrierCredentials, getsapchargecode, handleShipErrorRes, handlesurCharRes, ShipRateRes, ShipSurRateRes, handleErrorRes, handleRateRes, escapeXml, parseAndCleanXML, LogfileSavexml, formatShipDocSap, formatShipDoc, LogfileSave, getOrDefault, isValid, isTrue, saveBase64ToPNG, Rotatebase64Data, removeDollarSigns, removeNamespacePrefix, getCountry3, addTransitDays, pdfURLToBase64 }
