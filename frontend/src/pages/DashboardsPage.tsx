import React, { useState, useEffect } from 'react';
import { LayoutDashboard, Plus, BarChart3, TrendingUp, PieChart, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { api } from '../services/api';
import { DataVisualization } from '../components/DataVisualization';

export const DashboardsPage: React.FC = () => {
  const { activeProject } = useAuth();
  const [activeTab, setActiveTab] = useState<'overview' | 'executive'>('overview');

  // Sample data for pre-configured live dashboard widgets
  const deptData = [
    { department_name: 'Engineering', avg_salary: 125000, employee_count: 5 },
    { department_name: 'Sales & Marketing', avg_salary: 107000, employee_count: 2 },
    { department_name: 'Product & Design', avg_salary: 115000, employee_count: 1 },
    { department_name: 'Finance & Legal', avg_salary: 105000, employee_count: 1 },
    { department_name: 'Human Resources', avg_salary: 78000, employee_count: 1 },
  ];

  const salesData = [
    { order_month: '2023-01', monthly_revenue: 12050, total_orders: 2 },
    { order_month: '2023-02', monthly_revenue: 14241, total_orders: 2 },
    { order_month: '2023-03', monthly_revenue: 10080, total_orders: 2 },
    { order_month: '2023-04', monthly_revenue: 11715, total_orders: 2 },
    { order_month: '2023-05', monthly_revenue: 11180, total_orders: 2 },
    { order_month: '2023-06', monthly_revenue: 11736, total_orders: 2 },
    { order_month: '2023-07', monthly_revenue: 7920, total_orders: 2 },
    { order_month: '2023-08', monthly_revenue: 14870, total_orders: 2 },
    { order_month: '2023-09', monthly_revenue: 12614, total_orders: 2 },
    { order_month: '2023-10', monthly_revenue: 14010, total_orders: 2 },
  ];

  const regionData = [
    { customer_region: 'North America', regional_sales: 60060 },
    { customer_region: 'Europe', regional_sales: 33495 },
    { customer_region: 'Asia', regional_sales: 22566 },
  ];

  return (
    <div className="flex-1 overflow-y-auto p-8 space-y-8 bg-background">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border pb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground flex items-center gap-2.5">
            <LayoutDashboard className="w-6 h-6 text-primary" />
            Executive Analytics Dashboard
          </h1>
          <p className="text-xs text-muted-foreground mt-1">
            Real-time visual reports and business intelligence metrics generated directly from live SQL executions.
          </p>
        </div>
      </div>

      {/* KPI Cards Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="p-5 rounded-xl border border-border bg-card shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Total Sales Revenue</span>
          <div className="text-2xl font-extrabold text-foreground">$116,121.70</div>
          <span className="text-[11px] text-emerald-500 font-medium">↑ +14.2% QoQ growth</span>
        </div>
        <div className="p-5 rounded-xl border border-border bg-card shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Active Employees</span>
          <div className="text-2xl font-extrabold text-foreground">10 Staff</div>
          <span className="text-[11px] text-muted-foreground">Across 5 departments</span>
        </div>
        <div className="p-5 rounded-xl border border-border bg-card shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Average Organization Salary</span>
          <div className="text-2xl font-extrabold text-primary">$107,000</div>
          <span className="text-[11px] text-emerald-500 font-medium">Top dept: Engineering</span>
        </div>
        <div className="p-5 rounded-xl border border-border bg-card shadow-sm space-y-1">
          <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">Enterprise Projects</span>
          <div className="text-2xl font-extrabold text-foreground">4 Projects</div>
          <span className="text-[11px] text-primary font-medium">$1.15M Allocated budget</span>
        </div>
      </div>

      {/* Grid of Interactive Widgets */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Widget 1: Monthly Revenue Trend */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between border-b border-border/80 pb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-500" />
              <h3 className="font-semibold text-xs text-foreground">Monthly Revenue Growth</h3>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">sales_orders</span>
          </div>
          <DataVisualization
            records={salesData}
            columns={['order_month', 'monthly_revenue', 'total_orders']}
            config={{
              chart_type: 'line',
              x_axis: 'order_month',
              y_axis: 'monthly_revenue',
              title: 'Monthly Revenue',
            }}
          />
        </div>

        {/* Widget 2: Department Salary Distribution */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm">
          <div className="flex items-center justify-between border-b border-border/80 pb-3">
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" />
              <h3 className="font-semibold text-xs text-foreground">Department Salary Breakdown</h3>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">departments ⨝ employees</span>
          </div>
          <DataVisualization
            records={deptData}
            columns={['department_name', 'avg_salary', 'employee_count']}
            config={{
              chart_type: 'bar',
              x_axis: 'department_name',
              y_axis: 'avg_salary',
              title: 'Average Salary',
            }}
          />
        </div>

        {/* Widget 3: Regional Sales Contribution */}
        <div className="rounded-xl border border-border bg-card p-5 space-y-3 shadow-sm lg:col-span-2">
          <div className="flex items-center justify-between border-b border-border/80 pb-3">
            <div className="flex items-center gap-2">
              <PieChart className="w-4 h-4 text-amber-500" />
              <h3 className="font-semibold text-xs text-foreground">Regional Revenue Contribution</h3>
            </div>
            <span className="text-[10px] font-mono text-muted-foreground">GROUP BY customer_region</span>
          </div>
          <DataVisualization
            records={regionData}
            columns={['customer_region', 'regional_sales']}
            config={{
              chart_type: 'donut',
              x_axis: 'customer_region',
              y_axis: 'regional_sales',
              title: 'Revenue by Region',
            }}
          />
        </div>
      </div>
    </div>
  );
};
