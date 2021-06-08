require("dotenv").config();
const bcrypt = require("bcrypt");
const jwt = require("jsonwebtoken");
const ApiError = require("../handlers/Error");
const client = require("../db");

//создаем токен на основе юзернэйма и строки
const jwtGenerate = (username) => {
  return jwt.sign({ username }, process.env.JWT, { expiresIn: "1h" });
};

class Controller {

  //метод регистрации
  async registration(req, res, next) {
    try {
      console.log("tryin registration");
      console.log("this is req.body", req.body);

      const { username, password } = req.body;

      const candidate = await client.query(
        'SELECT * FROM "users" WHERE username=$1 ',
        [username]
      );

      if (candidate.rows[0]) {
        return next(ApiError.badRequest("User already exist"));
      }

      //создаем хэшированный пароль и создаем юзера
      const hashPassword = await bcrypt.hash(password, 12);
      const timestamp = new Date();

      console.log("user creating");
      const user = await client.query(
        'INSERT INTO "users" (username, password, "createdAt", "updatedAt") VALUES ($1, $2, $3, $3) RETURNING *',
        [username, hashPassword, timestamp]
      );

      console.log("user created");
      console.log("username", user);
      const token = jwtGenerate(user.rows[0].username);

      return res.json({ token });
    } catch (e) {
      console.log(e);
    }
  }
  //----------------------------------------------LOGIN---------------------------------------//
  async login(req, res, next) {
    try {
      const { username, password } = req.body;

      //проверки пароля

      const user = await client.query(
        'SELECT * FROM "users" WHERE username=$1 ',
        [username]
      );

      if (!user.rows[0]) {
        return next(ApiError.internal("Wrong username and/or password"));
      }

      const isMatch = await bcrypt.compare(password, user.rows[0].password);

      if (!isMatch) {
        return next(ApiError.internal("Wrong username and/or password"));
      }

      //обновляем(создаем заново) токен

      const token = jwtGenerate(user.rows[0].username);
      return res.json({ token });
    } catch (e) {
      console.log(e);
    }
  }

  //----------------------------------------------AUTHENTICATION------------не используется----------------//
  async auth(req, res, next) {
    const token = jwtGenerate(req.user.username);
    return res.json({ token });
  }
}

module.exports = new Controller();
