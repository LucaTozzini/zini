import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from "sequelize";
import { sequelize } from "../db.js";

// A Linear issue that has a workspace. The worktree on disk is the record of its
// folder and branch; this row marks that it exists and is where per-workspace data
// will go.
export class Workspace extends Model<InferAttributes<Workspace>, InferCreationAttributes<Workspace>> {
  declare issueId: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Workspace.init(
  {
    issueId: { type: DataTypes.STRING, primaryKey: true },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "workspaces" },
);
