import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import morgan from 'morgan';
import fs from 'fs';
import { config } from './config/index.js';
import { DatabaseManager } from './config/db.js';
import { router } from './routes/index.js';
import { errorHandler } from './middleware/errorHandler.js';
import { auditLogger } from './middleware/audit.js';

const app = express();

// Ensure upload directory exists
if (!fs.existsSync(config.uploads.dir)) {
  fs.mkdirSync(config.uploads.dir, { recursive: true });
}

// Middleware
app.use(helmet({ crossOriginResourcePolicy: false }));
app.use(cors({
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(morgan('dev'));
app.use(auditLogger);

// Base Health Check
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    service: 'backend-api',
    postgres_connected: DatabaseManager.isPostgres(),
    timestamp: new Date().toISOString(),
  });
});

// Mount Routes
app.use('/api', router);

// Error Handling Middleware
app.use(errorHandler);

// Start server
const startServer = async () => {
  await DatabaseManager.initialize();

  app.listen(config.port, () => {
    console.log(`🚀 Backend API server is running on http://localhost:${config.port}`);
    console.log(`📡 Connected AI Service URL: ${config.aiServiceUrl}`);
  });
};

startServer().catch(err => {
  console.error('Fatal initialization error:', err);
  process.exit(1);
});
