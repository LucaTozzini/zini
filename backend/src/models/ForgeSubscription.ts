import { DataTypes, Model, type CreationOptional, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../db.js";
import { ProjectLeadThread } from "./ProjectLeadThread.js";

export class ForgeSubscription extends Model<InferAttributes<ForgeSubscription>, InferCreationAttributes<ForgeSubscription>> {
  declare threadId: string;
  declare issueId: string;
  declare createdAt: CreationOptional<Date>;
}
ForgeSubscription.init({
  threadId: { type: DataTypes.STRING, primaryKey: true, references: { model: ProjectLeadThread, key: "id" }, onDelete: "CASCADE" },
  issueId: { type: DataTypes.STRING, primaryKey: true },
  createdAt: DataTypes.DATE,
}, { sequelize, tableName: "project_lead_subscriptions", updatedAt: false, indexes: [{ fields: ["issueId"] }] });
