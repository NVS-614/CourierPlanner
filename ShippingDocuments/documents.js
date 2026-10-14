//const PDFDocument = require("pdfkit-table");
const PDFDocument = require("pdfkit");  // ← Change from pdfkit-table to pdfkit
const JsBarcode = require('jsbarcode');
const getStream = require('get-stream');
const bwipjs = require('bwip-js');
const sharp = require('sharp');
const fs = require('fs');
const { count } = require("console");
const Jimp = require('jimp');
const reuse = require('../Reuse/utilityfunctions.js');
const moment = require('moment');
const { Readable } = require('stream');
const puppeteer = require('puppeteer');


async function preparePackingSlip_pdfkit(reqpayload, HEADER_INFO, PACKAGES) {

    const doc = new PDFDocument({ margin: 10, size: 'A4' });
    const stream = getStream.buffer(doc);

    const font = 10;
    const gap = 13;

    const safe = (v) => v || '';

    const formatAddress = (obj) => {
        return [
            obj?.ADDRESS_LINE1,
            obj?.ADDRESS_LINE2,
            obj?.ADDRESS_LINE3,
            obj?.CITY,
            obj?.STATE,
            obj?.ZIPCODE,
            obj?.COUNTRY
        ].filter(Boolean).join(', ');
    };

    // ---------------- HEADER ----------------
    doc.rect(10, 10, 570, 70).stroke();
    doc.font('Helvetica-Bold').fontSize(16)
        .text("PACKING SLIP", 230, 35);

    // ---------------- MAIN BOX ----------------
    doc.rect(10, 90, 570, 300).stroke();

    // ---------------- SHIP FROM ----------------
    let x = 25;
    let y = 120;

    doc.font('Helvetica-Bold').fontSize(13)
        .text('Ship From Address', 15, 95);

    doc.moveTo(10, 110).lineTo(295, 110).stroke();

    doc.font('Helvetica').fontSize(font);

    doc.text(safe(reqpayload.SHIPPER?.COMPANY), x, y); y += gap;
    doc.text(safe(reqpayload.SHIPPER?.CONTACT), x, y); y += gap;
    doc.text(formatAddress(reqpayload.SHIPPER), x, y); y += gap;
    doc.text("Phone: " + safe(reqpayload.SHIPPER?.PHONE), x, y);

    y += gap;
    doc.moveTo(10, y).lineTo(295, y).stroke();

    // ---------------- SHIPMENT DETAILS ----------------
    let rightY = 120;
    const rightXLabel = 305;
    const rightXVal = 420;

    doc.font('Helvetica-Bold').fontSize(13)
        .text('Shipment Details', 305, 95);

    doc.moveTo(295, 110).lineTo(580, 110).stroke();

    const drawField = (label, value) => {
        doc.font('Helvetica').fontSize(font);
        doc.text(label, rightXLabel, rightY);
        doc.text(': ' + safe(value), rightXVal, rightY);
        rightY += 18;
    };

    drawField("Ship Date", HEADER_INFO?.SHIP_DATE);
    drawField("Carrier", reqpayload.CARRIER_DETAILS?.CARRIER);
    drawField("Service", reqpayload.CARRIER_DETAILS?.SERVICE_CODE);
    drawField("Tracking #", HEADER_INFO?.MASTER_TRACKING_NUMBER);
    drawField("Delivery #", HEADER_INFO?.DOCUMENT_NUMBER);
    drawField("Reference1", HEADER_INFO?.PO_NUMBER);
    drawField("Reference2", HEADER_INFO?.CUSTOMER_REFERENCE);
    drawField("No. of Packages", reqpayload.PACKAGES?.length);

    // Total Items
    let totalQty = 0;
    (reqpayload.PACKAGES || []).forEach(p => {
        (p.ItemsInfo || []).forEach(i => {
            totalQty += Number(i.QUANTITY || 0);
        });
    });

    drawField("Total Items", totalQty);

    // ---------------- SHIP TO ----------------
    y += 10;

    doc.font('Helvetica-Bold').fontSize(13)
        .text('Ship To Address', 15, y);

    y += 15;
    doc.moveTo(10, y).lineTo(295, y).stroke();

    y += gap;

    doc.font('Helvetica').fontSize(font);
    doc.text(safe(reqpayload.SHIPTO?.COMPANY), x, y); y += gap;
    doc.text(safe(reqpayload.SHIPTO?.CONTACT), x, y); y += gap;
    doc.text(formatAddress(reqpayload.SHIPTO), x, y); y += gap;
    doc.text("Phone: " + safe(reqpayload.SHIPTO?.PHONE), x, y);

    y += gap;
    doc.moveTo(10, y).lineTo(295, y).stroke();

    // ---------------- BILLING ----------------
    y += 10;

    doc.font('Helvetica-Bold').fontSize(13)
        .text('Billing Address', 15, y);

    y += 15;
    doc.moveTo(10, y).lineTo(295, y).stroke();

    y += gap;

    const billTo =
        reqpayload.CARRIER_DETAILS?.PAYMENT_TYPE?.toUpperCase() === 'SENDER'
            ? reqpayload.SHIPPER
            : reqpayload.SHIPTO;

    doc.font('Helvetica').fontSize(font);
    doc.text(safe(billTo?.COMPANY), x, y); y += gap;
    doc.text(safe(billTo?.CONTACT), x, y); y += gap;
    doc.text(formatAddress(billTo), x, y); y += gap;
    doc.text("Phone: " + safe(billTo?.PHONE), x, y);

    doc.moveTo(295, 90).lineTo(295, 390).stroke();

    // ---------------- TABLE ----------------
    function drawTable(startY, items) {
        let y = startY;

        const colX = {
            sno: 15,
            product: 60,
            desc: 200,
            qty: 500
        };

        // Header
        doc.font('Helvetica-Bold').fontSize(10);
        doc.text("#", colX.sno, y);
        doc.text("Product No", colX.product, y);
        doc.text("Description", colX.desc, y);
        doc.text("Qty", colX.qty, y);

        y += 15;
        doc.moveTo(10, y).lineTo(580, y).stroke();
        y += 10;
        doc.font('Helvetica').fontSize(10);

        items.forEach((item, index) => {

            doc.text(index + 1, colX.sno, y);
            doc.text(safe(item.PRODUCT_NO), colX.product, y);
            doc.text(safe(item.DESCRIPTION), colX.desc, y, { width: 280 });
            doc.text(safe(item.QUANTITY), colX.qty, y);

            y += 18;

            // Page break
            if (y > 700) {
                doc.addPage();
                y = 50;
            }
        });

        return y;
    }

    const items = reqpayload.INTERNATIONAL_DETAILS?.ITEM_INFO || [];
    const finalY = drawTable(410, items);

    // ---------------- FOOTER ----------------
    let footerY = finalY + 20;

    if (footerY > 700) {
        doc.addPage();
        footerY = 50;
    }

    doc.rect(10, footerY, 570, 90).stroke();

    doc.font('Helvetica-Bold').fontSize(12)
        .text("Shipping Notes", 15, footerY + 7);

    doc.moveTo(10, footerY + 25).lineTo(580, footerY + 25).stroke();

    doc.font('Helvetica').fontSize(10)
        .text(reqpayload.NOTES || '', 15, footerY + 35);

    // ---------------- FINALIZE ----------------
    const filePath = `./Labels/PL_${Date.now()}.pdf`;
    const fileStream = fs.createWriteStream(filePath);
    doc.pipe(fileStream);
    doc.end();
    await new Promise(resolve => fileStream.on('finish', resolve));
    const pdfBuffer = await stream;

    return {
        DOC_PROVIDER: 'GENERIC',
        CONTENT_TYPE: 'PL',
        COPIES_TO_PRINT: '1',
        DOC_NAME: `${HEADER_INFO?.MASTER_TRACKING_NUMBER}.PDF`,
        ENCODED_LABEL: pdfBuffer.toString("base64"),
        DOC_TYPE: 'PDF'
    };
}


async function preparePackingSlip_html(data, HEADER_INFO, PACKAGES) {
    const pdf = async () => {

        let Sname = '';
        let TrackingNo = HEADER_INFO?.MASTER_TRACKING_NUMBER;
        if (data?.CARRIER_DETAILS?.Carrier?.toUpperCase() === 'UPS') {
            Sname = Scodes.getUPSServiceName(data.CARRIER_DETAILS.ServiceName);
        } else {
            Sname = data?.CARRIER_DETAILS?.ServiceName || '';
        }


        let singleItemInfo = [];

        data.PACKAGES.forEach((pkg, index) => {

            if (pkg.ITEM_INFO && pkg.ITEM_INFO.length > 0) {
                singleItemInfo.push(...pkg.ITEM_INFO);
            } else {
                singleItemInfo.push({
                    ITEM_NO: pkg?.HU_NO,
                    SNO: pkg.SNO || "",
                    DESCRIPTION: pkg.DESCRIPTION,
                    ITEM_WEIGHT: pkg.WEIGHT,
                    ITEM_DIMENSION: pkg.DIMENSION,
                    LTL_CLASS: pkg.LTL_CLASS || "",
                    QUANTITY: pkg.QUANTITY || 1,
                    ITEM_PACKING_TYPE: pkg.PACKING_TYPE || ""
                });
            }

        });

        htmlcontentPSLIP = `
       <!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <title>Packing Slip</title>
    <style>
        body {
            font-family: Arial, sans-serif;
            font-size: 12px;
            margin: 20px;
        }
            
        .header {

         display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 20px;
     border-bottom: 2px solid #156082;
      padding-bottom: 10px;
        
        }
        .header img {
            max-width: 200px;
        }
        .header h1 {
            margin: 0;
            font-size: 20px;
            font-weight: bold;
        }
        .company-info {
            text-align: left;
            font-size: 12px;
            margin-bottom: 10px;
        }
        .line {
            border-top: 2px solid black;
            margin: 10px 0;
        }
       .details {
    display: flex;  /* Enables flexbox layout */
    justify-content: space-between;  /* Distributes content evenly */
    align-items: flex-start;  /* Aligns items to the top */
    gap: 30px;  /* Adjust spacing between the two columns */
}

.details div {
    flex: 1;  /* Ensures equal width for both sections */
}
.details p {
    margin: 2px 0; /* Reduce spacing between lines */
    padding: 0;
    line-height: 1.2; /* Adjust line spacing */
}
      
        .info-box table {
            width: 100%;
            border-collapse: collapse;
        }
        .info-box td, .info-box th {
            border: 1px solid black;
            padding: 5px;
            text-align: left;
        }
            
        .items {
            width: 100%;
            border-collapse: collapse;
            margin-top: 10px;
        }
        .items th, .items td {
            border: 1px solid black;
            padding: 5px;
            text-align: center;
        }
        .notes {
            margin-top: 10px;
            border: 1px solid black;
            height: 50px;
            padding: 5px;
        }
        .footer {
            margin-top: 20px;
            text-align: center;
            font-weight: bold;
        }
    </style>
</head>
<body>
 
 <div class="header">
    <div>
        <strong>Pluto Software Inc.</strong><br>
        <strong>9785 Hopper Road</strong><br>
        <strong>Frisco, TX 75035</strong><br>
        <strong>1-855-758-8625</strong><br>
        <strong>info@plutocloud.com</strong>
    </div>

   
    <div>
    <h1 style="font-size: 40px; font-weight: bold;">${data.CARRIER_DETAILS.CARRIER}</h1>
</div>

         <div><h1>PACKING SLIP</h1></div>
    </div>
  

    <div class="details">
        <div>
            <p>Ship Date:<strong>&nbsp;${moment(HEADER_INFO.SHIP_DATE).format("MM/DD/YYYY hh:mm A")}</strong></p>
            <p>Ship Method:<strong>&nbsp;${data.CARRIER_DETAILS.CARRIER}</strong></p>
            <p>Service Name:<strong>&nbsp;${Sname}</strong></p>
            <p>Tracking Number:<strong>&nbsp;${TrackingNo}</strong></p>
            <p>Total Packages:<strong>&nbsp;${PACKAGES.length}</strong></p>
            <p>Total Items:<strong>&nbsp;${1} </strong></p>
        </div>
        <div>
            <p>SAP Sales Order:<strong>&nbsp;${HEADER_INFO.DOCUMENT_NUMBER}</strong></p>
            <p>SAP Delivery Number:<strong>&nbsp;${HEADER_INFO.INVOICE_NUMBER}</strong></p>
            <p>PO Number:<strong>&nbsp;${HEADER_INFO?.PO_NUMBER || ''}</strong></p>
            <p>Reference 1:<strong>&nbsp;${data.CARRIER_DETAILS.CUSTOMER_REFERENCE}</strong></p>
            <p>Reference 2:<strong>&nbsp;${data.CARRIER_DETAILS.CUSTOMER_REFERENCE}</strong></p>
        </div>
    </div>
    
<br>
 
    <div class="info-box">
        <table>
          <thead style="background-color:rgb(214, 226, 231)">
            <tr>
                <th>Ship From Information</th>
                <th>Ship To Information</th>
            </tr>
           </thead>
      <tr>
       <td>
        Contact Name:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPPER.CONTACT}</strong><br>
        Company Name:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPPER.COMPANY}</strong><br>
        Address:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPPER.ADDRESS_LINE1}</strong><br>
        City, State Zip:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPPER.CITY}, ${data.SHIPPER.STATE}, ${data.SHIPPER.ZIPCODE}</strong><br>
        Phone:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPPER.PHONE}</strong><br>
        Email:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPPER.EMAIL}</strong>
       </td>
       <td>
        Contact Name:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPTO.CONTACT}</strong><br>
        Company Name:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPTO.COMPANY}</strong><br>
        Address:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPTO.ADDRESS_LINE1}</strong><br>
        City, State Zip:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPTO.CITY}, ${data.SHIPTO.STATE}, ${data.SHIPTO.ZIPCODE}</strong><br>
        Phone:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPTO.PHONE}</strong><br>
        Email:<strong>&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;${data.SHIPTO.EMAIL}</strong>
       </td>
    </tr>
        </table>
    </div>

    


      <h3>Item Details</h3>
    <table class="items">
    <thead style="background-color:rgb(214, 226, 231)">
        <tr>
              <th style="text-align: center; border: 1px solid black;">#</th>
            <th style="text-align: left; border: 1px solid black;">Product Code</th>
            <th style="text-align: left; border: 1px solid black;">Description</th>
            <th style="text-align: right; border: 1px solid black;">Quantity</th>
            <th style="text-align: right; border: 1px solid black;">Dimensions</th>
            <th style="text-align: right; border: 1px solid black;">Weight (lbs)</th>
        </tr>
         </thead>
        ${singleItemInfo.map((item, index) => `
            <tr>
                 <td style="text-align: center; border: 1px solid black;">${item.SNO}</td>
                <td style="text-align: left; border: 1px solid black;">${item.ITEM_NO}</td>
                <td style="text-align: left; border: 1px solid black;">${item.DESCRIPTION}</td>
                <td style="text-align: right; border: 1px solid black;">${item.QUANTITY || 1}</td>
                <td style="text-align: right; border: 1px solid black;">${item.ITEM_DIMENSION}</td>
                <td style="text-align: right; border: 1px solid black;">${Number(item.ITEM_WEIGHT).toFixed(2)}</td>
            </tr>
            `).join('')}
    </table>

    <h3>Notes</h3>
    <div class="notes">${HEADER_INFO?.NOTES || ''}</div>

    <div class="footer">
        Thank you for your business!
    </div>

</body>
</html>

      `
        const browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        })

        const page = await browser.newPage();
        await page.goto('about:blank'); // Ensure a fresh page before setting content
        await page.setContent(htmlcontentPSLIP, { waitUntil: 'networkidle0' });
        const PLpdfBuffer = await page.pdf({
            format: 'A4',
            printBackground: true
        });
        fs.writeFileSync("./Labels/PS.pdf", PLpdfBuffer);
        await browser.close();

        return Buffer.from(PLpdfBuffer);   // return buffer
    }
    const pdfPLBuffer = await pdf()
    console.log(typeof pdfPLBuffer);
    console.log(Buffer.isBuffer(pdfPLBuffer));

    return {
        DOC_PROVIDER: 'GENERIC',
        CONTENT_TYPE: 'PL',
        COPIES_TO_PRINT: '1',
        DOC_NAME: `${HEADER_INFO?.MASTER_TRACKING_NUMBER}.PDF`,
        ENCODED_LABEL: pdfPLBuffer.toString("base64"),
        DOC_TYPE: 'PDF'
    };

}

async function prepareCommercialInvoice1(reqpayload) {
    const doc = new PDFDocument({ margin: 30, size: 'A4' });
    const stream = getStream.buffer(doc);

    const SOLDTO = reqpayload.SOLDTO ?? reqpayload.SHIPTO;
    const items = reqpayload?.INTERNATIONAL_DETAILS?.ITEM_INFO || [];

    const font = 10;
    const gap = 14;

    // ---------------- HEADER (REUSABLE) ----------------
    function drawHeader() {
        doc.font('Helvetica-Bold').fontSize(16)
            .text("COMMERCIAL INVOICE", 180, 30);

        doc.fontSize(10).font('Helvetica');

        doc.text(`Invoice No: ${HEADER_INFO?.DOCUMENT_NUMBER || ''}`, 400, 30);
        doc.text(`Date: ${HEADER_INFO?.SHIP_DATE || ''}`, 400, 45);
        doc.text(`Terms: ${reqpayload?.INTERNATIONAL_DETAILS?.termsofShipment || ''}`, 400, 60);
    }

    // ---------------- ADDRESS BLOCK ----------------
    function drawAddresses() {
        let y = 80;

        doc.font('Helvetica-Bold').text("SHIP FROM", 30, y);
        doc.font('Helvetica');

        y += 15;
        doc.text(reqpayload.SHIPPER?.COMPANY || '', 30, y); y += gap;
        doc.text(reqpayload.SHIPPER?.ADDRESS_LINE1 || '', 30, y); y += gap;
        doc.text(reqpayload.SHIPPER?.CITY || '', 30, y);

        y = 80;

        doc.font('Helvetica-Bold').text("SHIP TO", 300, y);
        doc.font('Helvetica');

        y += 15;
        doc.text(reqpayload.SHIPTO?.COMPANY || '', 300, y); y += gap;
        doc.text(reqpayload.SHIPTO?.ADDRESS_LINE1 || '', 300, y); y += gap;
        doc.text(reqpayload.SHIPTO?.CITY || '', 300, y);
    }

    // ---------------- TABLE HEADER ----------------
    function drawTableHeader(y) {
        doc.font('Helvetica-Bold').fontSize(9);

        doc.text('Qty', 30, y);
        doc.text('Description', 80, y);
        doc.text('HTS', 300, y);
        doc.text('COO', 350, y);
        doc.text('Unit', 420, y);
        doc.text('Total', 480, y);

        y += 12;
        doc.moveTo(30, y).lineTo(550, y).stroke();

        return y + 5;
    }

    // ---------------- TABLE ----------------
    function drawTable() {
        let y = 150;

        y = drawTableHeader(y);

        let totalInvoice = 0;

        items.forEach((item, index) => {
            const qty = Number(item.QUANTITY || 0);
            const unit = Number(item.UNIT_COST || 0);
            const total = qty * unit;

            totalInvoice += total;

            // Page break with header repeat
            if (y > 750) {
                doc.addPage();
                drawHeader();
                drawAddresses();
                y = 150;
                y = drawTableHeader(y);
            }

            doc.font('Helvetica').fontSize(9);

            doc.text(qty, 30, y);
            doc.text(item.DESCRIPTION || '', 80, y, { width: 200 });
            doc.text(item.HTS_CODE || '', 300, y);
            doc.text(item.COUNTRY_OF_ORIGIN || '', 350, y);
            doc.text(unit.toFixed(2), 420, y);
            doc.text(total.toFixed(2), 480, y);

            y += 18;
        });

        return { y, totalInvoice };
    }

    // ---------------- TOTALS ----------------
    function drawTotals(y, totalInvoice) {
        y += 20;

        if (y > 700) {
            doc.addPage();
            drawHeader();
            y = 150;
        }

        doc.rect(300, y, 250, 100).stroke();

        doc.text("Total Invoice:", 310, y + 20);
        doc.text(totalInvoice.toFixed(2), 480, y + 20);

        doc.text("Currency:", 310, y + 40);
        doc.text(reqpayload?.INTERNATIONAL_DETAILS?.currency || 'USD', 480, y + 40);

        return y + 120;
    }

    // ---------------- DECLARATION ----------------
    function drawDeclaration(y) {
        if (y > 720) {
            doc.addPage();
            y = 50;
        }

        doc.rect(30, y, 520, 80).stroke();

        doc.fontSize(8).text(
            "I declare that the information contained in this invoice is true and correct and that the contents of this shipment are as stated above.",
            40,
            y + 10,
            { width: 500 }
        );

        doc.text("Authorized Signature: ____________________", 40, y + 50);

        return y + 100;
    }

    // ---------------- EXECUTION FLOW ----------------
    drawHeader();
    drawAddresses();

    const { y, totalInvoice } = drawTable();
    const totalsY = drawTotals(y, totalInvoice);
    drawDeclaration(totalsY);

    const filePath = `./CI_${Date.now()}.pdf`;
    const fileStream = fs.createWriteStream(filePath);

    doc.pipe(fileStream);

    doc.end();

    await new Promise(resolve => fileStream.on('finish', resolve));

    const pdfBuffer = await stream;

    return {
        contentType: "Commercial Invoice",
        copiesToPrint: 1,
        encodedLabel: pdfBuffer.toString('base64'),
        docType: 'PDF'
    };
}

async function prepareCommercialInvoice(reqpayload, HEADER_INFO, PACKAGES) {
    const doc = new PDFDocument({ margin: 10, size: 'A4' });
    const stream = getStream.buffer(doc);

    const items = reqpayload?.INTERNATIONAL_DETAILS?.ITEM_INFO || [];
    const SOLDTO = reqpayload.SOLDTO ?? reqpayload.SHIPTO;

    const font = 9;
    const gap = 14;

    let pageNumber = 1;
    let totalInvoice = 0;

    // ---------------- HEADER (REUSABLE) ----------------
    function drawHeader() {
        doc.rect(10, 10, 570, 20).stroke();
        doc.font('Helvetica-Bold').fontSize(14)
            .text("COMMERCIAL INVOICE", 200, 15);

        doc.fontSize(8).text(`Page: ${pageNumber}`, 520, 15);

        doc.rect(10, 40, 570, 210).stroke();

        // LEFT SIDE (SHIP TO)
        let y = 55;
        doc.fontSize(10).font('Helvetica-Bold').text("Ship To", 15, y);
        y += gap;

        doc.fontSize(font).font('Helvetica');
        doc.text(reqpayload.SHIPTO?.COMPANY || '', 15, y); y += gap;
        doc.text(reqpayload.SHIPTO?.CONTACT || '', 15, y); y += gap;
        doc.text(`${reqpayload.SHIPTO?.ADDRESS_LINE1 || ''}`, 15, y); y += gap;
        doc.text(`${reqpayload.SHIPTO?.CITY || ''}, ${reqpayload.SHIPTO?.STATE || ''}`, 15, y);

        // ---------------- SHIP FROM ----------------
        y = 140;
        doc.fontSize(12).text("Ship From", 15, y);
        y += gap;

        doc.fontSize(font).text(`Tax ID: ${reqpayload.SHIPPER?.TAXID || ''}`, 15, y);
        y += gap;
        doc.text(reqpayload.SHIPPER?.COMPANY || '', 15, y); y += gap;
        doc.text(reqpayload.SHIPPER?.CONTACT || '', 15, y); y += gap;

        doc.text([
            reqpayload.SHIPPER?.ADDRESS_LINE1,
            reqpayload.SHIPPER?.ADDRESS_LINE2,
            reqpayload.SHIPPER?.ADDRESS_LINE3
        ].filter(Boolean).join(', '), 15, y);
        y += gap;

        doc.text(`${reqpayload.SHIPPER?.CITY || ''}, ${reqpayload.SHIPPER?.STATE || ''} ${reqpayload.SHIPPER?.ZIPCODE || ''} ${reqpayload.SHIPPER?.COUNTRY || ''}`, 15, y);


        // RIGHT SIDE (INFO)
        let yRight = 55;

        const drawField = (label, value) => {
            doc.text(label, 320, yRight);
            doc.text(`: ${value || ''}`, 420, yRight);
            yRight += gap;
        };

        drawField("Shipment ID", HEADER_INFO?.DOCUMENT_NUMBER);
        drawField("Date", HEADER_INFO?.SHIP_DATE);
        drawField("Terms", reqpayload?.INTERNATIONAL_DETAILS?.termsofShipment);
        drawField("Reason", reqpayload?.INTERNATIONAL_DETAILS?.reasonforExport);
    }

    // ---------------- TABLE HEADER ----------------
    function drawTableHeader(y) {
        const colX = {
            qty: 15,
            desc: 80,
            hts: 300,
            coo: 360,
            unit: 420,
            total: 500
        };

        doc.font('Helvetica-Bold').fontSize(9);

        doc.text('Qty', colX.qty, y);
        doc.text('Description', colX.desc, y);
        doc.text('HTS', colX.hts, y);
        doc.text('COO', colX.coo, y);
        doc.text('Unit', colX.unit, y);
        doc.text('Total', colX.total, y);

        y += 15;
        doc.moveTo(10, y).lineTo(580, y).stroke();

        return y + 5;
    }

    // ---------------- TABLE WITH PAGINATION ----------------
    function drawTable(items) {
        let y = 260;

        drawHeader();
        y = drawTableHeader(y);

        doc.font('Helvetica').fontSize(9);

        items.forEach((item, index) => {
            const qty = Number(item.QUANTITY || 0);
            const unit = Number(item.UNIT_COST || 0);
            const total = qty * unit;

            totalInvoice += total;

            // PAGE BREAK
            if (y > 750) {
                doc.addPage();
                pageNumber++;
                drawHeader();
                y = drawTableHeader(260);
            }

            doc.text(qty, 15, y);
            doc.text(item.DESCRIPTION || '', 80, y, { width: 200 });
            doc.text(item.HTS_CODE || '', 300, y);
            doc.text(item.COUNTRY_OF_ORIGIN || '', 360, y);
            doc.text(unit.toFixed(2), 420, y);
            doc.text(total.toFixed(2), 500, y);

            y += 18;
        });

        return y;
    }

    // ---------------- TOTALS ----------------
    function drawTotals(y) {
        if (y > 700) {
            doc.addPage();
            pageNumber++;
            drawHeader();
            y = 260;
        }

        doc.rect(300, y, 290, 100).stroke();

        doc.fontSize(10).font('Helvetica-Bold')
            .text("TOTAL INVOICE VALUE", 310, y + 15);

        doc.font('Helvetica')
            .text(totalInvoice.toFixed(2), 480, y + 15);

        doc.text("Currency:", 310, y + 35);
        doc.text(reqpayload?.INTERNATIONAL_DETAILS?.currency || 'USD', 480, y + 35);

        return y + 110;
    }

    // ---------------- DECLARATION ----------------
    function drawDeclaration(y) {
        if (y > 700) {
            doc.addPage();
            pageNumber++;
            drawHeader();
            y = 260;
        }

        doc.rect(10, y, 580, 80).stroke();

        doc.fontSize(8)
            .text(
                "I declare that the information contained in this invoice is true and correct and that the contents of this shipment are as stated above.",
                15,
                y + 10,
                { width: 560 }
            );

        // Signature
        doc.text("Shipper Signature:", 15, y + 50);
        doc.moveTo(130, y + 60).lineTo(300, y + 60).stroke();

        doc.text("Date:", 350, y + 50);
        doc.moveTo(390, y + 60).lineTo(500, y + 60).stroke();
    }

    // ---------------- EXECUTION FLOW ----------------
    const finalY = drawTable(items);
    const totalsY = drawTotals(finalY + 10);
    drawDeclaration(totalsY + 10);
    const filePath = `./CI_${Date.now()}.pdf`;
    const fileStream = fs.createWriteStream(filePath);

    doc.pipe(fileStream);

    doc.end();

    await new Promise(resolve => fileStream.on('finish', resolve));

    const pdfBuffer = await stream;
    return {
        DOC_PROVIDER: 'GENERIC',
        CONTENT_TYPE: 'CI',
        COPIES_TO_PRINT: '1',
        DOC_NAME: `${HEADER_INFO?.MASTER_TRACKING_NUMBER}.PDF`,
        ENCODED_LABEL: pdfBuffer.toString("base64"),
        DOC_TYPE: 'PDF'
    };
}

async function prepareCOO(reqpayload, HEADER_INFO, PACKAGES) {

    const doc = new PDFDocument({ margin: 10, size: 'A4' });
    const stream = getStream.buffer(doc);

    const SOLDTO = reqpayload.SOLDTO ?? reqpayload.SHIPTO;

    let y = 65;
    const gap = 15;

    // ---------------- TITLE ----------------
    doc.fontSize(16).font('Helvetica-Bold')
        .text("CERTIFICATE OF ORIGIN", 180, 15);

    doc.rect(10, 40, 570, 550).stroke();

    // ---------------- SHIPPER DECLARATION ----------------
    doc.font('Helvetica').fontSize(12)
        .text("The undersigned", 15, y);

    doc.moveTo(110, y + 10).lineTo(570, y + 10).stroke();

    doc.fontSize(10)
        .text(reqpayload.SHIPPER?.COMPANY || '', 120, y);

    doc.fontSize(9)
        .text("Owner or Agent", 230, y + 12);

    y += 35;

    // ---------------- SHIPPER ADDRESS ----------------
    doc.moveTo(15, y).lineTo(570, y).stroke();

    doc.fontSize(9)
        .text("Name and Address of Shipper", 200, y + 5);

    const shipperAddress = [
        reqpayload.SHIPPER?.ADDRESS_LINE1,
        reqpayload.SHIPPER?.ADDRESS_LINE2,
        reqpayload.SHIPPER?.CITY,
        reqpayload.SHIPPER?.STATE,
        reqpayload.SHIPPER?.COUNTRY,
        reqpayload.SHIPPER?.ZIPCODE
    ].filter(Boolean).join(', ');

    doc.fontSize(10)
        .text(shipperAddress, 25, y - 10, { width: 500 });

    y += 40;

    // ---------------- DECLARATION TEXT ----------------
    doc.fontSize(12)
        .text("declares that the following mentioned goods shipped on ", 10, y);

    doc.moveTo(280, y + 10).lineTo(570, y + 10).stroke();

    doc.fontSize(10)
        .text(reqpayload.CARRIER_DETAILS?.CARRIER || '', 300, y - 5);

    y += 30;

    // ---------------- DATE ----------------
    const shipDate = HEADER_INFO?.SHIP_DATE || '';
    doc.fontSize(12).text("on the date", 15, y);

    doc.moveTo(90, y + 10).lineTo(170, y + 10).stroke();
    doc.fontSize(10).text(shipDate, 95, y - 5);

    // ---------------- CONSIGNEE ----------------
    doc.fontSize(12).text("Consigned to:", 210, y);

    doc.moveTo(310, y + 10).lineTo(570, y + 10).stroke();

    doc.fontSize(10)
        .text(reqpayload.SHIPTO?.COMPANY || '', 320, y - 5);

    y += 40;

    doc.moveTo(15, y).lineTo(570, y).stroke();

    const shipToAddress = [
        reqpayload.SHIPTO?.ADDRESS_LINE1,
        reqpayload.SHIPTO?.ADDRESS_LINE2,
        reqpayload.SHIPTO?.CITY,
        reqpayload.SHIPTO?.STATE,
        reqpayload.SHIPTO?.COUNTRY,
        reqpayload.SHIPTO?.ZIPCODE
    ].filter(Boolean).join(', ');

    doc.fontSize(10)
        .text(shipToAddress, 25, y - 15, { width: 500 });

    y += 30;

    doc.fontSize(12).text("are the products of ", 15, y);

    // ---------------- TABLE HEADER ----------------
    y += 20;

    doc.rect(15, y, 555, 45).stroke();

    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("MARKS & NUMBERS", 20, y + 5);
    doc.text("NO. OF PKGS", 160, y + 5);
    doc.text("WEIGHT (KG)", 290, y + 5);
    doc.text("DESCRIPTION", 450, y + 5);

    doc.moveTo(15, y + 20).lineTo(570, y + 20).stroke();

    doc.moveTo(150, y).lineTo(150, y + 45).stroke();
    doc.moveTo(280, y).lineTo(280, y + 45).stroke();
    doc.moveTo(445, y).lineTo(445, y + 45).stroke();

    // ---------------- TABLE DATA ----------------
    const pkgcount = reqpayload.PACKAGES?.length || 0;

    let totalWeight = 0;

    (reqpayload.PACKAGES || []).forEach(pkg => {
        let w = Number(pkg.Weight || 0);

        if (pkg.WEIGHT_UNITS === "LBS") {
            w = w * 0.45359237;
        }

        totalWeight += w;
    });

    totalWeight = totalWeight.toFixed(2);

    doc.font("Helvetica").fontSize(10);
    doc.text(pkgcount, 160, y + 25);
    doc.text(totalWeight, 290, y + 25);

    doc.text("General Merchandise", 450, y + 25);

    y += 70;

    // ---------------- DECLARATION ----------------
    doc.fontSize(12).text("Sworn to before me this ", 15, y);

    doc.moveTo(135, y + 10).lineTo(190, y + 10).stroke();

    doc.text("day of", 195, y);

    doc.moveTo(240, y + 10).lineTo(300, y + 10).stroke();

    doc.text("20__", 305, y);

    doc.moveTo(330, y + 10).lineTo(570, y + 10).stroke();

    y += 40;

    doc.moveTo(15, y).lineTo(570, y).stroke();

    doc.text("The", 15, y + 20);

    doc.moveTo(40, y + 30).lineTo(570, y + 30).stroke();

    doc.text(
        "a recognized Chamber of Commerce under the laws of State of",
        15,
        y + 50
    );

    doc.moveTo(400, y + 60).lineTo(570, y + 60).stroke();

    doc.text(
        "has examined the manufacturer's invoice or shipper affidavit concerning the origin of the merchandise.",
        15,
        y + 80,
        { width: 550 }
    );

    doc.text(
        "According to the best of its knowledge and belief, the goods are of stated origin.",
        15,
        y + 110
    );

    // ---------------- SIGNATURE ----------------
    doc.text("Authorized Signature", 400, y + 150);
    doc.moveTo(400, y + 160).lineTo(560, y + 160).stroke();

    // ---------------- FINALIZE ----------------
    const filePath = `./Labels/COO_${Date.now()}.pdf`;
    const fileStream = fs.createWriteStream(filePath);
    doc.pipe(fileStream);
    doc.end();
    await new Promise(resolve => fileStream.on('finish', resolve));
    const pdfBuffer = await stream;
    return {
        DOC_PROVIDER: 'GENERIC',
        CONTENT_TYPE: 'COO',
        COPIES_TO_PRINT: '1',
        DOC_NAME: `${HEADER_INFO?.MASTER_TRACKING_NUMBER}.PDF`,
        ENCODED_LABEL: pdfBuffer.toString("base64"),
        DOC_TYPE: 'PDF'
    };
}




async function preparelabel_pdfkit(data, PACKAGES) {
    const documents = [];

    for (const [index, element] of PACKAGES.entries()) {
        // for (const element of PACKAGES) {
        const datapkg = data.PACKAGES[index];
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
            doc.text('Weight: ' + datapkg.WEIGHT + ' ' + datapkg.WEIGHT_UNITS, 460, y + 15);
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

            doc.fontSize(22).text(data.HEADER_INFO.DOCUMENT_NUMBER, 300, y);
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

        // // Upload to storage
        // try {
        //     await reuse.uploadbufferFile(pdfBuffer, `${element.TRACKING_NUMBER}.pdf`);
        // } catch (error) {
        //     console.error("Error uploading file:", error);
        // }
    }

    return documents;
}

async function preparelabel_pdfkit1(data) {

    const documents = [];

    const safe = (v) => v || '';

    const formatAddress = (obj) => {
        return [
            obj?.ADDRESS_LINE1,
            obj?.ADDRESS_LINE2,
            obj?.CITY,
            obj?.STATE,
            obj?.ZIPCODE,
            obj?.COUNTRY
        ].filter(Boolean).join(', ');
    };

    for (const pkg of data.PACKAGES) {

        const doc = new PDFDocument({
            size: [288, 432], // ✅ TRUE 4x6
            margin: 8
        });

        const stream = getStream.buffer(doc);

        let y = 10;

        // ---------------- CARRIER HEADER ----------------
        doc.font('Helvetica-Bold').fontSize(12)
            .text(
                data.CARRIER_DETAILS?.CARRIER === 'OTHER'
                    ? safe(data.CARRIER_DETAILS?.SERVICE_CODE)
                    : safe(data.CARRIER_DETAILS?.CARRIER),
                10,
                y
            );

        doc.fontSize(9)
            .text(safe(data.CARRIER_DETAILS?.SERVICE_CODE), 200, y);

        y += 18;
        doc.moveTo(10, y).lineTo(278, y).stroke();

        // ---------------- SHIP FROM ----------------
        y += 5;

        doc.font('Helvetica-Bold').fontSize(8)
            .text("FROM:", 10, y);

        y += 10;

        doc.font('Helvetica').fontSize(8);
        doc.text(safe(data.SHIPPER?.COMPANY), 10, y);
        y += 10;
        doc.text(formatAddress(data.SHIPPER), 10, y, { width: 260 });

        y += 25;

        // ---------------- SHIP TO ----------------
        doc.moveTo(10, y).lineTo(278, y).stroke();

        y += 5;

        doc.font('Helvetica-Bold').fontSize(9)
            .text("TO:", 10, y);

        y += 12;

        doc.fontSize(11).font('Helvetica-Bold')
            .text(safe(data.SHIPTO?.CONTACT), 10, y);

        y += 12;

        doc.fontSize(10)
            .text(safe(data.SHIPTO?.COMPANY), 10, y);

        y += 12;

        doc.fontSize(10)
            .text(formatAddress(data.SHIPTO), 10, y, { width: 260 });

        y += 35;

        doc.fontSize(9)
            .text("Phone: " + safe(data.SHIPTO?.PHONE), 10, y);

        y += 15;

        // ---------------- BARCODE AREA ----------------
        doc.rect(10, y, 268, 60).stroke();

        doc.fontSize(14).font('Helvetica-Bold')
            .text(pkg.TRACKING_NUMBER, 20, y + 20);

        y += 70;

        // ---------------- TRACKING BIG ----------------
        doc.fontSize(16).font('Helvetica-Bold')
            .text(pkg.TRACKING_NUMBER, 10, y, {
                width: 268,
                align: 'center'
            });

        y += 20;

        // ---------------- DETAILS ----------------
        doc.moveTo(10, y).lineTo(278, y).stroke();

        y += 5;

        doc.fontSize(8).font('Helvetica');

        doc.text(`Weight: ${safe(pkg.WEIGHT)} ${safe(pkg.WEIGHT_UNITS)}`, 10, y);

        const formattedDate = new Date(data.HEADER_INFO?.SHIP_DATE || '').toLocaleString();
        doc.text(`Ship Date: ${formattedDate}`, 140, y);

        y += 12;

        doc.text(`Ref: ${safe(data.CARRIER_DETAILS?.REFERENCE1)}`, 10, y);

        doc.text(`Doc#: ${safe(data.HEADER_INFO?.DOCUMENT_NUMBER)}`, 140, y);

        y += 20;

        // ---------------- FOOTER ----------------
        doc.rect(10, y, 268, 20).fill('black');

        doc.fillColor('white')
            .fontSize(9)
            .text("HANDLE WITH CARE", 60, y + 5);

        doc.fillColor('black');

        doc.end();

        const pdfBuffer = await stream;

        documents.push({
            docProvider: 'Generic',
            contentType: "Label",
            copiesToPrint: 1,
            docName: `${pkg.TRACKING_NUMBER}.pdf`,
            encodedLabel: pdfBuffer.toString('base64'),
            docType: 'PDF'
        });
    }

    return documents;
}


async function OLD_prepareHUlabel(data) {
    const pdf = async () => {
        reqpayload = data;
        // Create a new PDF document
        const doc = new jsPDF({
            orientation: 'landscape',
            unit: 'mm',
            format: [50.8, 76.2], // 3x2 inches in mm
        });

        for (let i = 0; i < reqpayload.HUs.length; i++) {
            doc.setLineWidth(0.3); // Border thickness
            doc.rect(1, 1, 74.2, 48.8); // Draw rectangle (x, y, width, height)

            doc.setFontSize(16);

            doc.text(`${reqpayload.CountryCode}`, 58, 44);

            // Generate the barcode as a Buffer
            const barcodeBuffer = await new Promise((resolve, reject) => {
                bwipjs.toBuffer({
                    bcid: 'code128',
                    text: reqpayload.HUs[i].HU,
                    scale: 4,              // 3x scaling factor
                    height: 10,            // Bar height, in millimeters
                    includetext: true,     // Show human-readable text
                    textxalign: 'center',  // Align text to center
                }, function (err, png) {
                    if (err) {
                        reject(err);
                    } else {
                        resolve(png);
                    }
                });
            });

            const barcodeBase64 = barcodeBuffer.toString('base64');
            doc.addImage(`data:image/png;base64,${barcodeBase64}`, 'PNG', 5, 15, 65, 18);
            // Add a new page if it's not the last label
            if (i < reqpayload.HUs.length - 1) {
                doc.addPage();
            }
        }

        // Save the PDF
        const pdfBuffer = doc.output('arraybuffer');
        fs.writeFileSync('./Labels/' + `${reqpayload.HUs[0].HU}.pdf`, Buffer.from(pdfBuffer));

        return (Buffer.from(pdfBuffer)).toString('base64')

    }
    const pdfBuffer = await pdf()
    document = {}
    document['contentType'] = "Label",
        document['copiesToPrint'] = 1,
        document['docType'] = 'PDF'
    document['encodedLabel'] = pdfBuffer


    return document;
}


async function prepareLabel_png_sharp(data, HEADER_INFO, PACKAGES) {
    try {
        const WIDTH = 800;
        const HEIGHT = 1200;
        const responses = [];

        for (let i = 0; i < PACKAGES.length; i++) {
            let dnbarcode = null;
            const pkg = PACKAGES[i];
            const datapkg = data.PACKAGES[i];
            // -------- TrackingNumber Barcode --------
            const barcode = await bwipjs.toBuffer({
                bcid: 'code128',
                text: pkg.TRACKING_NUMBER,
                scale: 4,
                height: 12,
                includetext: true,
                textxalign: 'center'
            });
            // -------- DocumentNumber Barcode --------
            if (data.HEADER_INFO.DOCUMENT_NUMBER) {
                dnbarcode = await bwipjs.toBuffer({
                    bcid: 'code128',
                    text: data.HEADER_INFO?.DOCUMENT_NUMBER || 'TEST',
                    scale: 4,
                    height: 10,
                    includetext: false,
                    textxalign: 'center'
                });
            }

            const formattedDate = moment(data.HEADER_INFO.SHIP_DATE).format('MM/DD/YYYY');
            // -------- SVG Layout --------
            const svg = `
        <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">
            <style>
                .title { font: bold 36px Arial; }
                .title2 { font: bold 32px Arial; }
                .bold { font: bold 26px Arial; }
                .text { font: 28px Arial; }
                .small { font: 22px Arial; }
                .box { fill: none; stroke: black; stroke-width: 3; }
                .line { stroke: black; stroke-width: 3; }
            </style>

            <!-- Outer Border -->
            <rect x="10" y="10" width="${WIDTH - 20}" height="${HEIGHT - 20}" class="box"/>

            <!-- SHIP FROM -->
            <text x="20" y="55" class="title2">SHIP FROM:</text>
            <text x="500" y="55" class="title">${data.CARRIER_DETAILS.CARRIER}</text>
            
             <text x="550" y="160" class="small">Ship Date:${formattedDate}</text>
              <text x="550" y="200" class="small">Weight: ${datapkg.WEIGHT} ${datapkg.WEIGHT_UNITS}</text>
               <text x="550" y="240" class="small">Dims: ${datapkg.DIMENSION} ${datapkg.DIMENSION_UNITS}</text>
           
            <line x1="480" y1="10" x2="480" y2="280" class="line"/>
            <line x1="480" y1="70" x2="790" y2="70" class="line"/>

            <text x="40" y="110" class="text">${data.SHIPPER.CONTACT}</text>
            <text x="40" y="150" class="text">${data.SHIPPER.COMPANY}</text>
            <text x="40" y="190" class="text">${data.SHIPPER.ADDRESS_LINE1}</text>
            <text x="40" y="230" class="text">
                ${data.SHIPPER.CITY}, ${data.SHIPPER.STATE} ${data.SHIPPER.ZIPCODE}
            </text>

            <!-- SHIP TO -->
            <line x1="10" y1="280" x2="790" y2="280" class="line"/>
            <text x="20" y="330" class="title2">SHIP TO:</text>
            <text x="650" y="330" class="small">${i + 1} of ${data.PACKAGES.length}</text>

            <text x="40" y="380" class="text">${data.SHIPTO.CONTACT}</text>
            <text x="40" y="420" class="text">${data.SHIPTO.COMPANY}</text>
            <text x="40" y="460" class="text">${data.SHIPTO.ADDRESS_LINE1}</text>
            <text x="40" y="500" class="text">
                ${data.SHIPTO.CITY}, ${data.SHIPTO.STATE} ${data.SHIPTO.ZIPCODE}
            </text>

            <!-- Service Box -->
            <rect x="20" y="540" width="760" height="100" class="box"/>
            <text x="60" y="600" class="title">${data.CARRIER_DETAILS?.SERVICE_CODE}</text>

            <!-- Footer -->
            <line x1="10" y1="860" x2="790" y2="860" class="line"/>
            <text x="30" y="900" class="text">HU # ${datapkg.HU || ''}</text>
            <text x="30" y="940" class="text">Reference # ${HEADER_INFO.CUSTOMER_REFERENCE}</text>
            <text x="30" y="980" class="text">PO # ${HEADER_INFO.PO_NUMBER}</text>

            <text x="280" y="1150" class="small">
                Delivery # ${HEADER_INFO.DOCUMENT_NUMBER}
            </text>
        </svg>
        `;

            const composites = [
                { input: Buffer.from(svg), top: 0, left: 0 },
                barcode && { input: barcode, top: 670, left: 100 },
                dnbarcode && { input: dnbarcode, top: 1010, left: 200 }
            ].filter(Boolean);

            // -------- Render PNG --------
            const pngBuffer = await sharp({
                create: {
                    width: WIDTH,
                    height: HEIGHT,
                    channels: 3,
                    background: 'white' //'#fff'
                }
            })
                .composite(composites)
                .png()
                .toBuffer();

            const fileName = `${pkg.TRACKING_NUMBER}_${i}.png`;
            fs.writeFileSync(`./Labels/${fileName}`, pngBuffer);
            responses.push({
                DOC_PROVIDER: 'GENERIC',
                CONTENT_TYPE: "LABEL",
                COPIES_TO_PRINT: '1',
                DOC_NAME: `${pkg.TRACKING_NUMBER}.PDF`,
                DOC_TYPE: "PNG",
                ENCODED_LABEL: pngBuffer.toString('base64')
            });


        }

        return responses;
    } catch (error) {
        console.log(error.message);
        return {};
    }

}


async function prepareHUlabel(data) {

    return new Promise(async (resolve, reject) => {
        try {

            // 1 inch = 72 points
            const PAGE_WIDTH = 216;   // 3 inches
            const PAGE_HEIGHT = 144;  // 2 inches

            // Create PDF (DO NOT use layout: 'landscape')
            const doc = new PDFDocument({
                size: [PAGE_WIDTH, PAGE_HEIGHT],
                margins: {
                    top: 5,
                    bottom: 5,
                    left: 5,
                    right: 5
                }
            });

            // Collect PDF data
            const buffers = [];
            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => {
                const pdfBuffer = Buffer.concat(buffers);

                // Optional: save file locally
                fs.writeFileSync(`./Labels/${data.HUs[0].HU}.pdf`, pdfBuffer);

                resolve({
                    contentType: "Label",
                    copiesToPrint: 1,
                    docType: "PDF",
                    encodedLabel: pdfBuffer.toString('base64')
                });
            });

            // Loop through all HUs
            for (let i = 0; i < data.HUs.length; i++) {

                // ---------- Border ----------
                doc
                    .lineWidth(0.5)
                    .rect(5, 5, PAGE_WIDTH - 10, PAGE_HEIGHT - 10)
                    .stroke();

                // ---------- Barcode ----------
                const barcodeBuffer = await bwipjs.toBuffer({
                    bcid: 'code128',
                    text: data.HUs[i].HU,
                    scale: 2,          // Controls bar thickness
                    height: 12,        // Bar height
                    includetext: true,
                    textxalign: 'center'
                });

                const BARCODE_WIDTH = 150;
                const barcodeX = (PAGE_WIDTH - BARCODE_WIDTH) / 2;

                doc.image(barcodeBuffer, barcodeX, 35, {
                    width: BARCODE_WIDTH
                });

                // ---------- Country Code ----------
                doc
                    .fontSize(14)
                    .text(
                        data.CountryCode,
                        PAGE_WIDTH - 60,
                        PAGE_HEIGHT - 30,
                        { width: 50, align: 'right' }
                    );

                // New page for next label
                if (i < data.HUs.length - 1) {
                    doc.addPage();
                }
            }

            // VERY IMPORTANT
            doc.end();

        } catch (err) {
            reject(err);
        }
    });
}

function generateZPLLabels(data) {
    const DPI = 203;
    const WIDTH = 3 * DPI;   // 609
    const HEIGHT = 2 * DPI;  // 406

    let zpl = '';

    data.HUs.forEach(item => {
        zpl += `
^XA
^PW${WIDTH}
^LL${HEIGHT}

^FO20,20
^GB${WIDTH - 40},${HEIGHT - 40},2^FS

^FO80,120
^BCN,120,Y,N,N
^FD${item.HU}^FS

^FO${WIDTH - 120},${HEIGHT - 80}
^A0N,40,40
^FD${data.CountryCode}^FS

^XZ
`;
    });

    return zpl;
}

async function generatePNGLabels(data) {

    const DPI = 203;
    const WIDTH = 3 * DPI;   // 609
    const HEIGHT = 2 * DPI;  // 406

    const responses = [];

    for (const item of data.HUs) {

        // -------- Barcode --------
        const barcodeBuffer = await bwipjs.toBuffer({
            bcid: 'code128',
            text: item.HU,
            scale: 3,
            height: 20,
            includetext: true,
            textxalign: 'center'
        });

        // -------- SVG overlay (TEXT + LINES + BOXES) --------
        const svgOverlay = `
        <svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg">

            <!-- Outer Border -->
            <rect x="20" y="20"
                  width="${WIDTH - 40}"
                  height="${HEIGHT - 40}"
                  fill="none"
                  stroke="black"
                  stroke-width="2"/>

            <!-- Horizontal separator line -->
            <line x1="40" y1="300" x2="${WIDTH - 40}" y2="300"
                  stroke="black" stroke-width="2"/>

            <!-- Country Code -->
            <text x="${WIDTH - 60}" y="${HEIGHT - 40}"
                  font-size="36"
                  font-family="Arial"
                  font-weight="bold"
                  text-anchor="end"
                  fill="black">
                ${data.CountryCode}
            </text>

            <!-- Custom String -->
            <text x="40" y="80"
                  font-size="24"
                  font-family="Arial"
                  fill="black">
                Handling Unit
            </text>

        </svg>
        `;

        // -------- Canvas --------
        const canvas = sharp({
            create: {
                width: WIDTH,
                height: HEIGHT,
                channels: 3,
                background: { r: 255, g: 255, b: 255 }
            }
        });

        // -------- Compose Label --------
        const pngBuffer = await canvas
            .composite([
                { input: Buffer.from(svgOverlay), top: 0, left: 0 },
                { input: barcodeBuffer, top: 120, left: 80 }
            ])
            .png()
            .toBuffer();



        // -------- Response format --------
        responses.push({
            contentType: "Label",
            copiesToPrint: 1,
            docType: "PNG",
            encodedLabel: pngBuffer.toString('base64')
        });
    }

    return responses;
}


async function generateDRYICEPNGLabels(data) {

    const DPI = 203;
    const WIDTH = 3 * DPI;   // 609 px
    const HEIGHT = 2 * DPI;  // 406 px

    const responses = [];

    for (const item of data.HUs) {

        // ---- SVG TEMPLATE ----
        const svg = `
        <svg width="${WIDTH}" height="${HEIGHT}"
             viewBox="0 0 ${WIDTH} ${HEIGHT}"
             xmlns="http://www.w3.org/2000/svg">

            <style>
                .border { fill: none; stroke: red; stroke-width: 6; }
                .title  { font: bold 96px Arial; fill: red; }
                .sub    { font: bold 64px Arial; fill: red; }
                .small  { font: bold 46px Arial; fill: red; }
            </style>

            <!-- Outer Border -->
            <rect x="15" y="15"
                  width="${WIDTH - 30}"
                  height="${HEIGHT - 30}"
                  class="border"/>

            <!-- Centered Main Text -->
            <g text-anchor="middle">
                <text x="${WIDTH / 2}" y="150" class="title">
                    DRY ICE
                </text>

                <text x="${WIDTH / 2}" y="220" class="sub">
                    UN 1845
                </text>
            </g>

             <text x="120" y="${HEIGHT - 70}"
                  class="small"
                  text-anchor="middle">
                5.5
            </text>
            <!-- Bottom Text -->
            <text x="${WIDTH / 2}" y="${HEIGHT - 60}"
                  class="small"
                  text-anchor="middle">
                ..............   Kg Net Weight
            </text>

        </svg>
        `;

        // ---- RENDER PNG ----
        const pngBuffer = await sharp({
            create: {
                width: WIDTH,
                height: HEIGHT,
                channels: 3,
                background: "white"
            }
        })
            .composite([
                { input: Buffer.from(svg), top: 0, left: 0 }
            ])
            .png()
            .toBuffer();

        // Optional local test
        fs.writeFileSync("./Labels/dry_ice.png", pngBuffer);

        // ---- RESPONSE FORMAT ----
        responses.push({
            contentType: "Label",
            copiesToPrint: 1,
            docType: "PNG",
            encodedLabel: pngBuffer.toString("base64")
        });
    }

    return responses;
}




function drawTableHeader(doc, y) {
    doc.font("Helvetica-Bold").fontSize(10);

    doc.text("Qty", 30, y + 5);
    doc.text("Type", 70, y + 5);
    doc.text("Wt", 140, y + 5);
    doc.text("Hzmt", 190, y + 5);
    doc.text("Description", 250, y + 5);

    doc
        .moveTo(20, y + 20)
        .lineTo(575, y + 20)
        .stroke();
}

function drawTableRows(doc, rows, startY) {
    let y = startY;

    doc.font("Helvetica").fontSize(10);

    rows.forEach((row, index) => {

        // Optional row separator
        if (index !== 0) {
            doc
                .moveTo(20, y - 5)
                .lineTo(575, y - 5)
                .strokeColor("#ccc")
                .stroke();
        }
        doc.fillColor("black");
        doc.text(row.qty || "", 30, y);
        doc.text(row.type || "", 70, y);
        doc.text(row.weight || "", 140, y);
        doc.text(row.hazmat || "", 190, y);
        doc.text(row.description || "", 250, y, { width: 300 });

        y += 20;

        // 🔴 Page overflow safety (important for real BOLs)
        if (y > 450) {
            doc.addPage();
            y = 50;

            // Redraw table header on new page
            drawTableHeader(doc, y);
            y += 25;
        }
    });
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
        const header = HEADER_INFO;

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
            const element = reqpayload.PACKAGES[index];
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

module.exports = { preparelabel_ZPL, generateDRYICEPNGLabels, prepareLabel_png_sharp, prepareHUlabel, generatePNGLabels, generateZPLLabels, preparelabel_pdfkit, preparePackingSlip_pdfkit, preparePackingSlip_html, prepareCommercialInvoice, prepareCOO }
