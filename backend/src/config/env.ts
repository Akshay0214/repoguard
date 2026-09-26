import dotenv from 'dotenv';

dotenv.config();

function readPort(raw: string | undefined): number {
  if (!raw || raw.trim() === '') return 4000;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('PORT must be an integer between 1 and 65535');
  }
  return port;
}

function readNodeEnv(raw: string | undefined): 'development' | 'production' | 'test' {
  if (raw === 'production' || raw === 'test' || raw === 'development') return raw;
  return 'development';
}

export const env = {
  port: readPort(process.env.PORT),
  frontendUrl: process.env.FRONTEND_URL?.trim() || 'http://localhost:5173',
  nodeEnv: readNodeEnv(process.env.NODE_ENV),
  openaiApiKey: process.env.OPENAI_API_KEY?.trim() ?? '',
  openaiModel: process.env.OPENAI_MODEL?.trim() ?? '',
};
