const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');


async function uploadETD(ETDfileurl, token, documentMeta, file) {
    const form = new FormData();

    // document JSON
    form.append('document', JSON.stringify(documentMeta));

    // attachment with filename + contentType
    form.append('attachment', file.buffer, {
        filename: file.originalname,
        contentType: file.mimetype
    });

    const response = await axios.post(ETDfileurl, form, {
        headers: {
            Authorization: `Bearer ${token}`,
            ...form.getHeaders()
        },
        maxBodyLength: Infinity
    });

    return response.data;
}


async function uploadMultiETD(ETDfileurl, token, documentMeta, files) {

    const form = new FormData();

    // Add documentInformation (JSON as string)
    form.append('documentInformation', JSON.stringify(documentMeta));

    // Add each file
    files.forEach(file => {
        form.append('fileAttachments', file.buffer, {
            filename: file.originalname,
            contentType: file.mimetype
        });
    });

    const response = await axios.post(ETDfileurl,
        form,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                ...form.getHeaders()
            }
        }
    );

    return response.data;
}

async function uploadEncodedMultiETD(ETDbase64url, token, documentsArray, shipmentInfo) {

    const payload = {
        workflowName: "ETDPreshipment",
        carrierCode: "FDXE",
        originCountryCode: shipmentInfo.origin,
        destinationCountryCode: shipmentInfo.destination,
        //shipmentDate: new Date().toISOString(),
        metaData: documentsArray.map((doc, index) => ({
            fileReferenceId: `REF_${index}`,
            contentType: doc.contentType,
            shipDocumentType: doc?.documentType,
            formCode: doc.formCode || null,
            fileContentBase64: doc.base64
        }))
    };
    console.log(JSON.stringify(payload));
    const response = await axios.post(ETDbase64url,
        payload,
        {
            headers: {
                Authorization: `Bearer ${token}`,
                'Content-Type': 'application/json'
            }
        }
    );

    return response.data;
}

module.exports = { uploadETD, uploadMultiETD, uploadEncodedMultiETD };