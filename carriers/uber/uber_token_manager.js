'use strict';
/**
 * Uber Direct — OAuth2 client_credentials token with per-client cache.
 * POST https://auth.uber.com/oauth/v2/token
 * form: client_id (CARRIER_DETAILS.USERID), client_secret (CARRIER_DETAILS.PASSWORD),
 *       grant_type=client_credentials, scope=eats.deliveries
 */
const axios = require('axios');

const DEFAULT_TOKEN_URL = 'https://auth.uber.com/oauth/v2/token';
const DEFAULT_SCOPE = 'eats.deliveries';
const EXPIRY_BUFFER_MS = 5 * 60 * 1000; // refresh 5 min before expiry

// Keyed by clientId|scope so multiple shipper accounts don't share a token
const tokenCache = new Map();

const getUberToken = async (tokenUrl, clientId, clientSecret, scope = DEFAULT_SCOPE) => {
    if (!clientId || !clientSecret) {
        throw new Error('Uber client_id / client_secret missing (CARRIER_DETAILS.USERID / PASSWORD)');
    }

    const key = `${clientId}|${scope}`;
    const cached = tokenCache.get(key);
    if (cached && Date.now() < cached.expiresAt) return cached.value;

    const form = new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: 'client_credentials',
        scope
    });

    try {
        const { data } = await axios.post(tokenUrl || DEFAULT_TOKEN_URL, form.toString(), {
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
            timeout: 15000
        });
        const ttlMs = (Number(data.expires_in) || 2592000) * 1000; // Uber default: 30 days
        tokenCache.set(key, { value: data.access_token, expiresAt: Date.now() + ttlMs - EXPIRY_BUFFER_MS });
        return data.access_token;
    } catch (error) {
        const d = error.response?.data;
        console.error('Error fetching UBER token:', d || error.message);
        throw new Error(`Failed to retrieve UBER token: ${d?.error_description || d?.error || error.message}`);
    }
};

const clearUberToken = (clientId, scope = DEFAULT_SCOPE) => tokenCache.delete(`${clientId}|${scope}`);

module.exports = { getUberToken, clearUberToken };
