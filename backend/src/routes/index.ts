import { Router } from 'express';
import multer from 'multer';
import path from 'path';
import { config } from '../config/index.js';
import { authenticateJWT } from '../middleware/auth.js';

import * as authController from '../controllers/authController.js';
import * as projectController from '../controllers/projectController.js';
import * as datasetController from '../controllers/datasetController.js';
import * as schemaController from '../controllers/schemaController.js';
import * as conversationController from '../controllers/conversationController.js';
import * as sqlController from '../controllers/sqlController.js';
import * as aiController from '../controllers/aiController.js';
import * as dashboardController from '../controllers/dashboardController.js';
import { DatabaseManager } from '../config/db.js';

const upload = multer({
  dest: config.uploads.dir,
  limits: { fileSize: config.uploads.maxSizeBytes },
});

export const router = Router();

// ================= SYSTEM STATUS =================
router.get('/system/status', (_req, res) => {
  res.json({
    database_mode: DatabaseManager.getDatabaseMode(),
    is_postgres: DatabaseManager.isPostgres(),
    is_demo_mode: DatabaseManager.isDemoMode(),
  });
});

// ================= AUTH ROUTES =================
router.post('/auth/register', authController.register);
router.post('/auth/login', authController.login);
router.get('/auth/profile', authenticateJWT, authController.getProfile);
router.put('/auth/settings', authenticateJWT, authController.updateSettings);

// ================= PROJECT ROUTES =================
router.get('/projects', authenticateJWT, projectController.listProjects);
router.post('/projects', authenticateJWT, projectController.createProject);
router.get('/projects/:id', authenticateJWT, projectController.getProject);
router.put('/projects/:id', authenticateJWT, projectController.updateProject);
router.delete('/projects/:id', authenticateJWT, projectController.deleteProject);

// ================= DATASET ROUTES =================
router.get('/datasets', authenticateJWT, datasetController.listDatasets);
router.post('/datasets/upload', authenticateJWT, upload.single('file'), datasetController.uploadDataset);
router.get('/datasets/:id', authenticateJWT, datasetController.getDataset);
router.delete('/datasets/:id', authenticateJWT, datasetController.deleteDataset);

// ================= SCHEMA ROUTES =================
router.get('/schema', authenticateJWT, schemaController.getSchema);
router.post('/schema/generate', authenticateJWT, schemaController.generateSchema);
router.post('/schema/execute', authenticateJWT, schemaController.executeDDL);

// ================= CONVERSATION ROUTES =================
router.get('/conversations/search', authenticateJWT, conversationController.searchConversations);
router.get('/conversations', authenticateJWT, conversationController.listConversations);
router.post('/conversations', authenticateJWT, conversationController.createConversation);
router.get('/conversations/:id', authenticateJWT, conversationController.getConversation);
router.put('/conversations/:id', authenticateJWT, conversationController.updateConversation);
router.delete('/conversations/:id', authenticateJWT, conversationController.deleteConversation);

// ================= SQL EXECUTION ROUTES =================
router.post('/sql/validate', authenticateJWT, sqlController.validateSQL);
router.post('/sql/preview', authenticateJWT, sqlController.previewSQL);
router.post('/sql/execute', authenticateJWT, sqlController.executeSQL);
router.get('/sql/history', authenticateJWT, sqlController.getQueryHistory);

// ================= AI ROUTES =================
router.post('/ai/chat', authenticateJWT, aiController.handleAIChat);
router.post('/ai/insights', authenticateJWT, aiController.getInsights);
router.post('/ai/index-document', authenticateJWT, aiController.indexDocument);

// ================= DASHBOARD ROUTES =================
router.get('/dashboards', authenticateJWT, dashboardController.listDashboards);
router.post('/dashboards', authenticateJWT, dashboardController.createDashboard);
router.get('/dashboards/:id', authenticateJWT, dashboardController.getDashboard);
router.post('/dashboards/:id/widgets', authenticateJWT, dashboardController.addWidget);
