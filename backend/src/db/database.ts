import { MongoClient, type Db } from 'mongodb';
import { env } from '../config/env.js';

let client: MongoClient | null = null;
let database: Db | null = null;

export function isDatabaseConfigured(): boolean {
  return env.mongoUri !== '';
}

export async function connectDatabase(): Promise<boolean> {
  if (!isDatabaseConfigured()) return false;
  if (database) return true;
  client = new MongoClient(env.mongoUri);
  await client.connect();
  database = client.db(env.mongoDb);
  await database.collection('analyses').createIndex({ analysisId: 1 }, { unique: true });
  await database.collection('analysis_results').createIndex({ analysisId: 1 }, { unique: true });
  await database.collection('users').createIndex({ email: 1 }, { unique: true });
  return true;
}

export function getDatabase(): Db | null {
  return database;
}

export async function disconnectDatabase(): Promise<void> {
  await client?.close();
  client = null;
  database = null;
}
