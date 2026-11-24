const { AsyncLocalStorage } = require('async_hooks');
const axios = require('axios');
const carrierApiLogStore = require('../lib/carrierApiLogStore');

const requestContext = new AsyncLocalStorage();
const sensitiveKey = /authorization|cookie|password|passwd|secret|token|api[-_]?key|credential|access[-_]?key/i;

function getDeliveryNo(req) {
    const body = req?.body || {};
    const request = body.REQUEST || body;
    const header = request.HEADER_INFO || body.HEADER_INFO || {};
    return header.DOCUMENT_NUMBER ||
        header.DELIVERY_NUMBER ||
        header.DOCUMENT_NO ||
        header.DELIVERY_NO ||
        header.DELIVERYNO ||
        request.DeliveryNo ||
        request.DELIVERY_NO ||
        request.DELIVERYNO ||
        body.DeliveryNo ||
        body.DELIVERY_NO ||
        body.DELIVERYNO ||
        req?.params?.DeliveryNo ||
        req?.query?.DeliveryNo ||
        null;
}

function redactText(value) {
    return value
        .replace(
            /((?:"|')?(?:authorization|cookie|password|passwd|secret|token|api[-_]?key|credential|access[-_]?key)(?:"|')?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^&,\s}>]+)/gi,
            '$1"[REDACTED]"'
        )
        .replace(
            /(<(?:authorization|password|passwd|secret|token|api[-_]?key|credential|access[-_]?key)[^>]*>)[\s\S]*?(<\/(?:authorization|password|passwd|secret|token|api[-_]?key|credential|access[-_]?key)>)/gi,
            '$1[REDACTED]$2'
        );
}

function sanitize(value, key = '') {
    if (sensitiveKey.test(key)) return '[REDACTED]';
    if (value === null || value === undefined || typeof value === 'number' || typeof value === 'boolean') {
        return value;
    }
    if (typeof value === 'string') {
        try {
            return sanitize(JSON.parse(value));
        } catch {
            return redactText(value);
        }
    }
    if (Buffer.isBuffer(value)) {
        return { type: 'Buffer', byteLength: value.length, data: value.toString('base64') };
    }
    if (Array.isArray(value)) return value.map(item => sanitize(item));
    if (typeof value === 'object') {
        const result = {};
        for (const [childKey, childValue] of Object.entries(value)) {
            result[childKey] = sanitize(childValue, childKey);
        }
        return result;
    }
    return String(value);
}

function sanitizeUrl(value) {
    try {
        const url = new URL(value);
        url.username = '';
        url.password = '';
        for (const key of url.searchParams.keys()) {
            if (sensitiveKey.test(key)) url.searchParams.set(key, '[REDACTED]');
        }
        return url.toString();
    } catch {
        return redactText(String(value));
    }
}

async function saveExchange(context, config, response, error, durationMs) {
    const req = context.req;
    const headers = config.headers?.toJSON ? config.headers.toJSON() : config.headers;
    const carrierDetails = req.body?.CARRIER_DETAILS || req.body?.REQUEST?.CARRIER_DETAILS;
    const logEntry = {
        LOG_TYPE: 'CARRIER_API',
        DeliveryNo: getDeliveryNo(req),
        Carrier: context.carrierName || carrierDetails?.CARRIER || carrierDetails?.Carrier || null,
        Operation: `${req.method} ${req.originalUrl}`,
        Timestamp: new Date().toISOString(),
        DurationMs: durationMs,
        Request: {
            Method: (config.method || 'get').toUpperCase(),
            Url: sanitizeUrl(config.url || ''),
            Headers: sanitize(headers || {}),
            Query: sanitize(config.params || {}),
            Body: sanitize(config.data)
        },
        Response: response ? {
            Status: response.status,
            Headers: sanitize(response.headers?.toJSON ? response.headers.toJSON() : response.headers || {}),
            Body: sanitize(response.data)
        } : null,
        Error: error ? {
            Message: redactText(error.message || 'Carrier request failed'),
            Status: error.response?.status || null,
            ResponseBody: sanitize(error.response?.data)
        } : null
    };

    await carrierApiLogStore.appendCarrierLog(logEntry);
}

function installAxiosAdapter() {
    const defaultAdapter = axios.defaults.adapter;
    axios.defaults.adapter = async config => {
        const context = requestContext.getStore();
        if (!context) {
            return axios.getAdapter(defaultAdapter, config)(config);
        }

        const startedAt = Date.now();
        try {
            const response = await axios.getAdapter(defaultAdapter, config)(config);
            try {
                await saveExchange(context, config, response, null, Date.now() - startedAt);
            } catch (logError) {
                console.error('Failed to store carrier API exchange:', {
                    deliveryNo: getDeliveryNo(context.req),
                    carrier: context.carrierName,
                    error: logError.message
                });
            }
            return response;
        } catch (error) {
            try {
                await saveExchange(context, config, error.response || null, error, Date.now() - startedAt);
            } catch (logError) {
                console.error('Failed to store carrier API exchange:', {
                    deliveryNo: getDeliveryNo(context.req),
                    carrier: context.carrierName,
                    error: logError.message
                });
            }
            throw error;
        }
    };
}

function contextMiddleware(req, res, next) {
    const carrierDetails = req.body?.CARRIER_DETAILS || req.body?.REQUEST?.CARRIER_DETAILS;
    requestContext.run({
        req,
        carrierName: carrierDetails?.CARRIER || carrierDetails?.Carrier || null
    }, next);
}

function runWithCarrier(carrierName, callback) {
    const context = requestContext.getStore();
    if (!context) return callback();
    return requestContext.run({ ...context, carrierName }, callback);
}

module.exports = { installAxiosAdapter, contextMiddleware, runWithCarrier };
