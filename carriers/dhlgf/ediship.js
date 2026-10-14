// carriers/dhlgf/ediship.js
//
// DHL Global Forwarding — EDI Ship handler.
// Builds an X12 4010 EDI 204 (Motor Carrier Load Tender) payload from our
// standard ShipRequest JSON and returns it in the unified RESPONSE shape used
// by every other carrier in this engine (so the controller treats it just
// like FedEx/UPS API responses).
//
// Spec reference: ASC X12 4010 - 204 Motor Carrier Load Tender
// Segment order:
//   ISA -> GS -> ST -> B2 -> B2A -> L11* -> G62 -> MS3 -> NTE* -> N7
//   -> N1 loop (SH / CN / BT)
//   -> S5 loop (stop-off)  [L11, G62, AT8, NTE, N1 loop, OID*, L5*]
//   -> L3 -> SE -> GE -> IEA
//
// Author: SIG Shipping Engine

const fs = require('fs');
const path = require('path');
const { buildFinalResponse } = require('../../Reuse/responseBuilder');

module.exports = async (request, chargeCodes) => {
    if (typeof request === 'string') request = JSON.parse(request);

    const FINALRESPONSE = buildFinalResponse(request);
    FINALRESPONSE.CARRIER = 'DHLGF';

    try {
        const { edi, controlNumber, fileName } = buildEDI204(request);

        // Optionally drop the EDI file on disk for FTP pickup (mirrors edi/edi.js style)
        try {
            const outDir = process.env.DHLGF_EDI_OUT_DIR
                || path.join(__dirname, '..', '..', 'XMLS', 'DHLGF_EDI204');
            fs.mkdirSync(outDir, { recursive: true });
            fs.writeFileSync(path.join(outDir, fileName), edi, 'utf8');
        } catch (fsErr) {
            console.warn('[DHLGF-EDI204] could not persist EDI file:', fsErr.message);
        }

        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'TENDERED';
        FINALRESPONSE.SERVICE_CODE = request?.CARRIER_DETAILS?.SERVICE_CODE || 'EDI204';
        FINALRESPONSE.SERVICE_NAME = request?.CARRIER_DETAILS?.SERVICE_NAME || 'DHL GF Load Tender';
        FINALRESPONSE.CURRENCY = request?.HEADER_INFO?.CURRENCY || 'USD';

        // surface EDI metadata so caller can FTP / archive / preview it
        FINALRESPONSE.EDI = {
            TRANSACTION_SET: '204',
            CONTROL_NUMBER: controlNumber,
            FILE_NAME: fileName,
            PAYLOAD: edi
        };

        // attach EDI text as a "shipping document" for parity with API flow
        FINALRESPONSE.SHIPPING_DOCUMENTS.push({
            DOC_PROVIDER: 'SIG',
            CONTENT_TYPE: 'text/plain',
            COPIES_TO_PRINT: 0,
            DOC_NAME: fileName,
            ENCODED_LABEL: Buffer.from(edi, 'utf8').toString('base64'),
            DOC_TYPE: 'EDI_204'
        });

        // mirror Master tracking number → EDI shipment id
        FINALRESPONSE.HEADER_INFO.MASTER_TRACKING_NUMBER =
            request?.EDI204_HEADER?.SHIPMENT_ID
            || request?.HEADER_INFO?.DOCUMENT_NUMBER
            || controlNumber;

        return FINALRESPONSE;
    } catch (ex) {
        console.error('[DHLGF-EDI204] build error:', ex);
        FINALRESPONSE.STATUS = 'Error';
        FINALRESPONSE.ERRORS.push(ex.message || 'EDI 204 build failure');
        return FINALRESPONSE;
    }
};

/* =====================================================
   EDI 204 BUILDER
===================================================== */

function buildEDI204(payload) {
    const env = payload.EDI_ENVELOPE || {};
    const head = payload.EDI204_HEADER || {};
    const carrier = payload.CARRIER_DETAILS || {};
    const shipper = payload.SHIPPER || payload.SHIPFROM || {};
    const consignee = payload.SHIPTO || {};
    const billTo = payload.BILLTO || payload.SOLDTO || {};
    const stops = Array.isArray(payload.STOPS) && payload.STOPS.length
        ? payload.STOPS
        : defaultStopsFrom(shipper, consignee, payload);
    const pkgs = payload.PACKAGES || [];

    /* ----- ENVELOPE DEFAULTS ----- */
    const elem = env.ELEMENT_SEPARATOR || '*';
    const segTerm = env.SEGMENT_TERMINATOR || '~';
    const compSep = env.COMPONENT_SEPARATOR || '>';
    const usage = env.USAGE_INDICATOR || 'T';
    const isaVer = env.INTERCHANGE_VERSION || '00401';
    const gsVer = env.VERSION_RELEASE || '004010';
    const funcId = env.FUNCTIONAL_ID_CODE || 'SM';

    const isaSendQ = env.ISA_SENDER_QUALIFIER || 'ZZ';
    const isaSend = padRight(env.ISA_SENDER_ID || '', 15);
    const isaRecvQ = env.ISA_RECEIVER_QUALIFIER || 'ZZ';
    const isaRecv = padRight(env.ISA_RECEIVER_ID || 'DHLGF', 15);

    const isaCtrl = padLeft(env.ISA_CONTROL_NUMBER || randomCtrl(), 9, '0');
    const gsCtrl = (env.GS_CONTROL_NUMBER || stripLeadZeros(isaCtrl) || '1').toString();
    const stCtrl = padLeft(gsCtrl, 4, '0');

    const { ediDate, ediTime, gsDate } = nowEDI();

    /* ----- WRITE SEGMENTS ----- */
    const seg = new SegmentBuilder(elem, segTerm);

    // ISA - Interchange Control Header
    seg.write([
        'ISA',
        '00', padRight('', 10),
        '00', padRight('', 10),
        isaSendQ, isaSend,
        isaRecvQ, isaRecv,
        ediDate.slice(2),       // YYMMDD
        ediTime,                // HHMM
        'U',
        isaVer,
        isaCtrl,
        '0',
        usage,
        compSep
    ]);

    // GS - Functional Group Header
    seg.write([
        'GS',
        funcId,
        env.GS_SENDER_ID || env.ISA_SENDER_ID || 'PLUTOCLOUD',
        env.GS_RECEIVER_ID || env.ISA_RECEIVER_ID || 'DHLGF',
        gsDate,
        ediTime,
        gsCtrl,
        'X',
        gsVer
    ]);

    // ST - Transaction Set Header
    seg.write(['ST', '204', stCtrl]);

    // B2 - Beginning Segment for Shipment Information Transaction
    seg.write([
        'B2',
        '',
        head.STANDARD_CARRIER_ALPHA_CODE || carrier.SCAC || 'DHLG',
        '',
        head.SHIPMENT_ID || payload.HEADER_INFO?.DOCUMENT_NUMBER || 'SHIP' + isaCtrl,
        '',// WEIGHT UNIT
        head.SHIPMENT_METHOD_OF_PAYMENT || 'PP',
        head.SHIPMENT_QUALIFIER || 'L'
    ]);

    // B2A - Set Purpose: 00=Original, 01=Cancel, 04=Change, 05=Replace
    seg.write(['B2A', head.PURPOSE_CODE || '00', 'LT']);

    // L11 - Reference Numbers
    const refs = Array.isArray(head.REFERENCE_NUMBERS) ? head.REFERENCE_NUMBERS.slice() : [];
    if (payload.HEADER_INFO?.PO_NUMBER) refs.push({ QUALIFIER: 'PO', VALUE: payload.HEADER_INFO.PO_NUMBER });
    if (payload.HEADER_INFO?.CUSTOMER_REFERENCE) refs.push({ QUALIFIER: 'CR', VALUE: payload.HEADER_INFO.CUSTOMER_REFERENCE });
    if (payload.HEADER_INFO?.INVOICE_NUMBER) refs.push({ QUALIFIER: 'IV', VALUE: payload.HEADER_INFO.INVOICE_NUMBER });
    refs.forEach(r => {
        if (r?.VALUE) seg.write(['L11', clip(r.VALUE, 30), r.QUALIFIER || 'ZZ']);
    });

    // G62 - Pickup Ready Date
    const shipDate = payload.HEADER_INFO?.SHIP_DATE
        ? toEDIDate(payload.HEADER_INFO.SHIP_DATE)
        : gsDate;
    seg.write(['G62', '10', shipDate]);

    // MS3 - Interline Information
    seg.write([
        'MS3',
        head.STANDARD_CARRIER_ALPHA_CODE || '',
        head.MODE_OF_TRANSPORT || 'B'
    ]);

    // NTE - Special Instructions
    if (payload.HEADER_INFO?.NOTES) {
        seg.write(['NTE', 'GEN', clip(payload.HEADER_INFO.NOTES, 80)]);
    }

    // N7 - Equipment Details
    if (head.EQUIPMENT_NUMBER || head.EQUIPMENT_DESC_CODE) {
        seg.write([
            'N7',
            '',
            head.EQUIPMENT_NUMBER || '',
            '', '', '', '', '', '', '',
            head.EQUIPMENT_DESC_CODE || 'TL'
        ]);
    }

    /* ----- N1 LOOP : SHIPPER / CONSIGNEE / BILL-TO ----- */
    writeN1Loop(seg, 'SH', shipper);
    writeN1Loop(seg, 'CN', consignee);
    if (hasAddress(billTo)) writeN1Loop(seg, 'BT', billTo);

    /* ----- S5 LOOP : STOP-OFFS ----- */
    stops.forEach((stop, idx) => writeStop(seg, stop, idx + 1, head));

    /* ----- L3 - Total Weight & Charges ----- */
    const totals = computeTotals(pkgs, head);
    seg.write([
        'L3',
        totals.weight ? totals.weight.toFixed(2) : '',
        totals.weight ? (head.WEIGHT_UNIT || 'G') : '',
        '', '', '', '',
        totals.pieces || '',
        '',
        totals.volume ? totals.volume.toFixed(2) : '',
        totals.volume ? (head.VOLUME_UNIT || 'C') : ''
    ]);

    // SE / GE / IEA Trailers
    const segCount = seg.countSince('ST') + 1;
    seg.write(['SE', String(segCount), stCtrl]);
    seg.write(['GE', '1', gsCtrl]);
    seg.write(['IEA', '1', isaCtrl]);

    const edi = seg.toString();
    const fileName = `DHLGF_204_${isaCtrl}_${gsDate}${ediTime}.edi`;
    return { edi, controlNumber: isaCtrl, fileName };
}

/* =====================================================
   N1 LOOP WRITER
===================================================== */

function writeN1Loop(seg, entityCode, addr) {
    if (!addr) return;
    seg.write([
        'N1',
        entityCode,
        clip(addr.COMPANY || addr.NAME || '', 60),
        addr.ID_QUALIFIER || '',
        addr.ACCOUNT_NO || addr.ACCOUNT || addr.TAXID || ''
    ]);
    if (addr.CONTACT || addr.ADDRESS_LINE2) {
        seg.write(['N2',
            clip(addr.CONTACT || '', 60),
            clip(addr.ADDRESS_LINE2 || '', 60)
        ]);
    }
    if (addr.ADDRESS_LINE1) {
        seg.write(['N3',
            clip(addr.ADDRESS_LINE1, 55),
            clip(addr.ADDRESS_LINE3 || '', 55)
        ]);
    }
    seg.write([
        'N4',
        clip(addr.CITY || '', 30),
        (addr.STATE || '').trim(),
        clip(addr.ZIPCODE || addr.ZipCode || addr.POSTAL_CODE || '', 15),
        clip(addr.COUNTRY || '', 3)
    ]);
    if (addr.CONTACT || addr.PHONE || addr.EMAIL) {
        const per = ['PER', 'IC', clip(addr.CONTACT || '', 60)];
        if (addr.PHONE) per.push('TE', clip(addr.PHONE, 20));
        if (addr.EMAIL) {
            while (per.length < 6) per.push('');
            per.push('EM', clip(addr.EMAIL, 80));
        }
        seg.write(per);
    }
}

/* =====================================================
   S5 STOP LOOP WRITER
===================================================== */

function writeStop(seg, stop, defaultSeq, head) {
    const seqNo = stop.STOP_SEQUENCE || defaultSeq;
    const reason = stop.STOP_REASON || (defaultSeq === 1 ? 'LD' : 'UL');

    seg.write([
        'S5',
        String(seqNo),
        reason,
        stop.WEIGHT ? String(stop.WEIGHT) : '',
        stop.WEIGHT ? (stop.WEIGHT_UNIT || head.WEIGHT_UNIT || 'L') : '',
        stop.VOLUME ? String(stop.VOLUME) : '',
        stop.VOLUME ? (stop.VOLUME_UNIT || head.VOLUME_UNIT || 'E') : '',
        '',
        '',
        stop.PIECES ? String(stop.PIECES) : ''
    ]);

    if (stop.REFERENCE) seg.write(['L11', clip(stop.REFERENCE, 30), stop.REFERENCE_QUALIFIER || 'CR']);

    if (stop.STOP_DATE) {
        seg.write([
            'G62',
            reason === 'LD' || reason === 'CL' ? '10' : '02',
            toEDIDate(stop.STOP_DATE),
            stop.STOP_TIME ? '1' : '',
            stop.STOP_TIME ? padLeft(stop.STOP_TIME.replace(':', ''), 4, '0') : ''
        ]);
    }

    if (stop.PIECES || stop.WEIGHT) {
        seg.write([
            'AT8',
            'G',
            stop.WEIGHT_UNIT || head.WEIGHT_UNIT || 'L',
            stop.WEIGHT ? String(stop.WEIGHT) : '',
            stop.PIECES ? String(stop.PIECES) : ''
        ]);
    }

    if (stop.NOTES) seg.write(['NTE', 'OTH', clip(stop.NOTES, 80)]);

    if (stop.ADDRESS && hasAddress(stop.ADDRESS)) {
        const code = reason === 'LD' || reason === 'CL' ? 'SF' : 'ST';
        writeN1Loop(seg, code, stop.ADDRESS);
    }

    (stop.ORDER_DETAILS || []).forEach(order => {
        seg.write([
            'OID',
            '',
            clip(order.ORDER_ID || '', 30),
            '',
            order.PIECES ? String(order.PIECES) : '',
            'G',
            order.WEIGHT ? String(order.WEIGHT) : '',
            order.WEIGHT ? (order.WEIGHT_UNIT || head.WEIGHT_UNIT || 'L') : ''
        ]);
        if (order.DESCRIPTION || order.COMMODITY) {
            seg.write([
                'L5',
                '1',
                clip(order.DESCRIPTION || '', 50),
                order.COMMODITY || '',
                order.COMMODITY ? 'C' : ''
            ]);
        }
    });
}

/* =====================================================
   HELPERS
===================================================== */

class SegmentBuilder {
    constructor(elementSep, segTerm) {
        this.elem = elementSep;
        this.term = segTerm;
        this.lines = [];
    }
    write(parts) {
        while (parts.length > 1 && (parts[parts.length - 1] === '' || parts[parts.length - 1] == null)) {
            parts.pop();
        }
        this.lines.push(parts.join(this.elem) + this.term);
    }
    countSince(tag) {
        let started = false, n = 0;
        for (const ln of this.lines) {
            if (ln.startsWith(tag + this.elem) || ln.startsWith(tag + this.term)) started = true;
            if (started) n++;
        }
        return n;
    }
    toString() { return this.lines.join('\n'); }
}

function padRight(s, len, c = ' ') {
    s = String(s ?? '');
    if (s.length >= len) return s.slice(0, len);
    return s + c.repeat(len - s.length);
}
function padLeft(s, len, c = '0') {
    s = String(s ?? '');
    if (s.length >= len) return s.slice(-len);
    return c.repeat(len - s.length) + s;
}
function clip(s, max) {
    s = String(s ?? '');
    return s.length > max ? s.slice(0, max) : s;
}
function stripLeadZeros(s) { return String(s).replace(/^0+/, '') || '0'; }
function randomCtrl() { return String(Math.floor(100000000 + Math.random() * 900000000)); }

function nowEDI() {
    const d = new Date();
    const yyyy = d.getUTCFullYear();
    const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
    const dd = String(d.getUTCDate()).padStart(2, '0');
    const hh = String(d.getUTCHours()).padStart(2, '0');
    const mi = String(d.getUTCMinutes()).padStart(2, '0');
    return {
        ediDate: `${yyyy}${mm}${dd}`,
        gsDate: `${yyyy}${mm}${dd}`,
        ediTime: `${hh}${mi}`
    };
}

function toEDIDate(s) {
    if (!s) return '';
    const d = (s instanceof Date) ? s : new Date(s);
    if (!isNaN(d.getTime())) {
        return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`;
    }
    return String(s).replace(/[^0-9]/g, '').slice(0, 8);
}

function hasAddress(a) {
    return !!(a && (a.COMPANY || a.ADDRESS_LINE1 || a.CITY));
}

function defaultStopsFrom(shipper, consignee, payload) {
    const head = payload.EDI204_HEADER || {};
    const totals = computeTotals(payload.PACKAGES || [], head);
    return [
        {
            STOP_SEQUENCE: 1,
            STOP_REASON: 'LD',
            ADDRESS: shipper,
            STOP_DATE: payload.HEADER_INFO?.SHIP_DATE,
            WEIGHT: totals.weight,
            WEIGHT_UNIT: head.WEIGHT_UNIT || 'L',
            PIECES: totals.pieces
        },
        {
            STOP_SEQUENCE: 2,
            STOP_REASON: 'UL',
            ADDRESS: consignee,
            WEIGHT: totals.weight,
            WEIGHT_UNIT: head.WEIGHT_UNIT || 'L',
            PIECES: totals.pieces
        }
    ];
}

function computeTotals(pkgs, head) {
    let weight = 0, volume = 0, pieces = 0;
    (pkgs || []).forEach(p => {
        const w = parseFloat(p.WEIGHT);
        const q = parseInt(p.QUANTITY || 1, 10) || 1;
        if (!isNaN(w)) weight += w * q;
        pieces += q;
        if (p.DIMENSION) {
            const dims = String(p.DIMENSION).split(/[xX*]/).map(parseFloat);
            if (dims.length === 3 && dims.every(d => !isNaN(d))) {
                const cubic = dims[0] * dims[1] * dims[2];
                volume += (p.DIMENSION_UNITS === 'CM' ? cubic / 1000000 : cubic / 1728) * q;
            }
        }
    });
    return { weight, volume, pieces };
}

// expose builder for unit tests
module.exports.buildEDI204 = buildEDI204;
