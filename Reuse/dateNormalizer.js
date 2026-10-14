const normalizeToISO = (dateStr, timeStr, timezone = 'UTC') => {
    try {

        if (!dateStr) return null;

        // Combine date + time safely
        let rawDateTime = timeStr
            ? `${dateStr} ${timeStr}`
            : dateStr;

        // Create JS Date
        const parsedDate = new Date(rawDateTime);

        if (isNaN(parsedDate)) return null;

        return parsedDate.toISOString(); // Always UTC ISO

    } catch (err) {
        return null;
    }
};

module.exports = { normalizeToISO };