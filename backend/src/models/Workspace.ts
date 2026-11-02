import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../db.js";
import { projectIdColumn } from "./Project.js";
import type { WorkspaceContext } from "shared";

// Workspace identity and selected branch are stored here, so metadata reads do
// not need Docker. Live Git status is queried separately when it is needed. The
// project is the one whose repo the workspace was cloned from.
export class Workspace extends Model<InferAttributes<Workspace>, InferCreationAttributes<Workspace>> {
  declare issueId: string;
  declare projectId: number;
  declare context: CreationOptional<WorkspaceContext | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Workspace.init(
  {
    issueId: { type: DataTypes.STRING, primaryKey: true },
    projectId: projectIdColumn,
    context: { type: DataTypes.JSON, allowNull: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "workspaces" },
);
