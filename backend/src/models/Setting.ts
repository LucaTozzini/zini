import {
  DataTypes,
  Model,
  type InferAttributes,
  type InferCreationAttributes,
} from "sequelize";
import { sequelize } from "../db.js";

// App settings as key/value rows, e.g. productManagerModel.
export class Setting extends Model<InferAttributes<Setting>, InferCreationAttributes<Setting>> {
  declare key: string;
  declare value: string;
}

Setting.init(
  {
    key: { type: DataTypes.STRING, primaryKey: true },
    // TEXT: values like a setup command can be long.
    value: { type: DataTypes.TEXT, allowNull: false },
  },
  { sequelize, tableName: "settings" },
);
