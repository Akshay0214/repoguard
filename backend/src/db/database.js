import { MongoClient } from 'mongodb';
import { env } from '../config/env.js';
let client = null;
let database = null;
export function isDatabaseConfigured() {
    return env.mongoUri !== '';
}
export async function connectDatabase() {
    if (!isDatabaseConfigured())
        return false;
    if (database)
        return true;
    client = new MongoClient(env.mongoUri);
    await client.connect();
    database = client.db(env.mongoDb);
    await database.collection('analyses').createIndex({ analysisId: 1 }, { unique: true });
    await database.collection('analysis_results').createIndex({ analysisId: 1 }, { unique: true });
    await database.collection('users').createIndex({ email: 1 }, { unique: true });
    return true;
}
export function getDatabase() {
    return database;
}
export async function disconnectDatabase() {
    await client?.close();
    client = null;
    database = null;
}
