import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../db.js";
import { projectIdColumn } from "./Project.js";

// A project lead chat. The messages live in the LangGraph checkpointer under
// the same id; this row is just what the chat list needs. Each chat is in one project.
export class ProjectLeadThread extends Model<InferAttributes<ProjectLeadThread>, InferCreationAttributes<ProjectLeadThread>> {
  declare id: string;
  declare projectId: number;
  declare title: string;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}

ProjectLeadThread.init(
  {
    id: { type: DataTypes.STRING, primaryKey: true },
    projectId: projectIdColumn,
    title: { type: DataTypes.STRING, allowNull: false },
    createdAt: DataTypes.DATE,
    updatedAt: DataTypes.DATE,
  },
  { sequelize, tableName: "project_lead_threads" },
);
