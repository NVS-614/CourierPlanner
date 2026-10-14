/**
 * ShipCore — Doc Engine HTTP Client
 * Used by ship.controller.js to call the external shipcore-doc-engine.
 *
 * Set DOC_ENGINE_URL in your .env:
 *   DOC_ENGINE_URL=http://localhost:4009          (local dev)
 *   DOC_ENGINE_URL=https://your-doc-engine.cloud  (production)
 */

const axios = require('axios');

const DOC_ENGINE_URL = process.env.DOC_ENGINE_URL || 'http://localhost:4009';

// Maps FORMS keys (from request) → docType (used by doc engine)
const FORM_TO_DOCTYPE = {
    BOL:   'BILL_OF_LADING',
    CI:    'COMMERCIAL_INVOICE',
    PL:    'PACKING_LIST',
    COO:   'CERTIFICATE_OF_ORIGIN',
    SLI:   'SLI',
    DG:    'DG_DECLARATION',
    AWB:   'AIR_WAYBILL',
    LABEL: 'LABEL'
};

/**
 * Call the doc engine to generate a single document.
 * Returns same shape as internal doc functions:
 * { DOC_PROVIDER, CONTENT_TYPE, COPIES_TO_PRINT, DOC_NAME, ENCODED_LABEL, DOC_TYPE }
 */
async function generateDoc(formKey, REQUEST, HEADER_INFO, PACKAGES) {
    const docType = FORM_TO_DOCTYPE[formKey];
    if (!docType) {
        throw new Error(`[DocEngine] Unknown FORMS key: "${formKey}". Add it to FORM_TO_DOCTYPE in docEngineClient.js`);
    }

    try {
        const { data } = await axios.post(
            `${DOC_ENGINE_URL}/api/generate/doc`,
            { docType, REQUEST, HEADER_INFO, PACKAGES },
            { timeout: 20000 }
        );
        return data;
    } catch (err) {
        const msg = err.response?.data?.error || err.message;
        throw new Error(`[DocEngine] Failed to generate ${docType}: ${msg}`);
    }
}

module.exports = { generateDoc };