const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');

const logDirectory = path.resolve(
    process.env.CARRIER_LOG_DIR || path.join(__dirname, '..', 'logs', 'carrier-api')
);
const logFilePattern = /^carrier-api-(?:\d{4}-\d{2}-\d{2}|[A-Za-z0-9_-]+-[a-f0-9]{8}-\d{4}-\d{2}-\d{2})\.jsonl$/;

function getLogFileName(timestamp, deliveryNo) {
    const date = new Date(timestamp);
    if (Number.isNaN(date.getTime())) {
        throw new TypeError('Carrier log timestamp must be a valid date');
    }

    const deliveryValue = deliveryNo === null || deliveryNo === undefined ? '' : String(deliveryNo);
    const deliverySlug = deliveryValue
        ? deliveryValue.replace(/[^A-Za-z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 64) || 'delivery'
        : 'unassigned';
    const deliveryHash = crypto.createHash('sha256').update(deliveryValue).digest('hex').slice(0, 8);

    return `carrier-api-${deliverySlug}-${deliveryHash}-${date.toISOString().slice(0, 10)}.jsonl`;
}

async function appendCarrierLog(logEntry) {
    await fs.mkdir(logDirectory, { recursive: true });
    const filePath = path.join(logDirectory, getLogFileName(logEntry.Timestamp, logEntry.DeliveryNo));
    await fs.appendFile(filePath, `${JSON.stringify(logEntry)}\n`, {
        encoding: 'utf8',
        mode: 0o600
    });
}

function matchesFilters(logEntry, filters) {
    if (logEntry.LOG_TYPE !== 'CARRIER_API') return false;
    if (filters.deliveryNo && logEntry.DeliveryNo !== filters.deliveryNo) return false;
    if (filters.carrier && !String(logEntry.Carrier || '').toLowerCase().includes(filters.carrier.toLowerCase())) {
        return false;
    }
    if (filters.operation && !String(logEntry.Operation || '').toLowerCase().includes(filters.operation.toLowerCase())) {
        return false;
    }

    const timestamp = new Date(logEntry.Timestamp).getTime();
    if (!Number.isFinite(timestamp)) return false;
    if (filters.from && timestamp < filters.from.getTime()) return false;
    if (filters.to && timestamp > filters.to.getTime()) return false;
    return true;
}

async function readCarrierLogs(filters) {
    let fileNames;
    try {
        fileNames = await fs.readdir(logDirectory);
    } catch (error) {
        if (error.code === 'ENOENT') return [];
        throw error;
    }

    const entries = [];
    const logFiles = fileNames.filter(fileName => logFilePattern.test(fileName)).sort().reverse();

    for (const fileName of logFiles) {
        const content = await fs.readFile(path.join(logDirectory, fileName), 'utf8');
        const lines = content.split(/\r?\n/);

        for (let index = 0; index < lines.length; index += 1) {
            const line = lines[index].trim();
            if (!line) continue;

            let logEntry;
            try {
                logEntry = JSON.parse(line);
            } catch (error) {
                throw new Error(`Invalid carrier log JSON in ${fileName} at line ${index + 1}: ${error.message}`);
            }

            if (matchesFilters(logEntry, filters)) entries.push(logEntry);
        }
    }

    entries.sort((left, right) => new Date(right.Timestamp) - new Date(left.Timestamp));
    return entries.slice(filters.offset, filters.offset + filters.limit);
}

module.exports = { appendCarrierLog, readCarrierLogs };
