const db = require('./db');


async function fetchChargeCodes() {

  const checkResult = await db.query(`SELECT details FROM public.chargecodes`); // replace with your query
  return checkResult;
}
async function fetchCarrierServiceCodes() {

  const checkResult = await db.query(`SELECT details FROM public.carrierservices WHERE details->>'IsActive' ='true'`); // replace with your query
  return checkResult;
}
async function fetchCarriers() {

  const checkResult = await db.query(`SELECT details FROM public.carriers WHERE details->>'IsActive' ='true'`); // replace with your query
  return checkResult || [];
}
async function fetchCarrierCredentials() {

  const checkResult = await db.query(`SELECT details FROM public.carrieraccounts WHERE details->>'IsActive' ='true'`); // replace with your query
  return checkResult;
}

async function fetchShippersFromWH() {
  const checkResult = await db.query(`SELECT details FROM public.location WHERE details->>'IsActive' ='true'`); // replace with your query
  return checkResult;

}
async function dbTracksaveandUpdate(request) {
  try {
    const trackingNo = request.XTRACKINGNO;

    const checkQuery = `
      SELECT id, details->>'CarrierStatus' as tracking_status
      FROM public.saptrack
      WHERE details->>'XTRACKINGNO' = $1
      LIMIT 1
    `;

    const checkResult = await db.query(checkQuery, [trackingNo]);

    if (checkResult.length === 0) {
      const insertQuery = `INSERT INTO public.saptrack (details) VALUES (null) RETURNING id`;
      const insertResult = await db.query(insertQuery);
      const newId = insertResult[0].id;
      console.log('Inserted empty record with id:', newId);

      request.id = newId;
      const updateQuery = `UPDATE public.saptrack SET details = $1 WHERE id = $2`;
      await db.query(updateQuery, [request, newId]);
      console.log('Updated shipment details for id:', newId);

      return newId;
    } else {
      const { id, tracking_status } = checkResult[0];

      // if (["DELIVERED", "POD"].includes(tracking_status.toUpperCase())) {
      //   console.log('Shipment already delivered. Ignored.');
      //   return id;
      // } else {
      request.id = id;
      const updateQuery = `UPDATE public.saptrack SET details = $1 WHERE id = $2`;
      await db.query(updateQuery, [request, id]);
      console.log('Updated existing shipment with id:', id);
      return id;
      // }
    }
  } catch (error) {
    console.error("Failed dbTracksaveAndUpdate:", error);
    return '';
  }
}



async function dbBatchShipUpdate(request) {
  try {
    const trackingNumber = request?.Tracking_Number || '';
    const discFreight = request?.Discount_Freight || '';
    const pubFreight = request?.Published_Freight || '';
    const encodedLabel = request?.Base64_encodedLabel || '';
    const labelType = request?.LabelType || '';
    const status = request?.status || null;
    const message = request?.Errormessage || null;
    const id = request?.id;

    if (!id) {
      console.error("dbBatchShipUpdate: MISSING ID → Cannot update record");
      return;
    }
    const updateQuery = `
      UPDATE public.batch_shipments 
      SET 
        details = details::jsonb 
          || jsonb_build_object(
            'Tracking_Number', $1::text,
            'Discount_Freight', $2::text,
            'Published_Freight', $3::text,
            'Base64_encodedLabel', $4::text,
            'LabelType', $5::text,
            'status',$6::text,
            'message',$7::text
          )::jsonb,
        status = $6,
        message = $7
      WHERE id = $8
      RETURNING id;
    `;

    const result = await db.query(updateQuery, [
      trackingNumber, discFreight, pubFreight, encodedLabel, labelType,
      status, message, id
    ]);

    console.log("Updated existing shipment with id:", result[0].id);
    return result[0].id;

  } catch (error) {
    console.error("Failed dbBatchShipUpdate:", error);
    return error.message;
  }
}

async function dbBatchAutomated_statusUpdate(batchid) {
  try {
    const updateQuery = `UPDATE public.automated_shipments SET status = 'In Process' WHERE batchname = $1`;
    const result = await db.query(updateQuery, [batchid]);
  } catch (error) {
    console.error("Failed dbBatchAutomated_statusUpdate:", error);

  }
}

async function dbBatchAutomated_statusUpdateDone(successcount, failed, batchname) {
  try {
    const updateQuery = `UPDATE public.automated_shipments SET status = 'Done', success_count = $1, failed = $2 WHERE batchname = $3 RETURNING op_email`;
    const result = await db.query(updateQuery, [successcount, failed, batchname]);
    // FIX: pg-promise returns rows as a plain array (result[0]), not result.rows.
    return result[0]?.op_email ?? null;
  } catch (error) {
    console.error("Failed dbBatchAutomated_statusUpdateDone:", error);
    throw error;
  }
}

async function dbSAP_TRACK_Delete(trackId) {
  try {
    const deleteQuery = `
      DELETE FROM public.saptrack 
      WHERE details->>'XTRACKINGNO' = $1
      RETURNING id
    `;
    const result = await db.query(deleteQuery, [trackId]);

    if (result.length > 0) {
      console.log('Deleted record with id:', result[0].id);
      return result[0].id;
    } else {
      console.log('No matching record found to delete.');
      return null;
    }
  } catch (error) {
    console.error('Failed to delete record:', error);
    return null;
  }
}

async function getHeaderInfoByTrackingNo(trackingNo) {
  try {
    const hQuery = `
  SELECT details->'HEADER_INFO' as headerinfo
  FROM shipments
  WHERE details->'HEADER_INFO'->>'XTRACKINGNO' = $1
  LIMIT 1
`;

    const result = await db.query(hQuery, [String(trackingNo)]);
    return result[0].headerinfo || null;

  } catch (error) {
    console.error('Failed to delete record:', error);
    return null;
  }
}

async function fetchINVChargeCodes(carrier) {
  try {
    // FIX: Use parameterized query to prevent SQL injection.
    const checkResult = await db.query(`SELECT details FROM public.chargecodes WHERE details->>'carrier' = $1`, [carrier]);
    return checkResult;
  } catch (error) {
    return {};
  }
}


// 1) Batch fetch all HeaderInfos for the current itemRows
async function getHeaderInfosByTrackingNos(trackingNos) {
  try {
    if (!Array.isArray(trackingNos)) { trackingNos = [trackingNos]; }
    const uniq = [...new Set(trackingNos.map(String))]; // dedupe, cast to string

    if (uniq.length === 0) return new Map();

    const hQuery = `
      SELECT
        details->'HEADER_INFO' AS headerinfo,
        details->'HEADER_INFO'->>'XTRACKINGNO' AS xtrackingno
      FROM shipments
      WHERE details->'HEADER_INFO'->>'XTRACKINGNO' = ANY($1::text[])
    `;

    const rows = await db.query(hQuery, [uniq]); // rows: [{headerinfo, xtrackingno}, ...]
    const map = new Map();
    for (const r of rows) map.set(r.xtrackingno, r.headerinfo); // headerinfo is JSON
    return map;

  } catch (error) {
    console.error('Failed to fetch header infos:', error);
    return new Map();
  }
}


async function dbShipsave(shipmentJson) {
  try {
    const insertQuery = 'INSERT INTO public.shipments (details) VALUES (null) RETURNING id';
    const insertResult = await db.query(insertQuery);
    const newId = insertResult[0].id;
    console.log("Inserted ID:", newId);

    shipmentJson.id = newId;
    const body = JSON.stringify(shipmentJson);

    const updateQuery = 'UPDATE public.shipments SET details = $1 WHERE id = $2';
    await db.query(updateQuery, [body, newId]);
    console.log("Updated save shipment with ID:", newId);

    return newId;
  } catch (error) {
    console.error("Error in dbShipsave:", error);
    return null;
  }
}

async function dbShipdelete(voidreq) {
  try {
    const deliveryNo = voidreq?.HEADER_INFO?.DOCUMENT_NUMBER;
    const trackingNo =
      voidreq?.HEADER_INFO?.MASTER_TRACKING_NUMBER ||
      voidreq?.PACKAGES?.[0]?.TRACKING_NUMBER;

    const updateQuery = `
      UPDATE public.shipments
      SET details = jsonb_set(details::jsonb, '{TRACKING_STATUS}', '"Cancelled"', false)::json
      WHERE 
        details->'HEADER_INFO'->>'DOCUMENT_NUMBER' = $1
        OR details->'HEADER_INFO'->>'MASTER_TRACKING_NUMBER' = $2
        OR details->'PACKAGES'->0->>'TRACKING_NUMBER' = $2
      RETURNING id;
    `;

    const result = await db.query(updateQuery, [deliveryNo, trackingNo]);

    if (result.length > 0) {
      console.log("Updated cancel shipment with ID:", result.id);
      return result.id;
    } else {
      console.log("No matching shipment found to cancel.");
      return null;
    }

  } catch (error) {
    console.error("Error in dbShipdelete:", error);
    return null;
  }
}
async function dbSAP_SHIP_transactionssave(shipmentJson) {
  try {
    const insertQuery = 'INSERT INTO public.transactions (details) VALUES (null) RETURNING id';
    const result = await db.query(insertQuery);

    const newId = result[0].id;
    shipmentJson.id = newId;
    const body = JSON.stringify(shipmentJson);

    const updateQuery = `UPDATE public.transactions SET details = $1 WHERE id = $2`;
    await db.query(updateQuery, [body, newId]);
    console.log('Transaction saved with ID:', newId);
    return newId;
  } catch (error) {
    console.error('Error in dbSAP_SHIP_transactionssave:', error);
    return null;
  }
}

async function dbSAP_TRACK_transactionssave(logEntry) {
  try {
    const insertQuery = `INSERT INTO public.transactions (details) VALUES ($1) RETURNING id`;
    const result = await db.query(insertQuery, [logEntry]);
    console.log('Transaction log saved with id:', result[0].id);
    return result[0].id;
  } catch (error) {
    console.error('Failed to save transaction log:', error);
    return null;
  }
}
async function dbSAP_CARRIERRATE_transactionssave(logEntry) {
  try {
    const insertQuery = `INSERT INTO public.ratetransactions (details) VALUES ($1) RETURNING id`;
    const result = await db.query(insertQuery, [logEntry]);
    console.log('Transaction log saved with id:', result[0].id);
    return result[0].id;
  } catch (error) {
    console.error('Failed to save transaction log:', error);
    return null;
  }
}
async function dbSAP_RATEALL_transactionssave(logEntry) {
  try {
    const insertQuery = `INSERT INTO public.ratetransactions (details) VALUES ($1) RETURNING id`;
    const result = await db.query(insertQuery, [logEntry]);
    console.log('Transaction log saved with id:', result[0].id);
    logEntry.id = result[0].id;
    const updateQuery = `UPDATE public.ratetransactions SET details = $1 WHERE id = $2`;
    await db.query(updateQuery, [logEntry, result[0].id]);
    console.log('Updated shipment details for id:', result[0].id);
    return result[0].id;
  } catch (error) {
    console.error('Failed to save transaction log:', error);
    return null;
  }
}
async function dbSAP_EXCELDATA_INVOICE_save(logEntry) {
  const insertQuery = `
    INSERT INTO exceldatainvoices (invoicedate, carrier, details, reference)
    VALUES ($1, $2, $3, $4)
    RETURNING id;
  `;

  try {
    const values = [
      logEntry.invoicedate,
      logEntry.carrier,
      JSON.stringify(logEntry.details), // convert JSON to string for PG
      logEntry.reference
    ];

    const result = await db.query(insertQuery, values);
    console.log('Transaction log saved with id:', result[0].id);
    return result[0].id;

  } catch (error) {
    console.error('Failed to save transaction log:', error);
    return null;
  }
}

async function dbSAP_INVOICE_save(logEntry) {
  const insertQuery = `
    INSERT INTO invoices (invoicedate, carrier, details, reference)
    VALUES ($1, $2, $3, $4)
    RETURNING id;
  `;

  try {
    const values = [
      logEntry.invoicedate,
      logEntry.carrier,
      JSON.stringify(logEntry.details), // convert JSON to string for PG
      logEntry.reference
    ];

    const result = await db.query(insertQuery, values);
    console.log('Transaction log saved with id:', result[0].id);
    return result[0].id;

  } catch (error) {
    console.error('Failed to save transaction log:', error);
    return null;
  }
}

async function dbSAP_pushCarrierEvent_transactionssave(logEntry, carrier) {
  try {
    const insertQuery = `INSERT INTO public."pushCarrierTrackEventtransaction" (carrier, details) VALUES ($1, $2) RETURNING id`;
    const result = await db.query(insertQuery, [carrier.toUpperCase(), logEntry]);
    console.log('Carrier event log saved with id:', result[0].id);
    return result[0].id;
  } catch (error) {
    console.error('Failed to save carrier event transaction log:', error);
    return null;
  }
}

module.exports = {
  dbTracksaveandUpdate,
  dbShipsave, dbShipdelete,
  dbSAP_SHIP_transactionssave,
  dbSAP_TRACK_transactionssave,
  dbSAP_pushCarrierEvent_transactionssave,
  dbSAP_TRACK_Delete,
  dbSAP_INVOICE_save,
  fetchChargeCodes,
  fetchINVChargeCodes,
  getHeaderInfoByTrackingNo,
  getHeaderInfosByTrackingNos,
  dbSAP_EXCELDATA_INVOICE_save,
  dbSAP_CARRIERRATE_transactionssave,
  dbSAP_RATEALL_transactionssave,
  dbBatchShipUpdate,
  fetchCarrierServiceCodes,
  fetchCarrierCredentials,
  fetchShippersFromWH,
  dbBatchAutomated_statusUpdate,
  dbBatchAutomated_statusUpdateDone, fetchCarriers
};
