const express = require('express');
const router = express.Router();
const axios = require('axios');

const XLSX = require('xlsx');
const path = require('path');
const fs = require('fs');
const dbCon = require('../database/db');


router.post('/', async (req, res) => {

    res.header('Access-Control-Allow-Origin', '*');
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.header('Access-Control-Allow-Headers', 'Origin, X-Requested-With, Content-Type, Accept, Authorization');
    try {
        if (!req.file) {
            return res.status(400).json({
                success: false,
                message: 'Please select an Excel file to upload'
            });
        }
        let result = {};
        // Process Excel file from memory buffer
        //const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
        result = await processExcelBuffer(req.file.buffer);
        res.json({
            success: true,
            data: result
        });

    } catch (error) {
        console.error('Upload error:', error);
        res.status(500).json({
            success: false,
            message: 'Failed to process Excel file',
            error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message
        });
    }

});



async function processExcelBuffer(buffer) {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet);
    const today = new Date();
    const formattedDate = today.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, '+00');
    console.log("Excel rows:", rows.length);

    // create batch in `automated_shipments` table
    const batch = await createAutomatedShipment(rows.length, '', formattedDate);

    for (const row of rows) {
        await insertIntoBatchShipments(row, batch.batchname);
    }
    return {};

}

async function createAutomatedShipment(totalCount, senderEmail, receivedDate) {
    // Step 1: insert row without batchname
    const insertQuery = `
    INSERT INTO public.automated_shipments
      (batchname,date, details, status, total, success_count, failed,  op_send_status)
    VALUES ('', $2,'{}'::json, 'open', $1, 0, 0,false)
    RETURNING id;
  `;

    const insertResult = await dbCon.query(insertQuery, [totalCount, receivedDate]);

    let id = 0;
    try {
        if (insertResult?.rows) {
            id = insertResult.rows[0].id;
        } else {
            id = insertResult[0].id;
        }
    } catch (error) {

    }
    const batchname = `batch_${id}`;

    // Step 2: update batchname with correct ID
    const updateQuery = `
    UPDATE public.automated_shipments
    SET batchname = $1
    WHERE id = $2;
  `;

    await dbCon.query(updateQuery, [batchname, id]);

    return { id, batchname };
}

async function insertIntoBatchShipments(row, batchId) {
    try {
        const rowJson = JSON.stringify(row);

        const result = await dbCon.query(
            `INSERT INTO public.batch_shipments (batch_id, details, status, message)
       VALUES ($1, $2, NULL, NULL)
       RETURNING id`,
            [batchId, rowJson]
        );

        console.log("Inserted record ID:", result[0].id);

    } catch (err) {
        console.error("Insert error:", err);
    }
}
module.exports = router;
