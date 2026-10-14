const axios = require('axios');

let LBNTokenCache = {
    value: null,
    expiresAt: 0
};

const getLBNToken = async () => {
    if (LBNTokenCache.value && Date.now() < LBNTokenCache.expiresAt) {
        console.log("Using cached LBN token...");
        return LBNTokenCache.value;
    }

    try {
        console.log("Fetching new LBN token...");
        const input = `grant_type=client_credentials&client_id=${process.env.BN4LTOKEN_ID}&client_secret=${process.env.BN4LTOKEN_PASSWORD}`;

        const response = await axios.post(process.env.BN4LTOKEN_URL, input, {
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                Accept: 'application/json',
            },
        });

        LBNTokenCache.value = response.data.access_token;
        LBNTokenCache.expiresAt = Date.now() + (response.data.expires_in * 1000);


        return LBNTokenCache.value;

    } catch (error) {
        console.error("Error fetching LBN token:", error.response?.data || error.message);
        throw new Error("Failed to retrieve LBN token");
    }
};

const getCSRFToken = async () => {
    // First request to get CSRF token and cookies
    const tokenResponse = await axios.get(
        process.env.LBN_SAP_TRACK_CSRFTOKEN_URL,
        {
            headers: {
                'X-CSRF-Token': 'Fetch',
                Authorization: 'Basic ' + Buffer.from(`${process.env.LBN_SAP_USER}:${process.env.LBN_SAP_PASSWORD}`).toString('base64')
            }
        }
    );

    const csrfToken = tokenResponse.headers['x-csrf-token'];
    const cookies = tokenResponse.headers['set-cookie']; // Get cookies from response
    return [csrfToken, cookies]
};


module.exports = { getLBNToken, getCSRFToken };
