# REST API Documentation

Base URL: `http://localhost:5000/api`

## Authentication
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/auth/register` | Register a new user | No |
| `POST` | `/auth/login` | Authenticate user, returns JWT tokens | No |
| `GET` | `/auth/profile` | Retrieve user profile & settings | Yes |
| `PUT` | `/auth/settings` | Update LLM provider, API keys, theme | Yes |

## Projects
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/projects` | List all user-owned projects | Yes |
| `POST` | `/projects` | Create a new isolated project | Yes |
| `GET` | `/projects/:id` | Get project details and datasets | Yes |
| `PUT` | `/projects/:id` | Rename / update project | Yes |
| `DELETE` | `/projects/:id` | Delete project and cascade data | Yes |

## Datasets
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/datasets` | List datasets for project | Yes |
| `POST` | `/datasets/upload` | Upload & ingest CSV/JSON/PDF | Yes |
| `GET` | `/datasets/:id` | Get dataset details | Yes |
| `DELETE` | `/datasets/:id` | Delete dataset and drop table | Yes |

## Schema & ER Design
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `GET` | `/schema` | Get tables, columns, foreign keys | Yes |
| `POST` | `/schema/generate` | Generate schema from natural language | Yes |
| `POST` | `/schema/execute` | Apply confirmed DDL statements | Yes |

## Conversational AI
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/ai/chat` | End-to-end Text-to-SQL turn | Yes |
| `POST` | `/ai/insights` | Statistical summaries and outliers | Yes |

## SQL Execution
| Method | Endpoint | Description | Auth Required |
|---|---|---|---|
| `POST` | `/sql/validate` | AST validation via SQLGlot | Yes |
| `POST` | `/sql/preview` | Preview mutation record impact | Yes |
| `POST` | `/sql/execute` | Execute query against database | Yes |
| `GET` | `/sql/history` | Audit log of past queries | Yes |
