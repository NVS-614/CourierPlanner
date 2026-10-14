

//Tips
//Choose the library based on your needs:
//Use pdfkit for creating PDFs from scratch.
//Use puppeteer if you need to convert HTML/CSS layouts into PDF.
//Use pdf-lib for modifying existing PDFs or creating them programmatically.

const PDFDocument = require('pdfkit');
//const { PDFDocument, rgb, StandardFonts } = require('pdf-lib');
const Jimp = require('jimp');

const QRCode = require('qrcode');
const JsBarcode = require('jsbarcode');
const getStream = require('get-stream');
const fs = require('fs');

const reuse = require('../Reuse/utilityfunctions.js');
const moment = require('moment');
const puppeteer = require('puppeteer');
const { Readable } = require('stream');

const dotenv = require('dotenv');
// Load environment variables from .env file
dotenv.config();


async function preparelabel_pngformatJimp(data) {
    const generatePNG = async () => {
        const labelWidth = 800;
        const labelHeight = 1200;
        const margin = 10;

        const pngDocuments = [];

        for (let index = 0; index < data.PACKAGES.length; index++) {
            const pkg = data.PACKAGES[index];

            // Create image with Jimp instead of canvas
            const image = new Jimp(labelWidth, labelHeight, 0xFFFFFFFF); // White background

            // Load fonts (you may need to install Jimp fonts or use default)
            const fontLarge = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);
            const fontMedium = await Jimp.loadFont(Jimp.FONT_SANS_26_BLACK);
            const fontSmall = await Jimp.loadFont(Jimp.FONT_SANS_22_BLACK);
            const fontBold = await Jimp.loadFont(Jimp.FONT_SANS_32_BLACK);

            let y = 40;
            const gap = 35;
            const gap2 = 30;

            // SHIP FROM
            image.print(fontBold, 20, y, "SHIP FROM:");
            image.print(fontBold, 490, y, data.CARRIER_DETAILS.CARRIER);

            y += gap;

            // Draw line
            for (let i = 470; i <= 790; i++) {
                for (let j = y - 2; j <= y + 2; j++) {
                    image.setPixelColor(0x000000FF, i, j); // Black line
                }
            }

            image.print(fontMedium, 50, y, data.SHIPPER.CONTACT);
            y += gap;
            image.print(fontMedium, 50, y, data.SHIPPER.COMPANY);
            y += gap;
            image.print(fontMedium, 50, y, data.SHIPPER.ADDRESS_LINE1);
            y += gap;

            if (data.SHIPPER.ADDRESS_LINE2) {
                image.print(fontMedium, 50, y, data.SHIPPER.ADDRESS_LINE2);
                y += gap;
            }

            const shipperAddress = `${data.SHIPPER.CITY}, ${data.SHIPPER.STATE} ${data.SHIPPER.ZIPCODE} ${data.SHIPTO.COUNTRY}`;
            image.print(fontMedium, 50, y, shipperAddress);

            const formattedDate = require('moment')(data.HEADER_INFO.SHIP_DATE).format('MM/DD/YYYY');
            image.print(fontSmall, 500, y - 70, `Ship Date: ${formattedDate}`);
            image.print(fontSmall, 500, y - 40, `Weight: ${pkg.WEIGHT} ${pkg.WEIGHT_UNITS}`);
            image.print(fontSmall, 500, y - 10, `Dims: ${pkg.DIMENSION} ${pkg.DIMENSION_UNITS}`);

            y += gap2;

            // Draw vertical and horizontal lines
            for (let i = 10; i <= 470; i++) {
                for (let j = y - 2; j <= y + 2; j++) {
                    image.setPixelColor(0x000000FF, i, j);
                }
            }
            for (let j = 10; j <= y; j++) {
                for (let i = 470 - 2; i <= 470 + 2; i++) {
                    image.setPixelColor(0x000000FF, i, j);
                }
            }

            y += gap2;

            // SHIP TO
            image.print(fontBold, 20, y, 'SHIP TO:');
            y += gap;

            image.print(fontMedium, 50, y, data.SHIPTO.CONTACT);
            image.print(fontBold, 640, y, `${index + 1} of ${data.PACKAGES.length}`);

            y += gap;
            image.print(fontMedium, 50, y, data.SHIPTO.COMPANY);
            y += gap;
            image.print(fontMedium, 50, y, data.SHIPTO.ADDRESS_LINE1);
            y += gap;

            if (data.SHIPTO.ADDRESS_LINE2) {
                image.print(fontMedium, 50, y, data.SHIPTO.ADDRESS_LINE2);
                y += gap;
            }

            const shipToAddress = `${data.SHIPTO.CITY}, ${data.SHIPTO.STATE} ${data.SHIPTO.ZIPCODE} ${data.SHIPTO.COUNTRY}`;
            image.print(fontMedium, 50, y, shipToAddress);
            y += gap;

            image.print(fontSmall, 50, y, `Phone: ${data.SHIPTO.PHONE}`);
            y += 20;

            // Service Label Box - Draw black rectangle
            for (let i = 10; i <= 790; i++) {
                for (let j = y; j <= y + 100; j++) {
                    image.setPixelColor(0x000000FF, i, j);
                }
            }

            // White inner rectangle
            for (let i = 15; i <= 785; i++) {
                for (let j = y + 10; j <= y + 90; j++) {
                    image.setPixelColor(0xFFFFFFFF, i, j);
                }
            }

            y += 60;
            image.print(fontBold, 60, y, data.CARRIER_DETAILS?.SERVICE_CODE);
            y += 70;

            // For barcodes with JsBarcode, you'll need to generate them differently
            // Since we removed canvas, you might need to use a different barcode approach
            // or generate barcodes as separate images and composite them

            // Simple text barcode as fallback
            const barcodeText = `|| ${pkg.TrackingNumber} ||`;
            image.print(fontMedium, 200, y, barcodeText);
            y += 185;

            const trackProText = `Track/Pro # ${pkg.TrackingNumber}`;
            image.print(fontMedium, 250, y, trackProText);
            y += gap2;

            // Footer Line
            for (let i = 10; i <= 790; i++) {
                for (let j = y - 2; j <= y + 2; j++) {
                    image.setPixelColor(0x000000FF, i, j);
                }
            }
            y += gap2;

            // Footer Info
            image.print(fontMedium, 30, y, `HU # ${pkg?.HU || ''}`); y += 40;
            image.print(fontMedium, 30, y, `Reference # ${data.CARRIER_DETAILS.REFERENCE1}`); y += 40;
            image.print(fontMedium, 30, y, `PO # ${data.CARRIER_DETAILS.REFERENCE2}`); y += 20;

            // Secondary barcode
            const barcodeText2 = `|| ${pkg.TrackingNumber} ||`;
            image.print(fontMedium, 200, y, barcodeText2);
            y += 165;

            const deliveryText = `Delivery # ${data.HEADER_INFO.DOCUMENT_NUMBER}`;
            image.print(fontMedium, 300, y, deliveryText);

            // Convert to buffer
            const buffer = await image.getBufferAsync(Jimp.MIME_PNG);
            const fileName = `${pkg.TrackingNumber}_${index}.png`;
            fs.writeFileSync(`./Labels/${fileName}`, buffer);
            pngDocuments.push({
                docProvider: 'Generic',
                contentType: "Label",
                copiesToPrint: 1,
                docName: `${process.env.AWS_URL}${fileName}`,
                encodedLabel: '',
                docType: 'PNG',
            });

            // try {
            //   //  await reuse.uploadbufferFile(buffer, fileName);
            //     console.log(`File accessible at: ${process.env.AWS_URL}${fileName}`);
            // } catch (err) {
            //     console.error("Error uploading file:", err);
            // }
        }

        return pngDocuments;
    };

    const documents = await generatePNG();
    return documents;
}


function generateZPL(shipment) {
    const itemsPerLabel = 7;
    const lineSpacing = 40;
    const labelHeightStart = 640;
    const labelWidth = 800;
    // Helper function to split array into chunks
    function chunkArray(arr, size) {
        const chunks = [];
        for (let i = 0; i < arr.length; i += size) {
            chunks.push(arr.slice(i, i + size));
        }
        return chunks;
    }

    const chunks = chunkArray(shipment.PACKAGES[0].ItemsInfo, itemsPerLabel);
    let fullZPL = '';

    chunks.forEach((chunk, labelIndex) => {
        let zpl = `^XA\n`;
        zpl += `^CI28\n`;
        zpl += `^PW800\n`;
        zpl += `^LL1200\n`;

        // Static Header
        zpl += `^FO20,30^A@N,30,16^FDShip To:^FS\n`;
        zpl += `^FO20,100^A0N,30,32^FD${shipment?.SHIPTO?.COMPANY || ''}^FS\n`;
        zpl += `^FO20,140^A0N,30,32^FD${this.shipment?.SHIPTO?.ADDRESS_LINE1} ${this.shipment?.SHIPTO?.ADDRESS_LINE2 || ''}^FS\n`;
        zpl += `^FO20,180^A0N,30,32^FD${this.shipment?.SHIPTO?.CITY} ${this.shipment?.SHIPTO?.STATE} ${this.shipment?.SHIPTO?.ZIPCODE}^FS\n`;
        zpl += `^A0,26,26^FO350,240^A0N,24,24^FD1 of 1^FS\n`;

        zpl += `^FO5,290^GB800,3,3^FS\n`;
        zpl += `^FO470,5^GB2,290,3^FS\n`;


        zpl += `^FO500,30^A@N,30,12^FDDate:^FS\n`;
        zpl += `^FO500,65^A0N,25,25^FD${this.shipment?.HEADER_INFO?.ShipmentDate || '03.06.2025'}^FS\n`;
        zpl += `^FO500,100^A@N,30,12^FDDelivery/Shipment:^FS\n`;
        zpl += `^FO500,135^A0N,25,25^FD${this.shipment?.HEADER_INFO?.DocumentNumber}^FS\n`;
        zpl += `^FO500,170^A@N,30,12^FDPurchase Order:^FS\n`;
        zpl += `^FO500,205^A0N,25,25^FD${this.shipment?.CARRIER_DETAILS?.PurchaseOrder || 'Eship1180'}^FS\n`;


        const docbarcodeW = barcodeWidth(shipment.PACKAGES[0]?.HU, 4); // BY2
        const docbarcodeX = centerX(docbarcodeW, labelWidth);

        const text = `HU #: ${shipment.PACKAGES[0]?.HU}`;
        const textBlockWidth = text.length * 9; // 9 is approx char width at 26pt
        const textX = centerX(textBlockWidth, labelWidth);

        zpl += `^FO${docbarcodeX},350^BY4^BCN,120,N,N,N^FD${shipment.PACKAGES[0]?.HU}^FS\n`;
        zpl += `^A@N,26,15^FO${textX},480^FDHU #: ${shipment.PACKAGES[0]?.HU}^FS\n`;
        zpl += `^FO5,550^GB800,3,3^FS\n`;

        zpl += `^FO20,1050^A0N,35,35^FDGross Weight^FS\n`;
        zpl += `^FO350,1050^A0N,35,35^FD${shipment.PACKAGES[0]?.Weight || '41,470'} LB^FS\n`;
        zpl += `^FO20,1100^A0N,35,35^FDTot. No. Of Pallets^FS\n`;
        zpl += `^FO350,1100^A0N,35,35^FD${this.shipment?.Packages?.length || '1'}^FS\n`;
        zpl += `^FO550,1100^A0N,35,35^${chunk[0]?.packageMaterial || 'FDMIXED PALLET'}^FS\n`;

        // Table Headers
        zpl += `^FO20,600^A0N,35,35^FDMATERIAL^FS\n`;
        zpl += `^FO400,600^A0N,35,35^FDQTY^FS\n`;
        zpl += `^FO600,600^A0N,35,35^FDUOM^FS\n`;

        // Table rows for this label
        chunk.forEach((item, i) => {
            const y = labelHeightStart + i * lineSpacing;

            zpl += `^FO20,${y}^A@N,26,15^FD${item.product || ''}^FS\n`;
            zpl += `^FO400,${y}^A0N,35,35^FD${item.QUANTITY || ''}^FS\n`;
            zpl += `^FO600,${y}^A0N,35,35^FD${item.UOM || ''}^FS\n`;
        });



        zpl += `^XZ\n`; // End of label
        fullZPL += zpl;  // Append this label to final string
    });

    return fullZPL;
}

function centerX(contentWidth, labelWidth = 800) {
    return Math.floor((labelWidth - contentWidth) / 2);
}

function barcodeWidth(data, moduleWidth = 3) {
    const numberOfCharacters = data.toString().length;
    return (11 * numberOfCharacters + 35) * moduleWidth;
}
function formatPhoneNumber(phoneNumber) {
    // Remove all non-digit characters
    const cleaned = ('' + phoneNumber).replace(/\D/g, '');

    // Check if the number has 10 digits (US format)
    if (cleaned.length === 10) {
        return cleaned.replace(/(\d{3})(\d{3})(\d{4})/, '($1) $2-$3');
    }

    // Return original if not a standard US number
    return phoneNumber;
}
async function preparelabel_ZPL(data) {
    const ZPL = async () => {
        const reqpayload = data;
        const shipper = reqpayload.SHIPPER
        const shipTo = reqpayload.SHIPTO
        const carrier = reqpayload.CARRIER_DETAILS;
        const header = reqpayload.HEADER_INFO;

        const formatDate = (dateStr) => {
            const date = new Date(dateStr);
            return `${(date.getMonth() + 1).toString().padStart(2, "0")}/${date
                .getDate()
                .toString()
                .padStart(2, "0")}/${date.getFullYear()}`;
        };

        let pngdocuments = [];
        let CarrierName = ''
        let ServiceName = ''
        const erpCarrierID = carrier?.ERPCarrierID
        if (['ZY', 'Z3'].includes(erpCarrierID)) {
            CarrierName = carrier?.ServiceNameMapping
            ServiceName = carrier?.ServiceNameMapping
        } else {
            CarrierName = carrier.Carrier
            ServiceName = carrier.ServiceName
        }

        for (let index = 0; index < reqpayload.PACKAGES.length; index++) {
            const element = reqpayload.Packages[index];
            let y = 25;
            const ygap = 35;
            const labelWidth = 800; // Total label width in dots
            let zplLines = [];

            // Header & Borders
            zplLines.push(
                `^XA`,
                //   '^FO10,10^GB780,1170,2^FS',
                '^FO10,10^GB780,2,2^FS\n^FO450,80',
                `^PW800`,
                `^LL1600`,
                `^CI28`,
                '^LT20',
                `^FO20,${y}^A0N,34,34^FDSHIP FROM:^FS`
            );
            const carrierName = CarrierName.length > 27
                ? CarrierName.slice(0, 27)
                : CarrierName;

            zplLines.push(`^FO415,${y + 10}^A0N,34,34^FD${carrierName}^FS`);
            y += ygap + 15;

            //  zplLines.push(`^CFj,29,25`);

            //^CFA,20

            //  const fromfontsize = '^AdN,0,0'
            //   const fontsize = '^AdN,0,0'

            // const fromfontsize = '^A@N,20,10'
            //  const fontsize = '^A@N,25,15'

            const fromfontsize = '^A0N,25,25'
            const fontsize = '^A0N,25,25'
            const barcodefontsize = '^A0N,40,40'
            const delfontsize = '^A0N,30,30'

            zplLines.push(`${fromfontsize}^FO40,${y}^FD${shipper.CONTACT}^FS`);
            y += ygap;
            zplLines.push(`${fromfontsize}^FO40,${y}^FD${shipper.COMPANY}^FS`);
            y += ygap;
            zplLines.push(`${fromfontsize}^FO40,${y}^FD${shipper.ADDRESS_LINE1}^FS`);
            y += ygap;
            if (shipper.ADDRESS_LINE2) {
                zplLines.push(`${fromfontsize}^FO40,${y}^FD${shipper.ADDRESS_LINE2}^FS`);
                y += ygap;
            }
            zplLines.push(
                `${fromfontsize}^FO40,${y}^FD${shipper.CITY}, ${shipper.STATE} ${shipper.ZIPCODE} ${shipper.COUNTRY}^FS`
            );

            // Right side info
            zplLines.push(`${fromfontsize}^FO430,110^FDShip Date: ${formatDate(header.ShipDate)}^FS`);
            zplLines.push(`${fromfontsize}^FO430,145^FDWeight: ${element.WEIGHT} ${element.WEIGHT_UNITS}^FS`);
            zplLines.push(`${fromfontsize}^FO430,180^FDDims: ${element.DIMENSION} ${element.DIMENSIONUnits}^FS`);

            // Dividers
            zplLines.push(`^FO10,253^GB780,2,2^FS`);
            zplLines.push(`^FO400,80^GB390,2,2^FS`);
            zplLines.push(`^FO400,10^GB2,245,2^FS`);

            // Ship To Section
            y = 270;
            zplLines.push(`^FO20,${y}^A0N,34,34^FDSHIP TO:^FS`);
            y += ygap + 15;

            //zplLines.push(`^^CFj,30,25`);
            zplLines.push(`${fontsize}^FO50,${y}^FD${shipTo.CONTACT}^FS`);
            // zplLines.push(`${fontsize}^FO640,300^A0N,24,24^FD${index + 1} of ${reqpayload.PACKAGES.length}^FS`);
            y += ygap;
            zplLines.push(`${fontsize}^FO50,${y}^FD${shipTo.COMPANY}^FS`);
            y += ygap;
            zplLines.push(`${fontsize}^FO50,${y}^FD${shipTo.ADDRESS_LINE1}^FS`);
            y += ygap;
            if (shipTo.ADDRESS_LINE2) {
                zplLines.push(`${fontsize}^FO50,${y}^FD${shipTo.ADDRESS_LINE2}^FS`);
                y += ygap;
            }
            zplLines.push(
                `${fontsize}^FO50,${y}^FD${shipTo.CITY}, ${shipTo.STATE} ${shipTo.ZIPCODE} ${shipTo.COUNTRY}^FS`
            );
            y += ygap;
            const phone = formatPhoneNumber(shipTo.PHONE)
            zplLines.push(`${fontsize}^FO50,${y}^FDPhone: ${phone}^FS`);

            // Carrier Service Box
            y += 50;

            zplLines.push(`^FO10,${y}^GB780,2,2^FS`);
            // zplLines.push(`^FO40,${y}^A0N,70,75^FD${carrier.ServiceName}^FS`); y += (ygap + 45);
            //zplLines.push(`^FO10,${y}^GB780,8,8^FS`);
            // Tracking & Barcode
            y += (40);

            const trckbarcodeW = barcodeWidth(element.TRACKING_NUMBER, 3); // BY2
            const trckbarcodeX = centerX(trckbarcodeW, labelWidth);

            const trcktext = `Track/Pro # ${element.TRACKING_NUMBER}`;
            const trcktextBlockWidth = trcktext.length * 18; // 9 is approx char width at 26pt
            const trcktextX = centerX(trcktextBlockWidth, labelWidth);

            zplLines.push(`^FO${trckbarcodeX},${y}^BY3^BCN,140,N,N,N^FD${element.TRACKING_NUMBER}^FS`);
            y += 155;
            zplLines.push(`${barcodefontsize}^FO${trcktextX},${y}^FDTrack/Pro # ${element.TRACKING_NUMBER}^FS`); y += 60;

            zplLines.push(`^FO10,${y}^GB780,2,2^FS`);


            // References
            y += 25;
            zplLines.push(`${fontsize}^FO20,${y}^FDHU #: ${element.HU}^FS`); y += ygap;
            zplLines.push(`${fontsize}^FO20,${y}^FDReference #: ${carrier.REFERENCE1 || ""}^FS`); y += ygap;
            zplLines.push(`${fontsize}^FO20,${y}^FDPO #: ${carrier.Reference2 || ""}^FS`);

            // Bottom Barcode & Doc Info
            const docbarcodeW = barcodeWidth(header.DocumentNumber, 3); // BY2
            const docbarcodeX = centerX(docbarcodeW, labelWidth);

            const text = `Delivery #: ${header.DocumentNumber}`;
            const textBlockWidth = text.length * 11; // 9 is approx char width at 26pt
            const textX = centerX(textBlockWidth, labelWidth);
            y += 40;
            zplLines.push(`^FO${docbarcodeX},${y}^BY3^BCN,130,N,N,N^FD${header.DocumentNumber}^FS`);

            y += 140;
            zplLines.push(`${delfontsize}^FO${textX},${y}^FDDelivery #: ${header.DocumentNumber}^FS`);
            y += 50;
            zplLines.push(`^FO10,${y}^GB780,6,6^FS`);
            y += 45;
            //zplLines.push(`^FO280,${y}^A0N,200,200^FD${index + 1}/${reqpayload.PACKAGES.length}^FS`);
            const ServiceNametext = ServiceName;
            const ServiceNametextBlockWidth = ServiceNametext.length * 65; // 9 is approx char width at 26pt
            const ServiceNametextX = centerX(ServiceNametextBlockWidth, labelWidth);

            zplLines.push(`^FO${ServiceNametextX},${y}^A0N,140,120^FD${ServiceName}^FS`); y += (ygap + 120);
            zplLines.push(`^FO10,${y}^GB780,6,6^FS`);
            y += 50;
            const ind = index + 1;
            const total = reqpayload.PACKAGES.length;
            if (ind < 10 && total < 10) {
                // Case 1: 1 of 9
                zplLines.push(`^FO170,${y}^A0N,250,250^FD${ind}^FS`);
                zplLines.push(`^FO310,${y}^A0N,220,220^FDof^FS`);
                zplLines.push(`^FO510,${y}^A0N,250,250^FD${total}^FS`);
            } else if (ind < 10 && total >= 10) {
                // Case 2: 9 of 13
                zplLines.push(`^FO100,${y}^A0N,250,250^FD${ind}^FS`);
                zplLines.push(`^FO250,${y}^A0N,220,220^FDof^FS`);
                zplLines.push(`^FO460,${y}^A0N,250,250^FD${total}^FS`);
            } else {
                // Case 3: 10 of 13
                zplLines.push(`^FO40,${y}^A0N,250,250^FD${ind}^FS`);
                zplLines.push(`^FO310,${y}^A0N,220,220^FDof^FS`);
                zplLines.push(`^FO510,${y}^A0N,250,250^FD${total}^FS`);
            }
            // zplLines.push(`^FO170,${y}^A0N,250,250^FD${index + 1}^FS`);
            // zplLines.push(`^FO310,${y}^A0N,220,220^FDof^FS`);
            // zplLines.push(`^FO510,${y}^A0N,250,250^FD${reqpayload.PACKAGES.length}^FS`);
            zplLines.push(`^XZ`);

            const zpl = zplLines.join("\n");

            const filename = `${element.TRACKING_NUMBER}_${index}.txt`;
            // fs.writeFileSync('./Labels/' + filename, zpl);
            const zplStream = Readable.from([zpl]);

            const document = {
                docProvider: 'Generic',
                contentType: "Label",
                copiesToPrint: 1,
                docName: process.env.AWS_URL + filename,
                encodedLabel: zpl,
                docType: 'ZPL',
            };

            pngdocuments.push(document);

            // try {
            //     await reuse.uploadbufferFile(zplStream, filename);
            // } catch (error) {
            //     console.error('Upload error:', error.message);
            // }
        }

        return pngdocuments;
    };

    return await ZPL();
}



async function preparelabel_pdfkit(data) {
    const documents = [];

    for (const element of data.PACKAGES) {
        const doc = new PDFDocument({
            size: [800, 1200], // 4x6 inch label in points
            margins: { top: 5, bottom: 5, left: 5, right: 5 }
        });

        const chunks = [];
        doc.on('data', chunks.push.bind(chunks));

        await new Promise((resolve) => {
            doc.on('end', resolve);

            // Draw border
            doc.rect(5, 5, 790, 1190).stroke();

            let y = 40;
            const gap = 32;
            const gap2 = 30;
            const gap3 = 55;

            // SHIP FROM Section
            doc.fontSize(28).font('Helvetica-Bold')
                .text("SHIP FROM", 20, y);

            if (data.CARRIER_DETAILS.CARRIER.toUpperCase() === 'OTHER') {
                doc.text(data.CARRIER_DETAILS?.SERVICE_CODE, 380, y + 10);
            } else {
                doc.text(data.CARRIER_DETAILS.CARRIER, 380, y + 10);
            }

            y += gap;

            doc.fontSize(22).font('Helvetica')
                .text(data.SHIPPER.CONTACT, 20, y);
            y += gap;
            doc.text(data.SHIPPER.COMPANY, 20, y);
            y += gap;
            doc.text(data.SHIPPER.ADDRESS_LINE1, 20, y);
            y += gap;

            if (data.SHIPPER.ADDRESS_LINE2) {
                doc.text(data.SHIPPER.ADDRESS_LINE2, 20, y);
                y += gap;
            }

            y += gap;
            doc.fontSize(20);
            const formattedDate = require('moment')(data.HEADER_INFO.SHIP_DATE).format('MM/DD/YYYY hh:mm:ss A');
            doc.text('Ship Date: ' + formattedDate, 460, y - 15);
            doc.text(data.SHIPPER.CITY + ", " + data.SHIPPER.STATE + " " + data.SHIPPER.ZIPCODE + " " + data.SHIPTO.COUNTRY, 20, y);
            doc.text('Weight: ' + element.WEIGHT + ' ' + element.WEIGHT_UNITS, 460, y + 15);
            y += gap2 + gap3;

            // SHIP TO Section
            doc.fontSize(28).font('Helvetica-Bold')
                .text('SHIP TO', 20, y);
            y += gap;
            doc.fontSize(22).font('Helvetica')
                .text(data.SHIPTO.CONTACT, 20, y);
            y += gap;
            doc.text(data.SHIPTO.COMPANY, 20, y);
            y += gap;
            doc.text(data.SHIPTO.ADDRESS_LINE1, 20, y);
            y += gap;

            if (data.SHIPTO.ADDRESS_LINE2) {
                doc.text(data.SHIPTO.ADDRESS_LINE2, 20, y);
                y += gap;
            }

            doc.text(data.SHIPTO.CITY + "," + data.SHIPTO.STATE + " " + data.SHIPTO.ZIPCODE + " " + data.SHIPTO.COUNTRY, 20, y);
            y += gap;
            doc.fontSize(22).font('Helvetica-Bold')
                .text("Phone:" + data.SHIPTO.PHONE, 20, y);
            y += 20;

            // Service Name in black box
            doc.rect(5, y, 790, 170).fillAndStroke('black', 'black');
            doc.rect(10, y + 25, 730, 125).fillAndStroke('white', 'white');

            doc.fillColor('black').fontSize(38)
                .text(data.CARRIER_DETAILS?.SERVICE_CODE, 70, y + 100);
            y += gap3 + 155;

            // Tracking Number
            doc.fontSize(40).fillColor('black')
                .text('TRACKING # ' + element.TRACKING_NUMBER, 90, y + 20);
            y += gap3;

            // Blue Line
            doc.strokeColor('steelblue').lineWidth(4)
                .moveTo(5, y).lineTo(795, y).stroke();
            y += 40;

            doc.fontSize(22).text(element.TRACKING_NUMBER, 300, y);
            y += 15;

            // Barcode using jsbarcode (lightweight)
            // Note: You'll need to adapt jsbarcode to work with PDFKit
            // This might require creating a canvas and converting to image

            // QR Code using qrcode (lightweight)
            // try {
            //     const qrDataUrl = await QRCode.toDataURL(element.TRACKING_NUMBER, { width: 180 });
            //     // Convert data URL to buffer and add to PDF
            //     // You'll need to handle this conversion for PDFKit
            // } catch (error) {
            //     console.error('QR Code generation failed:', error);
            // }

            y += 200;

            // Footer Section
            doc.rect(5, y, 790, 20).fill('black');
            y += gap3;

            doc.fontSize(28).fillColor('black')
                .text("Ship Request # " + data.HEADER_INFO.DOCUMENT_NUMBER, 20, y);
            y += 45;
            doc.text("Reference # " + data.CARRIER_DETAILS.REFERENCE1, 20, y);

            doc.end();
        });

        const pdfBuffer = Buffer.concat(chunks);

        const document = {
            docProvider: 'Generic',
            contentType: "Label",
            copiesToPrint: 1,
            docName: `${element.TRACKING_NUMBER}.pdf`,
            encodedLabel: pdfBuffer.toString('base64'),
            docType: 'PDF',
        };
        documents.push(document);

        // Upload to storage
        // try {
        //     await reuse.uploadbufferFile(pdfBuffer, `${element.TRACKING_NUMBER}.pdf`);
        // } catch (error) {
        //     console.error("Error uploading file:", error);
        // }
    }

    return documents;
}









module.exports = { generateZPL, preparelabel_ZPL, preparelabel_pngformatJimp, preparelabel_pdfkit, preparelabel_pdfkit, preparelabel_pdfkit }
