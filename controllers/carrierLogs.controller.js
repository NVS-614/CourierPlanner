const carrierApiLogStore = require('../lib/carrierApiLogStore');

function parseInteger(value, fallback, maximum, minimum = 0) {
    if (value === undefined) return fallback;
    if (!/^\d+$/.test(String(value))) return null;
    const parsed = Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < minimum) return null;
    return maximum ? Math.min(parsed, maximum) : parsed;
}

exports.getCarrierLogs = async (req, res) => {
    const limit = parseInteger(req.query.limit, 100, 500, 1);
    const offset = parseInteger(req.query.offset, 0, null);
    const from = req.query.from ? new Date(req.query.from) : null;
    const to = req.query.to ? new Date(req.query.to) : null;

    if (limit === null || offset === null ||
        (from && Number.isNaN(from.getTime())) ||
        (to && Number.isNaN(to.getTime())) ||
        (from && to && from > to)) {
        return res.status(400).json({
            status: 'Error',
            message: 'Invalid limit, offset, from, or to parameter'
        });
    }

    try {
        const logs = await carrierApiLogStore.readCarrierLogs({
            deliveryNo: req.query.deliveryNo || req.params.deliveryNo || req.query.delivery_no,
            carrier: req.query.carrier,
            operation: req.query.operation,
            from,
            to,
            limit,
            offset
        });

        return res.status(200).json({
            status: 'Success',
            count: logs.length,
            limit,
            offset,
            logs
        });
    } catch (error) {
        console.error('Failed to retrieve carrier API logs:', error);
        return res.status(500).json({
            status: 'Error',
            message: 'Unable to retrieve carrier logs'
        });
    }
};
