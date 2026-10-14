const axios = require('axios');
const reuse = require('../../Reuse/utilityfunctions.js');
const { getCSPFedexToken } = require('../../Reuse/fedex_csptoken_manager.js');
require('dotenv').config();
const { buildFinalResponse } = require('../../Reuse/responseBuilder');
const axiosInstance = axios.create({
    timeout: 20000,
    maxContentLength: Infinity,
    maxBodyLength: Infinity
});

module.exports = async (request) => {
    const { HEADER_INFO, CARRIER_DETAILS} = request;
     let FINALRESPONSE = buildFinalResponse(request.REQUEST);
    const tokenurl = CARRIER_DETAILS.TOKENURL || process.env.FEDEX_TOKEN;
    const closeurl = CARRIER_DETAILS.CLOSEURL || process.env.FEDEX_IPD_CLOSE;
    const getdocurl = CARRIER_DETAILS.GETDOCURL || process.env.FEDEX_IPD_GETDOC;

    const CSPuserId = CARRIER_DETAILS.CSPUserId || CARRIER_DETAILS.CSP_USER || process.env.FEDEX_CSPUSER;
    const CSPpassword = CARRIER_DETAILS.CSPPassword || CARRIER_DETAILS.CSP_PASSWORD || process.env.FEDEX_CSPPASSWORD;
    const accountNumber = CARRIER_DETAILS.SHIPPING_ACCOUNT;
    const consolidationKey = HEADER_INFO.MASTER_TRACKING_NUMBER;
    const date = HEADER_INFO.SHIP_DATE;
    const token = await getCSPFedexToken(
        tokenurl, CSPuserId, CSPpassword,
        CARRIER_DETAILS.USERID,
        CARRIER_DETAILS.PASSWORD, CARRIER_DETAILS.SHIPPING_ACCOUNT
    );

    try {

        let jobId = HEADER_INFO?.JOBID;

        // ✅ 1. If JOBID already exists → skip CLOSE
        if (jobId) {
            console.log("Skipping CLOSE → Using existing JobId:", jobId);
        } else {

            // ✅ 2. Call CLOSE API
            const closeRes = await closeIPD({
                token,
                closeurl,
                accountNumber,
                consolidationKey,
                date
            });

            jobId = closeRes?.output?.jobId;

            if (!jobId) {
                throw new Error("JobId not received from close API");
            }

            FINALRESPONSE.HEADER_INFO.JOBID = jobId;
            console.log("Close Success → JobId:", jobId);

            // ✅ 3. If CLOSE_ONLY → return immediately
            if (HEADER_INFO?.CLOSE_ONLY) {
                FINALRESPONSE.STATUS = 'Success';
                FINALRESPONSE.TRACKING_STATUS = 'Close';

                return FINALRESPONSE;
            }
        }

        // ✅ 4. GET DOCUMENTS
        const docsRes = await getIPDDocumentsWithRetry({
            token,
            getdocurl,
            accountNumber,
            jobId
        });

        FINALRESPONSE.SHIPPING_DOCUMENTS = formatIPDResponse(docsRes);
        FINALRESPONSE.STATUS = 'Success';
        FINALRESPONSE.TRACKING_STATUS = 'Documents';

        return FINALRESPONSE;

    } catch (ex) {
        console.error("FedEx IPD Error:", ex?.response?.data || ex.message);
        FINALRESPONSE.STATUS = 'Error';
        let errordesc = reuse.handleShipErrorRes(ex);
        FINALRESPONSE.ERRORS = errordesc;
        return FINALRESPONSE;

    }
}


const closeIPD = async ({ token, closeurl, accountNumber, consolidationKey, date }) => {

    const payload = {
        edtRequestType: "ALL",
        accountNumber: { value: accountNumber },
        consolidationKey: { date, index: consolidationKey, type: 'INTERNATIONAL_PRIORITY_DISTRIBUTION' },
        processingOptionType: "ALLOW_ASYNCHRONOUS",
        labelSpecification: {
            labelFormatType: "COMMON2D",
            labelStockType: "PAPER_4X6",
            imageType: "PDF"
        }
    };

    const res = await axiosInstance.post(closeurl, payload, {
        headers: {
            "content-type": "application/json",
            "authorization": `Bearer ${token}`
        }
    });

    return res.data;
};

const getIPDDocumentsWithRetry = async ({
    token,
    getdocurl,
    accountNumber,
    jobId,
    retries = 6,
    delay = 2000
}) => {


    for (let i = 0; i < retries; i++) {

        const payload = {
            accountNumber: { value: accountNumber },
            jobId
        };

        const res = await axiosInstance.post(getdocurl, payload, {
            headers: {
                "content-type": "application/json",
                "authorization": `Bearer ${token}`
            }
        });

        const data = res.data;

        const isReady =
            data?.output?.transactionConsolidations?.[0]?.pieceResponses;

        if (isReady) {
            console.log("Documents Ready ✅");
            return data;
        }

        console.log(`Waiting for docs... retry ${i + 1}`);
        await sleep(delay);
    }

    throw new Error("Documents not ready after retries");
};

const sleep = (ms) => new Promise(res => setTimeout(res, ms));

const formatIPDResponse = (data) => {

    const FINALRESPONSE = {
        SHIPPING_DOCUMENTS: []
    };
    const consolidations = data?.output?.transactionConsolidations || [];
    consolidations.forEach(cons => {
        // 📦 Package Labels
        cons.pieceResponses?.forEach(pkg => {
            pkg.packageDocuments?.forEach(doc => {
                const formatDoc = reuse.formatShipDoc(
                    'FEDEX',
                    doc.contentType,
                    doc?.copiesToPrint,
                    pkg.trackingNumber,
                    doc.encodedLabel,
                    doc.docType
                );
                FINALRESPONSE.SHIPPING_DOCUMENTS.push(formatDoc);

            });
        });

        // 📄 Consolidation Docs
        cons.completedConsolidationDetail?.consolidationDocuments?.forEach(doc => {
            const formatDoc = reuse.formatShipDoc(
                'FEDEX',
                doc.type,
                doc?.copiesToPrint,
                '',
                doc.parts[0].image,
                doc.imageType
            );
            FINALRESPONSE.SHIPPING_DOCUMENTS.push(formatDoc);

        });

    });

    return FINALRESPONSE.SHIPPING_DOCUMENTS;
};