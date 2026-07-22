const mysql = require('mysql2/promise');
const path = require('path');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

require('dotenv').config({ path: path.resolve(__dirname, '.env') });

let primaryPool = null;
let fallbackPool = null;

async function getAwsSecret() {
    if (!process.env.AWS_REGION) return null;
    try {
        const client = new SecretsManagerClient({ region: process.env.AWS_REGION });
        const response = await client.send(
            new GetSecretValueCommand({
                SecretId: process.env.SECRET_NAME || 'BitHubDBSecrets',
                VersionStage: "AWSCURRENT",
            })
        );
        return JSON.parse(response.SecretString);
    } catch (error) {
        console.error("Failed to fetch AWS Secrets:", error);
        return null;
    }
}

async function initPools() {
    if (primaryPool && fallbackPool) return;

    let dbHost = process.env.DB_HOST || 'hayabusa.proxy.rlwy.net';
    let dbPort = process.env.DB_PORT || 33968;
    let dbUser = process.env.DB_USER || 'root';
    let dbPass = process.env.DB_PASS || '';
    let dbName = process.env.DB_NAME || 'railway';

    // Fetch from Secrets Manager if running in AWS Lambda
    if (process.env.AWS_REGION && process.env.AWS_EXECUTION_ENV) {
        const secrets = await getAwsSecret();
        if (secrets) {
            dbHost = secrets.DB_HOST || dbHost;
            dbPort = secrets.DB_PORT || dbPort;
            dbUser = secrets.DB_USER || dbUser;
            dbPass = secrets.DB_PASS || dbPass;
            dbName = secrets.DB_NAME || dbName;
        }
    }

    const railwayConfig = {
        host: dbHost,
        port: dbPort,
        user: dbUser,
        password: dbPass,
        database: dbName,
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    };

    const aivenConfig = {
        host: process.env.AIVEN_DB_HOST || 'bithub-bithub.e.aivencloud.com',
        port: process.env.AIVEN_DB_PORT || 13295,
        user: process.env.AIVEN_DB_USER || 'avnadmin',
        password: process.env.AIVEN_DB_PASS || '',
        database: process.env.AIVEN_DB_NAME || 'defaultdb',
        ssl: { rejectUnauthorized: false },
        waitForConnections: true,
        connectionLimit: 10,
        queueLimit: 0
    };

    primaryPool = mysql.createPool(railwayConfig);
    fallbackPool = mysql.createPool(aivenConfig);
}

async function executeWithPool(pool, sqlQuery) {
    const [rows] = await pool.query(sqlQuery);
    
    if (!rows || rows.length === 0) return null;
    
    const firstRow = rows[0];
    const keys = Object.keys(firstRow);
    
    if (keys.length === 1) {
        const val = firstRow[keys[0]];
        if (typeof val === 'string') {
            try {
                return JSON.parse(val);
            } catch (e) {
                return val;
            }
        }
        return val;
    }
    
    return rows;
}

/**
 * Execute a MySQL query returning JSON, with fallback logic.
 */
async function queryDB(sqlQuery) {
    await initPools();
    try {
        return await executeWithPool(primaryPool, sqlQuery);
    } catch (err) {
        console.warn("⚠️ Primary DB (Railway) failed, falling back to Aiven:", err.message);
        try {
            return await executeWithPool(fallbackPool, sqlQuery);
        } catch (fallbackErr) {
            console.error("❌ Both Primary and Fallback DBs failed!");
            throw fallbackErr;
        }
    }
}

// Test connection on startup to verify for the user (only if not in Lambda to prevent cold start hang)
if (!process.env.AWS_EXECUTION_ENV) {
    (async () => {
        try {
            await initPools();
            const connection = await primaryPool.getConnection();
            console.log(`\n✅ VERIFIED: Backend successfully connected to Primary Cloud DB`);
            connection.release();
        } catch (err) {
            console.warn(`\n⚠️ Primary DB Connection Failed on startup: ${err.message}`);
            try {
                const fbConnection = await fallbackPool.getConnection();
                console.log(`✅ VERIFIED: Backend successfully connected to Fallback Cloud DB`);
                fbConnection.release();
            } catch (fbErr) {
                console.error(`❌ CRITICAL: Could not connect to either Railway or Aiven cloud databases!`);
            }
        }
    })();
}

module.exports = { queryDB, get primaryPool() { return primaryPool; }, get fallbackPool() { return fallbackPool; } };
