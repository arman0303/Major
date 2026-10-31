import React, { useState } from 'react';
import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  AreaChart,
  Area,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import {
  Table as TableIcon,
  BarChart3,
  LineChart as LineChartIcon,
  PieChart as PieChartIcon,
  TrendingUp,
  Download,
  Settings2,
  Sparkles,
} from 'lucide-react';
import { VisualizationConfig } from '../types';

interface DataVisualizationProps {
  records: any[];
  columns: string[];
  config?: VisualizationConfig;
  onSaveToDashboard?: (config: VisualizationConfig) => void;
}

const COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6',
  '#ec4899', '#06b6d4', '#14b8a6', '#f97316', '#6366f1'
];

export const DataVisualization: React.FC<DataVisualizationProps> = ({
  records,
  columns,
  config,
  onSaveToDashboard,
}) => {
  const [activeType, setActiveType] = useState<string>(config?.chart_type || 'table');
  const [xAxis, setXAxis] = useState<string>(config?.x_axis || columns[0] || '');
  const [yAxis, setYAxis] = useState<string>(config?.y_axis || columns[1] || columns[0] || '');
  const [sortCol, setSortCol] = useState<string | null>(null);
  const [sortAsc, setSortAsc] = useState<boolean>(true);
  const [searchTerm, setSearchTerm] = useState<string>('');
  const [page, setPage] = useState<number>(1);
  const pageSize = 10;

  if (!records || records.length === 0) {
    return (
      <div className="p-8 text-center text-muted-foreground bg-muted/20 rounded-lg border border-border">
        No records returned.
      </div>
    );
  }

  // Filter & Sort for Table View
  let filtered = records.filter(row =>
    columns.some(c => String(row[c] || '').toLowerCase().includes(searchTerm.toLowerCase()))
  );

  if (sortCol) {
    filtered = [...filtered].sort((a, b) => {
      const valA = a[sortCol];
      const valB = b[sortCol];
      if (typeof valA === 'number' && typeof valB === 'number') {
        return sortAsc ? valA - valB : valB - valA;
      }
      return sortAsc
        ? String(valA || '').localeCompare(String(valB || ''))
        : String(valB || '').localeCompare(String(valA || ''));
    });
  }

  const paginated = filtered.slice((page - 1) * pageSize, page * pageSize);
  const totalPages = Math.ceil(filtered.length / pageSize);

  // CSV Export
  const downloadCSV = () => {
    const header = columns.join(',');
    const rows = records.map(r =>
      columns.map(c => `"${String(r[c] ?? '').replace(/"/g, '""')}"`).join(',')
    );
    const csvContent = 'data:text/csv;charset=utf-8,' + [header, ...rows].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `query_results_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Convert values for chart display safely
  const chartData = records.slice(0, 50).map(r => {
    const item: any = { ...r };
    columns.forEach(c => {
      const num = Number(r[c]);
      if (!isNaN(num) && typeof r[c] !== 'boolean') {
        item[c] = num;
      }
    });
    return item;
  });

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-4 shadow-sm">
      {/* Controls Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border pb-3">
        <div className="flex items-center gap-1.5 bg-muted/50 p-1 rounded-lg">
          <button
            onClick={() => setActiveType('table')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeType === 'table' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <TableIcon className="w-3.5 h-3.5" />
            Table
          </button>
          <button
            onClick={() => setActiveType('bar')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeType === 'bar' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            Bar
          </button>
          <button
            onClick={() => setActiveType('line')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeType === 'line' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <LineChartIcon className="w-3.5 h-3.5" />
            Line
          </button>
          <button
            onClick={() => setActiveType('area')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeType === 'area' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            Area
          </button>
          <button
            onClick={() => setActiveType('pie')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeType === 'pie' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <PieChartIcon className="w-3.5 h-3.5" />
            Pie
          </button>
          <button
            onClick={() => setActiveType('donut')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeType === 'donut' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <PieChartIcon className="w-3.5 h-3.5" />
            Donut
          </button>
          <button
            onClick={() => setActiveType('kpi')}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-all ${
              activeType === 'kpi' ? 'bg-primary text-primary-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            <Sparkles className="w-3.5 h-3.5" />
            KPI
          </button>
        </div>

        {/* Right action controls */}
        <div className="flex items-center gap-2">
          {activeType !== 'table' && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-muted-foreground font-medium">X:</span>
              <select
                value={xAxis}
                onChange={e => setXAxis(e.target.value)}
                className="bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none"
              >
                {columns.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>

              <span className="text-muted-foreground font-medium">Y:</span>
              <select
                value={yAxis}
                onChange={e => setYAxis(e.target.value)}
                className="bg-muted border border-border rounded px-2 py-1 text-xs focus:outline-none"
              >
                {columns.map(c => (
                  <option key={c} value={c}>{c}</option>
                ))}
              </select>
            </div>
          )}

          <button
            onClick={downloadCSV}
            className="flex items-center gap-1 text-xs px-2.5 py-1.5 rounded-md border border-border hover:bg-muted text-foreground transition-all"
            title="Download records as CSV"
          >
            <Download className="w-3.5 h-3.5" />
            CSV
          </button>
        </div>
      </div>

      {/* Viewport */}
      {activeType === 'table' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <input
              type="text"
              placeholder="Search returned records..."
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="text-xs bg-muted/50 border border-border rounded-md px-3 py-1.5 w-64 focus:outline-none focus:ring-1 focus:ring-primary"
            />
            <span className="text-xs text-muted-foreground">
              Showing {filtered.length} row(s)
            </span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-border max-h-[380px]">
            <table className="w-full text-left text-xs">
              <thead className="bg-muted/80 sticky top-0 backdrop-blur z-10 border-b border-border">
                <tr>
                  {columns.map(c => (
                    <th
                      key={c}
                      onClick={() => {
                        if (sortCol === c) setSortAsc(!sortAsc);
                        else {
                          setSortCol(c);
                          setSortAsc(true);
                        }
                      }}
                      className="px-3 py-2.5 font-semibold text-foreground cursor-pointer hover:bg-muted select-none"
                    >
                      <div className="flex items-center gap-1">
                        <span>{c}</span>
                        {sortCol === c && (
                          <span className="text-[10px] text-primary">{sortAsc ? '▲' : '▼'}</span>
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {paginated.map((row, idx) => (
                  <tr key={idx} className="hover:bg-muted/40 transition-colors">
                    {columns.map(col => (
                      <td key={col} className="px-3 py-2 font-mono text-muted-foreground">
                        {row[col] !== null && row[col] !== undefined ? String(row[col]) : <span className="text-muted-foreground/40 italic">null</span>}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between text-xs pt-2">
              <span className="text-muted-foreground">
                Page {page} of {totalPages}
              </span>
              <div className="flex items-center gap-1">
                <button
                  disabled={page === 1}
                  onClick={() => setPage(p => p - 1)}
                  className="px-2 py-1 rounded border border-border disabled:opacity-40"
                >
                  Prev
                </button>
                <button
                  disabled={page === totalPages}
                  onClick={() => setPage(p => p + 1)}
                  className="px-2 py-1 rounded border border-border disabled:opacity-40"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* KPI Cards Mode */}
      {activeType === 'kpi' && (
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 py-6">
          <div className="p-6 rounded-xl border border-primary/20 bg-primary/5 flex flex-col justify-center">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{yAxis} Total</span>
            <span className="text-3xl font-extrabold text-foreground mt-2">
              {records.reduce((acc, r) => acc + (Number(r[yAxis]) || 0), 0).toLocaleString()}
            </span>
          </div>
          <div className="p-6 rounded-xl border border-border bg-card flex flex-col justify-center">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">Record Count</span>
            <span className="text-3xl font-extrabold text-primary mt-2">{records.length}</span>
          </div>
          <div className="p-6 rounded-xl border border-border bg-card flex flex-col justify-center">
            <span className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{yAxis} Average</span>
            <span className="text-3xl font-extrabold text-foreground mt-2">
              {(
                records.reduce((acc, r) => acc + (Number(r[yAxis]) || 0), 0) / (records.length || 1)
              ).toFixed(2)}
            </span>
          </div>
        </div>
      )}

      {/* Bar Chart Mode */}
      {activeType === 'bar' && (
        <div className="h-[320px] w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey={xAxis} angle={-25} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} />
              <Bar dataKey={yAxis} fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Line Chart Mode */}
      {activeType === 'line' && (
        <div className="h-[320px] w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 25 }}>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey={xAxis} angle={-25} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} />
              <Line type="monotone" dataKey={yAxis} stroke="#10b981" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Area Chart Mode */}
      {activeType === 'area' && (
        <div className="h-[320px] w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chartData} margin={{ top: 10, right: 20, left: 10, bottom: 25 }}>
              <defs>
                <linearGradient id="areaGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.6}/>
                  <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0.0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" opacity={0.2} />
              <XAxis dataKey={xAxis} angle={-25} textAnchor="end" interval={0} tick={{ fontSize: 11 }} />
              <YAxis tick={{ fontSize: 11 }} />
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} />
              <Area type="monotone" dataKey={yAxis} stroke="#8b5cf6" strokeWidth={2} fillOpacity={1} fill="url(#areaGrad)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      )}

      {/* Pie & Donut Chart Modes */}
      {(activeType === 'pie' || activeType === 'donut') && (
        <div className="h-[320px] w-full pt-2 flex items-center justify-center">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }} />
              <Legend verticalAlign="bottom" height={36} />
              <Pie
                data={chartData.slice(0, 8)}
                dataKey={yAxis}
                nameKey={xAxis}
                cx="50%"
                cy="50%"
                innerRadius={activeType === 'donut' ? 60 : 0}
                outerRadius={95}
                paddingAngle={3}
                label={({ name, percent }) => `${name} (${(percent * 100).toFixed(0)}%)`}
              >
                {chartData.slice(0, 8).map((_, index) => (
                  <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                ))}
              </Pie>
            </PieChart>
          </ResponsiveContainer>
        </div>
      )}
    </div>
  );
};
