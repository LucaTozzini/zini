import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from "sequelize";
import type { ProjectProvider } from "shared";
import { sequelize } from "../db.js";
import { projectIdColumn } from "./Project.js";

// A project's key for a service connected per project (see PROJECT_PROVIDERS).
export class ProjectIntegration extends Model<InferAttributes<ProjectIntegration>, InferCreationAttributes<ProjectIntegration>> {
  declare projectId: number;
  declare provider: string;
  declare apiKey: string;
}

ProjectIntegration.init(
  {
    projectId: { ...projectIdColumn, primaryKey: true },
    provider: { type: DataTypes.STRING, primaryKey: true },
    apiKey: { type: DataTypes.STRING, allowNull: false },
  },
  { sequelize, tableName: "project_integrations" },
);

// The project's saved key for a service, or null if it isn't connected.
export async function getProjectKey(projectId: number, provider: ProjectProvider) {
  const row = await ProjectIntegration.findOne({ where: { projectId, provider } });
  return row?.apiKey ?? null;
}
