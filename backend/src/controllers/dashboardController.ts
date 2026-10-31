import { Response } from 'express';
import { AuthenticatedRequest } from '../middleware/auth.js';
import { DatabaseManager } from '../config/db.js';

export const listDashboards = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { projectId } = req.query;
  const result = await DatabaseManager.query(
    'SELECT * FROM dashboards WHERE project_id = $1 ORDER BY created_at DESC',
    [projectId]
  );
  res.json({ dashboards: result.rows });
};

export const createDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { projectId, title, description, layout } = req.body;
  const dashId = `dash_${Date.now()}`;

  await DatabaseManager.query(
    'INSERT INTO dashboards (id, project_id, title, description, layout) VALUES ($1, $2, $3, $4, $5)',
    [dashId, projectId, title, description || '', JSON.stringify(layout || [])]
  );

  res.status(201).json({
    dashboard: { id: dashId, project_id: projectId, title, description }
  });
};

export const getDashboard = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const dashResult = await DatabaseManager.query('SELECT * FROM dashboards WHERE id = $1', [id]);
  if (dashResult.rows.length === 0) {
    res.status(404).json({ error: 'Dashboard not found' });
    return;
  }

  const widgetsResult = await DatabaseManager.query('SELECT * FROM dashboard_widgets WHERE dashboard_id = $1', [id]);

  res.json({
    dashboard: dashResult.rows[0],
    widgets: widgetsResult.rows.map(w => ({
      ...w,
      chart_config: typeof w.chart_config === 'string' ? JSON.parse(w.chart_config) : w.chart_config,
    })),
  });
};

export const addWidget = async (req: AuthenticatedRequest, res: Response): Promise<void> => {
  const { id } = req.params;
  const { title, widgetType, sqlQuery, chartConfig } = req.body;
  const widgetId = `wdg_${Date.now()}`;

  await DatabaseManager.query(
    'INSERT INTO dashboard_widgets (id, dashboard_id, title, widget_type, sql_query, chart_config) VALUES ($1, $2, $3, $4, $5, $6)',
    [widgetId, id, title, widgetType, sqlQuery, JSON.stringify(chartConfig || {})]
  );

  res.status(201).json({
    widget: { id: widgetId, dashboard_id: id, title, widget_type: widgetType }
  });
};
