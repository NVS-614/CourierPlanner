const axios = require('axios');
// Per-account token cache
const EstesTokenCache = {};
// Token fetcher
const fetchToken = async (tokenUrl, clientId, clientSecret, AccessKey) => {
    const response = await axios.post(tokenUrl, '', {
        headers: {
            accept: 'application/json',
            'APIKEY': AccessKey,
            Authorization: 'Basic ' + Buffer.from(`${clientId}:${clientSecret}`).toString('base64')
        },
    });

    // FIX: Use dynamic expiry from response instead of hardcoded timestamp.
    const expiresIn = response.data.expires_in ?? 3600;
    return {
        token: response.data.token,
        expiresAt: Date.now() + (expiresIn - 60) * 1000,
    };
};

const getEstesToken = async (straccount, tokenUrl, clientId, clientSecret, AccessKey) => {
    const cache = EstesTokenCache[straccount];
    if (cache && cache.token && Date.now() < cache.expiresAt) {
        console.log(`Using cached Estes token for account ${straccount}`);
        return cache.token;
    }
    console.log(`Fetching new Estes token for account ${straccount}`);
    const { token, expiresAt } = await fetchToken(tokenUrl, clientId, clientSecret, AccessKey);
    EstesTokenCache[straccount] = { token, expiresAt };
    return token;
};

module.exports = { getEstesToken };
