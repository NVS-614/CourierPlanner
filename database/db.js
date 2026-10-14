require('dotenv').config();
const pgp = require('pg-promise')({
    capSQL: true
});

// FIX: Use environment variable — never hardcode credentials in source code.
const db = pgp({
    connectionString: process.env.DATABASE_URL,
    max: 10,
    idleTimeoutMillis: 30000,
});

module.exports = db;
