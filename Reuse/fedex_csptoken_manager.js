const axios = require('axios');

// Per-plant token cache
const fedexTokenCache = {};
const fedexTrackTokenCache = {};

const fetchCSPToken = async (tokenUrl, clientId, clientSecret, userId, password) => {
    const input = `grant_type=csp_credentials&client_id=${clientId}&client_secret=${clientSecret}&child_Key=${userId}&child_secret=${password}`;
    const response = await axios.post(tokenUrl, input, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
    });
    return {
        token: response.data.access_token,
        expiresAt: Date.now() + (response.data.expires_in * 1000)
    };
};

const getCSPFedexToken = async (tokenUrl, clientId, clientSecret, userId, password, account) => {
    const cache = fedexTokenCache[account];

    if (cache && cache.token && Date.now() < cache.expiresAt) {
        console.log(`Using cached FEDEX token for account ${account}`);
        return cache.token;
    }
    console.log(`Fetching new FEDEX token for account ${account}`);
    const { token, expiresAt } = await fetchCSPToken(tokenUrl, clientId, clientSecret, userId, password);
    fedexTokenCache[account] = { token, expiresAt };
    return token;


};

// Generalized token fetcher
const fetchToken = async (tokenUrl, clientId, clientSecret) => {
    const input = `grant_type=client_credentials&client_id=${clientId}&client_secret=${clientSecret}`;
    const response = await axios.post(tokenUrl, input, {
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
            Accept: 'application/json',
        },
    });
    return {
        token: response.data.access_token,
        expiresAt: Date.now() + (response.data.expires_in * 1000)
    };
};

const getFedexTrackToken = async (straccount, tokenUrl, clientId, clientSecret) => {
    const cache = fedexTrackTokenCache[straccount];

    if (cache && cache.token && Date.now() < cache.expiresAt) {
        console.log(`Using cached FEDEX tracking token for plant ${straccount}`);
        return cache.token;
    }

    console.log(`Fetching new FEDEX tracking token for plant ${straccount}`);
    const { token, expiresAt } = await fetchToken(tokenUrl, clientId, clientSecret);
    fedexTrackTokenCache[straccount] = { token, expiresAt };
    return token;
};

module.exports = { getFedexTrackToken, getCSPFedexToken };
