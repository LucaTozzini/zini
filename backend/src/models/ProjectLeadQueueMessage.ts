import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../db.js";
import { ProjectLeadThread } from "./ProjectLeadThread.js";

export type QueuedMessage = { eventId: string; source: string; sourceId: string; eventType: string; content: string };
export class ProjectLeadQueueMessage extends Model<InferAttributes<ProjectLeadQueueMessage>, InferCreationAttributes<ProjectLeadQueueMessage>> {
  declare id: CreationOptional<number>;
  declare threadId: string;
  declare eventId: string;
  declare source: string;
  declare sourceId: string;
  declare eventType: string;
  declare content: string;
  declare status: CreationOptional<"pending" | "processing" | "delivered">;
  declare claimToken: CreationOptional<string | null>;
  declare createdAt: CreationOptional<Date>;
  declare updatedAt: CreationOptional<Date>;
}
ProjectLeadQueueMessage.init({
  id: { type: DataTypes.INTEGER, primaryKey: true, autoIncrement: true },
  threadId: { type: DataTypes.STRING, allowNull: false, references: { model: ProjectLeadThread, key: "id" }, onDelete: "CASCADE" },
  eventId: { type: DataTypes.STRING, allowNull: false },
  source: { type: DataTypes.STRING, allowNull: false },
  sourceId: { type: DataTypes.STRING, allowNull: false },
  eventType: { type: DataTypes.STRING, allowNull: false },
  content: { type: DataTypes.TEXT, allowNull: false },
  status: { type: DataTypes.STRING, allowNull: false, defaultValue: "pending" },
  claimToken: { type: DataTypes.STRING, allowNull: true, defaultValue: null },
  createdAt: DataTypes.DATE,
  updatedAt: DataTypes.DATE,
}, { sequelize, tableName: "project_lead_message_queue", indexes: [
  { unique: true, fields: ["threadId", "eventId"] },
  { fields: ["status", "threadId", "createdAt"] },
] });
