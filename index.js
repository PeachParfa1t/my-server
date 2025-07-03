const { Sequelize, DataTypes } = require("sequelize")

const sequelize = new Sequelize(
  process.env.DB_NAME || "ChatBotTests",
  process.env.DB_USER || "root",
  process.env.DB_PASSWORD || "",
  {
    host: process.env.DB_HOST || "localhost",
    dialect: "mysql",
    logging: false,
  },
)

// Модель пользователей
const User = sequelize.define("User", {
  telegram_id: {
    type: DataTypes.BIGINT,
    unique: true,
    allowNull: false,
  },
  username: DataTypes.STRING,
  first_name: DataTypes.STRING,
  last_name: DataTypes.STRING,
  role: {
    type: DataTypes.ENUM("admin", "user"),
    defaultValue: "user",
  },
  notifications_enabled: {
    type: DataTypes.BOOLEAN,
    defaultValue: true,
  },
})

// Модель групп
const Group = sequelize.define("Group", {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: DataTypes.TEXT,
  created_by: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: "id",
    },
  },
  status: {
    type: DataTypes.ENUM("active", "pending", "rejected"),
    defaultValue: "active",
  },
})

// Модель заявок на создание групп
const GroupRequest = sequelize.define("GroupRequest", {
  group_name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: DataTypes.TEXT,
  requested_by: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: "id",
    },
  },
  status: {
    type: DataTypes.ENUM("pending", "approved", "rejected"),
    defaultValue: "pending",
  },
})

// Модель связи пользователей и групп с ролями
const UserGroup = sequelize.define("UserGroup", {
  user_id: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: "id",
    },
  },
  group_id: {
    type: DataTypes.INTEGER,
    references: {
      model: Group,
      key: "id",
    },
  },
  role: {
    type: DataTypes.ENUM("member", "curator"),
    defaultValue: "member",
  },
})

// Модель предметов
const Subject = sequelize.define("Subject", {
  name: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  group_id: {
    type: DataTypes.INTEGER,
    references: {
      model: Group,
      key: "id",
    },
  },
  created_by: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: "id",
    },
  },
  status: {
    type: DataTypes.ENUM("active", "pending", "rejected"),
    defaultValue: "active",
  },
})

// Модель задач
const Task = sequelize.define("Task", {
  title: {
    type: DataTypes.STRING,
    allowNull: false,
  },
  description: DataTypes.TEXT,
  subject_id: {
    type: DataTypes.INTEGER,
    references: {
      model: Subject,
      key: "id",
    },
  },
  group_id: {
    type: DataTypes.INTEGER,
    references: {
      model: Group,
      key: "id",
    },
  },
  created_by: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: "id",
    },
  },
  deadline: DataTypes.DATE,
  for_all_group: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  status: {
    type: DataTypes.ENUM("active", "pending", "approved"),
    defaultValue: "active",
  },
})

// Модель выполненных задач пользователями
const UserTask = sequelize.define("UserTask", {
  user_id: {
    type: DataTypes.INTEGER,
    references: {
      model: User,
      key: "id",
    },
  },
  task_id: {
    type: DataTypes.INTEGER,
    references: {
      model: Task,
      key: "id",
    },
  },
  completed: {
    type: DataTypes.BOOLEAN,
    defaultValue: false,
  },
  completed_at: DataTypes.DATE,
})

// Ассоциации
User.hasMany(Group, { foreignKey: "created_by" })
Group.belongsTo(User, { foreignKey: "created_by" })

User.hasMany(GroupRequest, { foreignKey: "requested_by" })
GroupRequest.belongsTo(User, { foreignKey: "requested_by" })

User.belongsToMany(Group, { through: UserGroup, foreignKey: "user_id" })
Group.belongsToMany(User, { through: UserGroup, foreignKey: "group_id" })

Group.hasMany(Subject, { foreignKey: "group_id" })
Subject.belongsTo(Group, { foreignKey: "group_id" })

User.hasMany(Subject, { foreignKey: "created_by" })
Subject.belongsTo(User, { foreignKey: "created_by" })

Group.hasMany(Task, { foreignKey: "group_id" })
Task.belongsTo(Group, { foreignKey: "group_id" })

Subject.hasMany(Task, { foreignKey: "subject_id" })
Task.belongsTo(Subject, { foreignKey: "subject_id" })

User.hasMany(Task, { foreignKey: "created_by" })
Task.belongsTo(User, { foreignKey: "created_by" })

User.belongsToMany(Task, { through: UserTask, foreignKey: "user_id" })
Task.belongsToMany(User, { through: UserTask, foreignKey: "task_id" })

module.exports = {
  sequelize,
  User,
  Group,
  GroupRequest,
  UserGroup,
  Subject,
  Task,
  UserTask,
}
