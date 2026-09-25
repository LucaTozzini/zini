import {
  DataTypes,
  Model,
  type CreationOptional,
  type InferAttributes,
  type InferCreationAttributes,
} from "sequelize";
import type { SetupStatus } from "shared";
import { sequelize } from "../db.js";

// A Linear issue that has a workspace. The worktree on disk is the record of its
// folder and branch; this row marks that it exists and is where per-workspace data
// will go.
export class Workspace extends Model<InferAttributes<Workspace>, InferCreationAttributes<Workspace>> {
  declare issueId: string;
  // Whether the setup command has run in it: running, ready or failed.
  declare setupStatus: CreationOptional<SetupStatus>;
  // Why setup failed, e.g. "Exited with code 1"; null otherwise.
  declare setupError: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

Workspace.init(
  {
    issueId: { type: DataTypes.STRING, primaryKey: true },
    // Workspaces made before setup existed, or with no setup command, are ready.
    setupStatus: { type: DataTypes.STRING, allowNull: false, defaultValue: "ready" },
    setupError: { type: DataTypes.TEXT, allowNull: true, defaultValue: null },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "workspaces" },
);
