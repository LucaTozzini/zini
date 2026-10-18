import { DataTypes, Model, type InferAttributes, type InferCreationAttributes } from "sequelize";
import { sequelize } from "../db.js";

// App settings as key/value rows, e.g. projectLeadModel.
export class Setting extends Model<InferAttributes<Setting>, InferCreationAttributes<Setting>> {
  declare key: string;
  declare value: string;
}

Setting.init(
  {
    key: { type: DataTypes.STRING, primaryKey: true },
    // TEXT allows settings values without an arbitrary length limit.
    value: { type: DataTypes.TEXT, allowNull: false },
  },
  { sequelize, tableName: "settings" },
);
