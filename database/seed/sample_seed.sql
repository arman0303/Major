-- ==============================================================
-- Sample Dataset Seed: Company Management & Analytics
-- ==============================================================

-- 1. Departments Table
CREATE TABLE IF NOT EXISTS departments (
    department_id SERIAL PRIMARY KEY,
    department_name VARCHAR(100) NOT NULL UNIQUE,
    budget NUMERIC(15, 2) NOT NULL,
    location VARCHAR(100) NOT NULL
);

INSERT INTO departments (department_id, department_name, budget, location)
VALUES
    (1, 'Engineering', 1200000.00, 'San Francisco'),
    (2, 'Product & Design', 650000.00, 'New York'),
    (3, 'Sales & Marketing', 950000.00, 'Austin'),
    (4, 'Human Resources', 350000.00, 'Chicago'),
    (5, 'Finance & Legal', 500000.00, 'Boston')
ON CONFLICT (department_id) DO NOTHING;

-- 2. Employees Table
CREATE TABLE IF NOT EXISTS employees (
    employee_id SERIAL PRIMARY KEY,
    first_name VARCHAR(50) NOT NULL,
    last_name VARCHAR(50) NOT NULL,
    email VARCHAR(100) UNIQUE NOT NULL,
    department_id INTEGER REFERENCES departments(department_id) ON DELETE SET NULL,
    role VARCHAR(100) NOT NULL,
    salary NUMERIC(12, 2) NOT NULL,
    hire_date DATE NOT NULL,
    performance_rating NUMERIC(3, 2) DEFAULT 4.0
);

INSERT INTO employees (employee_id, first_name, last_name, email, department_id, role, salary, hire_date, performance_rating)
VALUES
    (1, 'Arman', 'Khan', 'arman.khan@company.com', 1, 'Lead Architect', 145000.00, '2021-03-15', 4.90),
    (2, 'Sarah', 'Connor', 'sarah.connor@company.com', 1, 'Senior Backend Engineer', 128000.00, '2021-06-01', 4.70),
    (3, 'Rahul', 'Sharma', 'rahul.sharma@company.com', 4, 'HR Manager', 78000.00, '2020-01-10', 4.50),
    (4, 'Elena', 'Rostova', 'elena.rostova@company.com', 2, 'Principal Product Designer', 115000.00, '2022-02-18', 4.80),
    (5, 'David', 'Miller', 'david.miller@company.com', 3, 'Sales Director', 132000.00, '2019-11-05', 4.60),
    (6, 'Amina', 'Zubair', 'amina.zubair@company.com', 1, 'Full Stack Engineer', 98000.00, '2023-01-20', 4.40),
    (7, 'Marcus', 'Vance', 'marcus.vance@company.com', 5, 'Financial Controller', 105000.00, '2021-08-12', 4.30),
    (8, 'Priya', 'Patel', 'priya.patel@company.com', 3, 'Account Executive', 82000.00, '2022-07-01', 4.50),
    (9, 'Liam', 'O''Connor', 'liam.oconnor@company.com', NULL, 'Independent Contractor', 65000.00, '2024-01-15', 3.90),
    (10, 'Maya', 'Lin', 'maya.lin@company.com', 1, 'Data Scientist', 122000.00, '2022-09-10', 4.80)
ON CONFLICT (employee_id) DO NOTHING;

-- 3. Projects Table
CREATE TABLE IF NOT EXISTS projects_data (
    project_id SERIAL PRIMARY KEY,
    project_name VARCHAR(150) NOT NULL,
    status VARCHAR(50) NOT NULL,
    budget NUMERIC(15, 2) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE
);

INSERT INTO projects_data (project_id, project_name, status, budget, start_date, end_date)
VALUES
    (101, 'AI Analytics Engine', 'Active', 450000.00, '2023-01-01', '2024-12-31'),
    (102, 'Cloud Infrastructure Migration', 'Active', 300000.00, '2023-06-15', '2024-06-30'),
    (103, 'Customer Portal Redesign', 'Completed', 180000.00, '2022-09-01', '2023-05-31'),
    (104, 'Enterprise Security Hardening', 'Active', 220000.00, '2023-11-01', '2024-08-31')
ON CONFLICT (project_id) DO NOTHING;

-- 4. Employee Projects Join Table
CREATE TABLE IF NOT EXISTS employee_projects (
    id SERIAL PRIMARY KEY,
    employee_id INTEGER NOT NULL REFERENCES employees(employee_id) ON DELETE CASCADE,
    project_id INTEGER NOT NULL REFERENCES projects_data(project_id) ON DELETE CASCADE,
    role_in_project VARCHAR(100) NOT NULL,
    allocation_pct INTEGER NOT NULL CHECK (allocation_pct > 0 AND allocation_pct <= 100)
);

INSERT INTO employee_projects (employee_id, project_id, role_in_project, allocation_pct)
VALUES
    (1, 101, 'Technical Lead', 60),
    (1, 102, 'Advisory Architect', 40),
    (2, 101, 'Backend Engineer', 70),
    (2, 104, 'Security Implementer', 30),
    (4, 101, 'UX Lead', 50),
    (4, 103, 'Design Systems Lead', 50),
    (6, 102, 'DevOps Engineer', 100),
    (10, 101, 'Lead ML Researcher', 100);

-- 5. Sales Orders Table
CREATE TABLE IF NOT EXISTS sales_orders (
    order_id SERIAL PRIMARY KEY,
    order_date DATE NOT NULL,
    customer_name VARCHAR(150) NOT NULL,
    customer_region VARCHAR(100) NOT NULL,
    product_category VARCHAR(100) NOT NULL,
    product_name VARCHAR(150) NOT NULL,
    unit_price NUMERIC(12, 2) NOT NULL,
    quantity INTEGER NOT NULL,
    discount NUMERIC(5, 2) DEFAULT 0.00,
    total_amount NUMERIC(14, 2) NOT NULL,
    payment_method VARCHAR(50) NOT NULL,
    status VARCHAR(50) NOT NULL
);

INSERT INTO sales_orders (order_id, order_date, customer_name, customer_region, product_category, product_name, unit_price, quantity, discount, total_amount, payment_method, status)
VALUES
    (1001, '2023-01-15', 'Acme Corp', 'North America', 'Software', 'Enterprise Cloud License', 1200.00, 5, 0.10, 5400.00, 'Wire Transfer', 'Delivered'),
    (1002, '2023-01-20', 'Apex Logistics', 'Europe', 'Hardware', 'Data Center Server Rack', 3500.00, 2, 0.05, 6650.00, 'Credit Card', 'Delivered'),
    (1003, '2023-02-05', 'BioGen Labs', 'North America', 'Services', 'Consulting Services (Hour)', 250.00, 40, 0.00, 10000.00, 'Wire Transfer', 'Delivered'),
    (1004, '2023-02-18', 'Starlight Retail', 'Asia', 'Software', 'Analytics Pro Subscription', 499.00, 10, 0.15, 4241.50, 'Credit Card', 'Delivered'),
    (1005, '2023-03-10', 'Nexus Media', 'Europe', 'Software', 'Enterprise Cloud License', 1200.00, 3, 0.00, 3600.00, 'PayPal', 'Delivered'),
    (1006, '2023-03-22', 'Summit Health', 'North America', 'Hardware', 'Security Appliance', 1800.00, 4, 0.10, 6480.00, 'Wire Transfer', 'Delivered'),
    (1007, '2023-04-12', 'Horizon Energy', 'Europe', 'Services', 'Migration Support', 150.00, 50, 0.05, 7125.00, 'Wire Transfer', 'Delivered'),
    (1008, '2023-04-28', 'Acme Corp', 'North America', 'Hardware', 'Network Switch 48-Port', 850.00, 6, 0.10, 4590.00, 'Credit Card', 'Delivered'),
    (1009, '2023-05-15', 'Fintech Global', 'Asia', 'Software', 'Enterprise Cloud License', 1200.00, 8, 0.20, 7680.00, 'Wire Transfer', 'Delivered'),
    (1010, '2023-05-30', 'BioGen Labs', 'North America', 'Hardware', 'Data Center Server Rack', 3500.00, 1, 0.00, 3500.00, 'Credit Card', 'Delivered'),
    (1011, '2023-06-14', 'Quantum Robotics', 'North America', 'Software', 'Analytics Pro Subscription', 499.00, 15, 0.10, 6736.50, 'Credit Card', 'Delivered'),
    (1012, '2023-06-28', 'Apex Logistics', 'Europe', 'Services', 'Consulting Services (Hour)', 250.00, 20, 0.00, 5000.00, 'Wire Transfer', 'Delivered'),
    (1013, '2023-07-10', 'Starlight Retail', 'Asia', 'Hardware', 'Security Appliance', 1800.00, 2, 0.05, 3420.00, 'PayPal', 'Delivered'),
    (1014, '2023-07-25', 'Nexus Media', 'Europe', 'Services', 'Migration Support', 150.00, 30, 0.00, 4500.00, 'Wire Transfer', 'Delivered'),
    (1015, '2023-08-08', 'Horizon Energy', 'Europe', 'Software', 'Enterprise Cloud License', 1200.00, 6, 0.15, 6120.00, 'Wire Transfer', 'Delivered'),
    (1016, '2023-08-22', 'Acme Corp', 'North America', 'Services', 'Consulting Services (Hour)', 250.00, 35, 0.00, 8750.00, 'Wire Transfer', 'Delivered'),
    (1017, '2023-09-05', 'Summit Health', 'North America', 'Software', 'Analytics Pro Subscription', 499.00, 12, 0.10, 5389.20, 'Credit Card', 'Delivered'),
    (1018, '2023-09-19', 'Fintech Global', 'Asia', 'Hardware', 'Network Switch 48-Port', 850.00, 10, 0.15, 7225.00, 'Wire Transfer', 'Delivered'),
    (1019, '2023-10-10', 'BioGen Labs', 'North America', 'Software', 'Enterprise Cloud License', 1200.00, 4, 0.05, 4560.00, 'Credit Card', 'Delivered'),
    (1020, '2023-10-28', 'Quantum Robotics', 'North America', 'Hardware', 'Data Center Server Rack', 3500.00, 3, 0.10, 9450.00, 'Wire Transfer', 'Delivered')
ON CONFLICT (order_id) DO NOTHING;
