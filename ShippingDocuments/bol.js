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


let BOTTOM_Y = 600;
const ROW_HEIGHT = 60;
function boldBox(doc, x, y, w, h) {
    doc.save();
    doc.strokeColor("black");
    doc.lineWidth(1);
    doc.rect(x, y, w, h).stroke();   // ✅ draw directly
    doc.restore();
}

function thinBox(doc, x, y, w, h) {
    doc.save();
    doc.strokeColor("black");
    doc.lineWidth(0.7);
    doc.rect(x, y, w, h).stroke();   // ✅ draw directly
    doc.restore();
}

function thinLine(doc, x1, y1, x2, y2) {
    doc.save();
    doc.strokeColor("black");
    doc.lineWidth(0.7);
    doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
    doc.restore();
}

function lightLine(doc, x1, y1, x2, y2) {
    doc.save();
    doc.strokeColor("#ccc");
    doc.lineWidth(0.5);
    doc.moveTo(x1, y1).lineTo(x2, y2).stroke();
    doc.restore();
}


async function generateBOLPdf(req, HEADER_INFO, PACKAGES) {

    const data = {
        bolNumber: HEADER_INFO?.BOL_NUMBER || HEADER_INFO.DOCUMENT_NUMBER,
        trailer: "N/A",
        pro: HEADER_INFO?.MASTER_TRACKING_NUMBER,
        po: HEADER_INFO?.PO_NUMBER,
        shipFrom: [
            req.SHIPFROM.COMPANY,
            req.SHIPFROM.ADDRESS_LINE1,
            req.SHIPFROM.ADDRESS_LINE2,
            req.SHIPFROM.CITY + "," + req.SHIPFROM.STATE + "," + req.SHIPFROM.ZIPCODE + "," + req.SHIPFROM.COUNTRY,
            req.SHIPFROM.PHONE
        ],
        shipTo: [
            req.SHIPTO.COMPANY,
            req.SHIPTO.ADDRESS_LINE1,
            req.SHIPTO.ADDRESS_LINE2,
            req.SHIPTO.CITY + "," + req.SHIPTO.STATE + "," + req.SHIPTO.ZIPCODE + "," + req.SHIPTO.COUNTRY,
            req.SHIPTO.PHONE
        ]
    };

    const doc = new PDFDocument({
        size: "A4",
        margin: 20
    });

    const buffers = [];
    doc.on("data", buffers.push.bind(buffers));

    // ---------- HEADER ----------
    doc
        .fontSize(22)
        .font("Helvetica-Bold")
        .text("Bill of Lading", 20, 20);

    doc
        .fontSize(10)
        .font("Helvetica")
        .text(`Ship Date: ${HEADER_INFO.SHIP_DATE}`, 400, 25)
        .text(`BOL Number: ${data.bolNumber}`, 400, 40);

    // ---------- MAIN BOX ----------
    drawBox(doc, 20, 50, 555, 330);

    // ---------- SHIP FROM ----------
    drawSectionHeader(doc, "Ship From", 20, 50, 275);
    drawTextBlock(doc, data.shipFrom, 30, 75);

    // ---------- SHIP TO ----------
    drawSectionHeader(doc, "Ship To", 20, 150, 275);
    drawTextBlock(doc, data.shipTo, 30, 175);

    // ---------- Bill TO ----------
    drawSectionHeader(doc, "Bill To", 20, 250, 275);
    drawTextBlock(doc, data.shipFrom, 30, 275);

    // ---------- RIGHT SIDE INFO ----------
    drawBox(doc, 295, 50, 280, 330);

    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("BOL Number:", 305, 60);
    doc.font("Helvetica").text(data.bolNumber, 400, 60);
    // ---------- BARCODE ----------
    const barcode = await bwipjs.toBuffer({
        bcid: "code128",
        text: data.bolNumber,
        scale: 2,
        height: 7,
        includetext: false
    });

    doc.image(barcode, 360, 75, { width: 160 });
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("Carrier Name:", 305, 130);
    doc.font("Helvetica").text(req.CARRIER_DETAILS.CARRIER, 400, 130);
    doc.fontSize(10).font("Helvetica-Bold");
    doc.text("SCAC:", 305, 145);
    doc.font("Helvetica").text(req.CARRIER_DETAILS.CARRIER, 400, 145);
    doc.font("Helvetica-Bold").text("Trailer #:", 305, 160);
    doc.font("Helvetica").text(data.trailer || "N/A", 400, 160);
    doc.font("Helvetica-Bold").text("Pro Number:", 305, 175);
    doc.font("Helvetica").text(data.pro || "N/A", 400, 175);
    // ---------- PRO BARCODE ----------
    const barcode1 = await bwipjs.toBuffer({
        bcid: "code128",
        text: HEADER_INFO?.MASTER_TRACKING_NUMBER || '',
        scale: 2,
        height: 7,
        includetext: false
    });

    doc.image(barcode1, 360, 190, { width: 160 });
    doc.font("Helvetica-Bold").text("Customer PO#:", 305, 240);
    doc.font("Helvetica").text(data.po || "N/A", 400, 240);


    doc.moveTo(295, 290).lineTo(575, 290).stroke();
    doc.font("Helvetica")
        .text(`Freight Charge Terms: (Freight charges are prepaid unless marked otheriwse)`, 300, 295);
    // doc.font("Helvetica-Bold")
    //     .text(`Prepaid              Collect                3rd Party `, 300, 330);
    const paymentType = req.CARRIER_DETAILS?.PAYMENT_TYPE?.toLowerCase() || "";
    drawpaymentCheckbox(doc, 310, 325, "Prepaid", paymentType === "sender");
    drawpaymentCheckbox(doc, 400, 325, "Collect", paymentType === "receiver");
    drawpaymentCheckbox(doc, 490, 325, "3rd Party", paymentType === "third party");
    doc.moveTo(20, 345).lineTo(575, 345).stroke();
    // ---------- HANDLING UNIT TABLE ----------
    //drawBox(doc, 20, 340, 555, 60);
    // drawSectionHeader(doc, "Special Instructions", 20, 340, 555);
    doc.font("Helvetica-Bold")
        .text(`Special Instructions: ${HEADER_INFO.NOTES}`, 20, 350);
    drawBox(doc, 20, 380, 555, 150);
    drawSectionHeader(doc, "Carrier Information", 20, 380, 555);
    drawTableHeader(doc, 400);
    drawTableRows(doc, req.PACKAGES, 425);

    // ---------- TOTAL WEIGHT ----------
    doc.font("Helvetica-Bold")
        .text(`TOTAL WEIGHT: ${HEADER_INFO.TOTAL_WEIGHT}`, 450, 560);

    BOTTOM_Y = drawmiddleBottomSection(doc, BOTTOM_Y);
    drawBottomSection(doc);


    doc.end();

    const pdfBuffer = await new Promise(resolve =>
        doc.on("end", () => resolve(Buffer.concat(buffers)))
    );
    fs.writeFileSync("./Labels/bol.pdf", pdfBuffer);
    return {
        DOC_PROVIDER: 'GENERIC',
        CONTENT_TYPE: 'BOL',
        COPIES_TO_PRINT: '1',
        DOC_NAME: `${HEADER_INFO?.MASTER_TRACKING_NUMBER}.PDF`,
        ENCODED_LABEL: pdfBuffer.toString("base64"),
        DOC_TYPE: 'PDF'
    };
}

function drawmiddleBottomSection(doc, y) {

    const startX = 20;
    const midX = 295;
    const startY = y;
    const totalWidth = 555;
    // -------- Middle Box --------

    const botdata = {

        leftdec: [
            `RECEIVED, subject to individually determined rates or contracts that have
been agreed upon in writing between the carrier and shipper, if
applicable, otherwise to the rates, classifications and rules that have been
established by the carrier and are available to the shipper, on request,
        and to all applicable state and federal regulations.`
        ],
        rightdesc: [
            `The carrier shall not make delivery of this shipment without payment of
freight and all other lawful charges.
  

--------------------------------------------------- Shipper Signature`
        ]
    };

    boldBox(doc, startX, startY, totalWidth, ROW_HEIGHT);
    drawgenericTextBlock(doc, botdata.leftdec, 25, startY + 5);
    thinLine(doc, midX, startY, midX, startY + ROW_HEIGHT);
    drawgenericTextBlock(doc, botdata.rightdesc, 300, startY + 5);
    // -------- Section Titles --------
    doc.font("Helvetica-Bold").fontSize(10);

    return startY + ROW_HEIGHT;
}
function drawBottomSection(doc) {


    const startX = 20;
    const startY = BOTTOM_Y;
    const totalWidth = 555;
    const colWidth = totalWidth / 6;
    const COLS = {
        left: 165,
        mid1: 155
        //right: 205
    };
    // -------- bottom Box --------
    boldBox(doc, startX, startY, totalWidth, 120); // ✅ bold like others

    // -------- Vertical Columns --------
    let x = startX;
    Object.values(COLS).forEach(w => {
        x += w;
        doc.moveTo(x, startY).lineTo(x, startY + 120).stroke();
    });

    // -------- Section Titles --------
    doc.font("Helvetica-Bold").fontSize(9);
    doc.text("Trailer Loaded:", startX + COLS.left, startY + 5);
    doc.text("Freight Counted", startX + COLS.left + 75, startY + 5);

    // -------- Checkbox Layout --------
    drawCheckbox(doc, COLS.left + 25, startY + 30, "By Shipper");
    drawCheckbox(doc, COLS.left + 25, startY + 50, "By Driver");

    drawCheckbox(doc, COLS.left + 95, startY + 30, "By Shipper");
    drawCheckbox(doc, COLS.left + 95, startY + 50, "By Driver /Pallets");
    drawCheckbox(doc, COLS.left + 95, startY + 70, "By Driver Pieces");

    doc.font("Helvetica").fontSize(8);
    doc.moveTo(25, startY + 100).lineTo(90, startY + 100).stroke();
    doc.text("This is to certify that the above named", 25, startY + 10);
    doc.text("materials are properly classified, described,", 25, startY + 20);
    doc.text("packaged, marked and labeled and are in", 25, startY + 30);
    doc.text("proper condition for transportation according", 25, startY + 40);
    doc.text("to the applicable regulations of U.S. DOT", 25, startY + 50);
    doc.text("Carrier acknowledges receipt of pakages and required placards.", 343, startY + 10);
    doc.text("Carrier certifies emergency response information was made", 345, startY + 20);
    doc.text("available and/or carrier has the DOT emergency response", 345, startY + 30);
    doc.text("guidebook or equivalent documentation in the vehicle.Property", 345, startY + 40);
    doc.text("described above is received in good order, except as noted.", 345, startY + 50);
    doc.text("Shipper Signature", 25, startY + 105);
    doc.moveTo(120, startY + 100).lineTo(180, startY + 100).stroke();
    doc.text("Date", startX + colWidth + 10, startY + 105);
    doc.moveTo(370, startY + 100).lineTo(440, startY + 100).stroke();
    doc.text("Carrier Signature", colWidth * 4, startY + 105);
    doc.moveTo(480, startY + 100).lineTo(540, startY + 100).stroke();
    doc.text("Pickup Date", 25 + colWidth * 5, startY + 105);
}

function drawCheckbox(doc, x, y, label) {
    doc.rect(x, y, 10, 10).stroke();
    doc.font("Helvetica").fontSize(8).text(label, x + 15, y);
}

function drawpaymentCheckbox(doc, x, y, label, checked = false) {
    doc.rect(x, y, 10, 10).stroke();
    if (checked) {
        doc
            .moveTo(x + 2, y + 5)
            .lineTo(x + 4, y + 8)
            .lineTo(x + 8, y + 2)
            .stroke();
    }
    // Draw label
    doc
        .font("Helvetica-Bold")
        .fontSize(9)
        .text(label, x + 15, y);
}

function drawBox(doc, x, y, w, h) {
    boldBox(doc, x, y, w, h)
}

function drawSectionHeader(doc, title, x, y, w) {
    doc.save();
    // Light gray	#777777	Soft
    // Medium light	#666666	Balanced ✅
    // Very light	#999999	Subtle
    // Ultra light	#CCCCCC	Very soft
    doc
        .fillColor("#CCCCCC")   // background
        .strokeColor("#000000") // border (black)
        .lineWidth(1)
        .rect(x, y, w, 20)
        .fillAndStroke();

    doc
        .fillColor("black")
        .font("Helvetica-Bold")
        .fontSize(11)
        .text(title, x + 50, y + 5);

    doc.restore();
}

function drawTextBlock(doc, lines, x, y) {
    doc.font("Helvetica").fontSize(10);
    lines.forEach((line, i) => {
        doc.text(line, x, y + i * 14);
    });
}
function drawgenericTextBlock(doc, lines, x, y) {
    doc.font("Helvetica").fontSize(8);
    lines.forEach((line, i) => {
        doc.text(line, x, y + i * 12);
    });
}


function drawTableHeader(doc, y) {
    doc.font("Helvetica-Bold").fontSize(10);

    doc.text("Qty", 30, y + 5);
    doc.text("Type", 70, y + 5);
    doc.text("Wt", 140, y + 5);
    doc.text("Hzmt", 190, y + 5);
    doc.text("Description", 250, y + 5);
    thinLine(doc, 20, y + 15, 575, y + 15);

}

function drawTableRows(doc, rows, startY) {
    let y = startY;

    doc.font("Helvetica").fontSize(10);

    rows.forEach((row, index) => {

        // Optional row separator
        if (index !== 0) {
            lightLine(doc, 20, y - 5, 575, y - 5);
        }
        doc.fillColor("black");
        doc.text(row.QUANTITY || 1, 30, y);
        doc.text(row.HANDLING_UNIT_TYPE || "", 70, y);
        doc.text(row.WEIGHT || "", 140, y);
        doc.text(row?.HAZMAT || false, 190, y);
        doc.text(row.DESCRIPTION || "", 250, y, { width: 300 });

        y += 20;

        // 🔴 Page overflow safety (important for real BOLs)
        if (y > 520) { //450
            doc.addPage();
            y = 50;

            // Redraw table header on new page
            drawTableHeader(doc, y);
            y += 25;
        }
    });
}



module.exports = { generateBOLPdf }
