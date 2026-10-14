const express = require('express');
const axios = require('axios');
const dbCon = require("../database/dbsaveandupdate.js");
const { readEdiFromFTP } = require('../Reuse/readEdiFromFTP.js');
const { TMSInvoicePOSTxml, getFreightOrder, yyyymmddToIso, toNum, getsapchargecode } = require('./TMSInvoice_POST_xmlrequest.js');
const { v4: uuidv4 } = require("uuid");
require("dotenv").config();



async function processUPSEDIInvoice() {
  try {

    const ediText = await readEdiFromFTP();
    if (!ediText) return;

    const xml = await buildSoapFromUPS210(ediText);
    return await TMSInvoicePOSTxml(xml)
  } catch (error) {
    console.error('Unexpected Error:', error);
    return error.message;
  }
}

/**
 * Build SOAP XML string.
 * @param {string} ediText
 * @param {object} opts  { strCurrency?: string (override), chargeCodes?: Map, freightByTrackingNo?: Map, getFreightOrder?: fn }
 */
async function buildSoapFromUPS210(ediText) {
  const { segs } = parseSegments(ediText);
  const hdr = extractHeader(segs);
  const shipments = extractShipments(segs);
  const strCurrency = hdr.currency;
  let totalGross = 0;

  const chargeCodes = await dbCon.fetchINVChargeCodes('UPS'); //from db

  let xml = `
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" xmlns:edi="http://sap.com/xi/EDI">
  <soapenv:Header xmlns:wsa="http://www.w3.org/2005/08/addressing">
    <wsa:Action>http://sap.com/xi/EDI/Buyer/InvoiceRequest_In/InvoiceRequest_InRequest</wsa:Action>
    <wsa:MessageID>uuid:${uuidv4()}</wsa:MessageID>
    <wsa:To>https://PCS4H2022.plutocloud.com:8443/sap/bc/srt/xip/sap/invoicerequest_in/800/tminv/invbind</wsa:To>
  </soapenv:Header>
  <soapenv:Body>
    <edi:InvoiceRequest>
      <MessageHeader>
        <CreationDateTime>${hdr.creationDateTime}</CreationDateTime>
      </MessageHeader>
      <Invoice>
        <SupplierInvoiceID>${hdr.invoiceId}</SupplierInvoiceID>
        <SupplierInvoiceTypeCode>004</SupplierInvoiceTypeCode>
        ${hdr.invoiceDate ? `<DocumentDate>${hdr.invoiceDate}</DocumentDate>` : ''}`.trim();

  // items from LX loops
  for (const [idx, ship] of shipments.entries()) {
    const { netAmount, base400, extras } = extractMonetariesFromL1s(ship.l1);

    // Update header total if we got a net line; otherwise sum known parts
    const itemNet = (netAmount != null)
      ? netAmount
      : ((base400 ?? 0) + extras.reduce((s, e) => s + (e.amount ?? 0), 0));

    totalGross += (itemNet || 0);

    // FO reference via map or async call
    const tracking = ship.trackingNo ? String(ship.trackingNo).trim() : null;
    if (tracking) {


      const fo = await dbCon.getHeaderInfosByTrackingNos(tracking);
      let freightDocumentID = fo?.DocumentNumber;
      if (!freightDocumentID && tracking) {
        try { freightDocumentID = await getFreightOrder(tracking); } catch { }
      }

      try {
        let fullDetails = ship
        fullDetails.netAmount = netAmount;
        fullDetails.base400 = base400;
        fullDetails.extras = extras;
        const logEntry = {
          invoicedate: hdr.invoiceDate,
          carrier: 'UPS',
          details: fullDetails,
          reference: 'C:/savedpath/invoice123.json',
        };
        const uniqueid = await dbCon.dbSAP_INVOICE_save(logEntry);
        console.log('Saved item with id:', uniqueid);
      } catch (error) {
        console.error('Error saving child record:', error);
      }

      // build item XML
      xml += `
        <Item>
          <SupplierInvoiceItemID>${String(idx + 1).padStart(4, '0')}</SupplierInvoiceItemID>
          <SupplierInvoiceItemTypeCode/>
          <NetAmount currencyCode="${strCurrency}">${(itemNet ?? 0).toFixed(2)}</NetAmount>`;

      // Base transportation ("weight") from 400
      if (base400 != null) {
        xml += `
          <PricingElement>
            <SupplierConditionType>FRT</SupplierConditionType>
            <ConditionAmount currencyCode="${strCurrency}">${base400.toFixed(2)}</ConditionAmount>
          </PricingElement>`;
      }

      // Extras → PricingElement blocks
      for (const ex of extras) {
        const cond = getsapchargecode(ex.code, chargeCodes) || ex.code;

        // Convert amount to number safely
        const amt = Number(ex.amount);
        const formattedAmt = isNaN(amt) ? '0.00' : amt.toFixed(2);
        xml += `
          <PricingElement>
            <SupplierConditionType>${cond}</SupplierConditionType>
            <ConditionAmount currencyCode="${strCurrency}">${formattedAmt}</ConditionAmount>
          </PricingElement>`;
      }

      xml += `
          <TransportationOrderReference>
            <TransportationOrderID>${freightDocumentID || ''}</TransportationOrderID>
          </TransportationOrderReference>
        </Item>`;
    }

    // footer / party
    xml += `
        <GrossAmount currencyCode="${strCurrency}">${totalGross.toFixed(2)}</GrossAmount>
        <Party PartyType="BillFrom">
          <BuyerPartyID>UPSR</BuyerPartyID>
          <SupplierPartyID/>
        </Party>
      </Invoice>
    </edi:InvoiceRequest>
  </soapenv:Body>
</soapenv:Envelope>`;
  }


  return xml;
}

/**
 * Detect separators and split into segments/elements.
 * Works with your file where segments end with '|' and elements are '~'.
 */
function parseSegments(ediText) {
  const elemSep = ediText[3];            // X12: element separator is right after "ISA"
  const segTerm = ediText.includes('|')  // your sample uses '|' as segment terminator
    ? '|'
    : (ediText.includes('~ST') ? '~' : '\n');

  const rawSegs = ediText.split(segTerm).map(s => s.trim()).filter(Boolean);
  const segs = rawSegs.map(s => s.split(elemSep).map(e => e.trim()));
  return { segs, elemSep, segTerm };
}

/**
 * Extract header fields from 210:
 * - invoiceId: prefer L11 (E8) else B3-03
 * - invoiceDate: from L11 (E8 date) else B3 date
 * - currency: from C3-02 (e.g., CAD)
 * - creationDateTime: from ISA/GS timestamps
 */
function extractHeader(segs) {
  // currency
  const c3 = firstSeg(segs, 'C3');
  const currency = c3?.[1] || 'USD';

  // invoice from L11~<id>~E8~~<date>
  const l11E8 = allSeg(segs, 'L11').find(s => s?.[2] === 'E8');
  const l11InvoiceId = l11E8?.[1];
  const l11InvoiceDate = l11E8?.[4];

  // B3 fallback (B3-03 commonly carries invoice/shipment id)
  const b3 = firstSeg(segs, 'B3');
  const b3InvoiceId = b3?.[2] || b3?.[3];
  const b3Date = b3?.[6]; // yyyymmdd

  // ISA date/time YYMMDD / HHMM
  const isa = firstSeg(segs, 'ISA');
  const isaDateYYMMDD = isa?.[9];
  const isaTimeHHMM = isa?.[10];
  const creationDateTime =
    (isaDateYYMMDD && isaTimeHHMM)
      ? formatIsaDateTime(isaDateYYMMDD, isaTimeHHMM)
      : new Date().toISOString();

  return {
    currency,
    invoiceId: l11InvoiceId || b3InvoiceId || 'UNKNOWN',
    invoiceDate: (l11InvoiceDate || b3Date) ? yyyymmddToIso(l11InvoiceDate || b3Date) : null,
    creationDateTime
  };
}


/**
 * Group shipments by LX loop. Each LX typically represents a shipment/package group.
 * Capture:
 *  - trackingNo (from L11~<1Z...>~CN)
 *  - cb/cn combos if present
 *  - L1 lines for charge extraction
 */
function extractShipments_OLD(segs) {
  const result = [];
  let current = null;

  for (const s of segs) {
    const tag = s[0];

    if (tag === 'LX') {
      if (current) result.push(current);
      current = { index: s[1], l11: [], l1: [] };
    } else if (tag === 'L11' && current) {
      current.l11.push(s);
    } else if (tag === 'L1' && current) {
      current.l1.push(s);
    }
  }
  if (current) result.push(current);

  // Enrich with tracking no & a few handy fields
  for (const ship of result) {
    const l11CN = ship.l11.find(a => a?.[2] === 'CN'); // tracking
    const l11CB = ship.l11.find(a => a?.[2] === 'CB'); // related
    ship.trackingNo = l11CN?.[1] || l11CB?.[1] || null;
    // some files also carry dates in L11 fourth/fifth element
    ship.eventDate = ship.l11.find(a => a?.[4])?.[4] || null;
  }

  return result;
}

function extractShipments(segs) {
  const result = [];
  let current = null;

  for (const s of segs) {
    const tag = s[0];

    if (tag === 'LX') {
      if (current) result.push(current);
      current = { index: s[1], l11: [], l1: [], n1groups: [] };
      continue;
    }

    if (!current) continue; // ignore segments outside LX blocks

    if (tag === 'L11') {
      current.l11.push(s);
      continue;
    }

    if (tag === 'L1') {
      current.l1.push(s);
      continue;
    }

    // capture N1 / N3 / N4 into the last N1-group
    if (tag === 'N1') {
      // N1~<entityId>~<something>~<qualifier>~<name>
      const entityId = (s[1] || '').trim();
      const qualifier = (s[3] || '').trim();
      const name = (s[4] || '').trim();
      const group = { entityId, qualifier, name, n3: [], n4: null };
      current.n1groups.push(group);
      continue;
    }

    if (tag === 'N3') {
      // N3~addressLine1~addressLine2...
      const addrParts = s.slice(1).map(p => (p || '').trim()).filter(Boolean);
      if (current.n1groups.length) {
        current.n1groups[current.n1groups.length - 1].n3.push(addrParts.join(' | '));
      }
      continue;
    }

    if (tag === 'N4') {
      // N4~City~State~PostalCode~Country
      const [city = '', state = '', postal = '', country = ''] = s.slice(1).map(p => (p || '').trim());
      if (current.n1groups.length) {
        current.n1groups[current.n1groups.length - 1].n4 = { city, state, postal, country };
      }
      continue;
    }

    // ignore other tags
  }

  if (current) result.push(current);

  // Enrich with tracking no & a few handy fields + addresses
  for (const ship of result) {
    const l11CN = ship.l11.find(a => a?.[2] === 'CN'); // tracking
    const l11CB = ship.l11.find(a => a?.[2] === 'CB'); // related
    ship.trackingNo = l11CN?.[1] || l11CB?.[1] || null;
    ship.eventDate = ship.l11.find(a => a?.[4])?.[4] || null;

    // helper to build address object from an N1 group
    function buildAddress(group) {
      if (!group) return null;
      return {
        COMPANY: group.name || null,
        ADDRESS_LINE1: group.n3.length ? group.n3 : null,
        CITY: group.n4?.city || null,
        STATE: group.n4?.state || null,
        ZIPCODE: group.n4?.postal || null,
        COUNTRY: group.n4?.country || null,
        raw_entity_id: group.entityId || null,
        qualifier: group.qualifier || null
      };
    }

    // find SF (ship-from) and ST (ship-to). fallback: first / second N1 group
    const fromGroup = ship.n1groups.find(g => g.entityId === 'SF' || g.qualifier === 'SF')
      || ship.n1groups[0] || null;
    const toGroup = ship.n1groups.find(g => g.entityId === 'ST' || g.qualifier === 'ST')
      || ship.n1groups[1] || ship.n1groups.find(g => g.entityId !== fromGroup?.entityId) || null;

    ship.ShipFrom = buildAddress(fromGroup);
    ship.ShipTo = buildAddress(toGroup);

    // keep raw n1groups for debugging if needed
    // delete ship.n1groups; // uncomment to remove after processing
  }

  return result;
}



/**
 * Find first segment by tag; find all by tag.
 */
const firstSeg = (segs, tag) => segs.find(s => s[0] === tag);
const allSeg = (segs, tag) => segs.filter(s => s[0] === tag);





function formatIsaDateTime(yyMMdd, HHmm) {
  // ISA has YYMMDD (2-digit year). Assume 20xx. Adjust if needed.
  const yy = parseInt(yyMMdd.slice(0, 2), 10);
  const yyyy = (yy >= 70 ? 1900 + yy : 2000 + yy);  // crude pivot
  const mm = yyMMdd.slice(2, 4);
  const dd = yyMMdd.slice(4, 6);
  const hh = HHmm.slice(0, 2);
  const min = HHmm.slice(2, 4);
  // No timezone in EDI; keep Z or set to shipper tz if you know it.
  return `${yyyy}-${mm}-${dd}T${hh}:${min}:00Z`;
}


/**
 * Helpers to extract charges from an L1 segment array
 * Strategy:
 *  - NET/TOA line: last numeric = net amount
 *  - base transport ("weight charge"): amount immediately preceding '400'
 *  - for common codes (FUE/FSC/TAX/HST/GST/AAJ/FAH/ICE/EDS/EDB/REC), take the nearest
 *    numeric to the left of that token.
 */

function lastNumeric(arr) {
  for (let i = arr.length - 1; i >= 0; i--) {
    const n = toNum(arr[i]);
    if (n != null) return n;
  }
  return null;
}
const CHARGE_TOKENS = ['FUE', 'FSC', 'TAX', 'HST', 'GST', 'AAJ', 'FAH', 'ICE', 'EDS', 'EDB', 'REC'];

function amountBeforeToken(arr, token) {
  const idx = arr.findIndex(x => x === token);
  if (idx <= 0) return null;
  for (let i = idx - 1; i >= 0; i--) {
    const n = toNum(arr[i]);
    if (n != null) return n;
  }
  return null;
}

function extractMonetariesFromL1s(l1s) {
  let netAmount = null;
  let base400 = null;
  const extras = []; // { code, amount }

  for (const seg of l1s) {
    // NET/TOA net line
    if (seg.includes('NET')) {
      const hasToa = seg.includes('TOA'); // usually appears with NET
      const val = lastNumeric(seg);
      if (val != null) netAmount = val;
    }

    // "400" -> base transport amount (common in UPS 210)
    if (seg.includes('400')) {
      const idx400 = seg.indexOf('400');
      if (idx400 > 0) {
        const amt = toNum(seg[idx400 - 1]);
        if (amt != null) base400 = (base400 ?? 0) + amt;
      }
    }

    // well-known tokens
    for (const tk of CHARGE_TOKENS) {
      if (seg.includes(tk)) {
        const amt = seg[4];//amountBeforeToken(seg, tk);
        if (amt != null) extras.push({ code: tk, amount: amt });
      }
    }
  }

  return { netAmount, base400, extras };
}


module.exports = {
  processUPSEDIInvoice
};