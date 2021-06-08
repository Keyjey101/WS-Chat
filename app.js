//constants
require("dotenv").config();
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const WebSocket = require("ws");

const router = require("./router/Router");
const jwt = require("jsonwebtoken");

const client = require('./db')


const PORT = process.env.PORT || 5000;

//middleware
app.use(express.json());
app.use(express.static("client"));

// api/reg POST       creating user and send back token in JSON
// api/login POST     checking password/user and send back token in JSON
app.use("/api", router);

const start = async () => {
  try {
    await client.connect();

    /*
    await sequelize.authenticate();
    await sequelize.sync();
    */
    //инициализация вс-сервера
    const wss = new WebSocket.Server({ server: server });

    //массив для авторизованных подключений
    AUTHCLIENTS = [];

    //массив где хранятся decoded токены, для проверки авторизован ли пользователь.
    //Наверно стоило делать это через промежуточные гет запросы к api/auth или хранить токен
    //в каком-нибудь методе для сообщения, но с двумя полями (юзер+мессадж) не понимаю как это сделать
    //реализованная ниже схема имеет уязвимости, в том плане, что зарегестрированный юзер, может поменять
    //при отправке сообщения свой username на другого (тоже зареганого) и писать от его имени
    USERS = [];

    //слушатель событий на вс
    wss.on("connection", function connection(ws) {
      console.log("A new nonAuth client Connected!");
      ws.send("Войдите через api/login or api/reg для отправки сообщений");

      //слушатель события по сообщению
      ws.on("message", async function incoming(data) {
        //тут я не очень понял начальные условия, сокет же не умеет получать/отправлять данные JSON
        try {
          // поэтому я сделал string->JSON
          data = JSON.parse(data);

          //проверка на сообщение об авторизации
          if (data.message.split(" ")[0] === "auth") {
            //выцепляем токен
            const token = data.message.split(" ")[1];
            //проверяем токен
            const isAuth = jwt.verify(
              token,
              process.env.JWT,
              function (err, decoded) {
                if (decoded.username === data.username) {
                  //с помощью колбека пушим данные о подключении и юзере в хранилища
                  AUTHCLIENTS.push(ws);
                  USERS.push(decoded.username);
                  console.log("New authorizaited client");
                  ws.send(
                    "Поздравляем, вы авторизированы. Ради Бога не обновляйте страницу"
                  );

                  //дату в нуль, чтобы не посылать остальным
                  data = null;
                } else {
                  ws.send("Wrong username");
                  data = null;
                }
              }
            );
          }

          //Здесь история без всяких айдишников и такого, просто по порядку, но тогда без Promise.all, но кода меньше и проще читается

          if (
            data !== null &&
            data.message.split(" ")[0] === "simple" &&
            AUTHCLIENTS.includes(ws)
          ) {
            const count2 = Number.parseInt(data.message.split(" ")[1]);

            const mess = await client.query(
              'SELECT * FROM "messages" JOIN "users" ON messages."userId" = users.id order by messages."createdAt" desc limit $1',
              [count2]
            );

            mess.rows.forEach((element) => {
              let hist = {};
              hist["username"] = element.username;
              hist["message"] = element.message;

              const text = JSON.stringify(hist);
              ws.send(text);
            });

            data = null;
          }

          //проверка на запрос об истории сообщений и авторизованности пользователя
          if (
            data !== null &&
            data.message.split(" ")[0] === "history" &&
            AUTHCLIENTS.includes(ws)
          ) {
            //приводим к числу
            const count = Number.parseInt(data.message.split(" ")[1]);

            //смотрим сколько всего сообщений в БД
            const lenghtSql = await client.query(
              "SELECT COUNT (*) from messages"
            );
            const lenght = lenghtSql.rows[0].count;

            //проверка не превышает ли запрашиваемое кол-во сообщений общее число сообщений в БД
            const countedMessages = count > lenght ? lenght : count;

            //Это дремучая часть, чтобы сделать promise.all, сперва думал просто через findAll
            // найти все сообщения с лимитом в count по дате создания

            //массив состоящий из единичных запросов к БД -поиск сообщений
            const ar = [];

            //счетчик
            let i = lenght - countedMessages + 1;

            //пуш в массив
            while (i <= lenght) {
              console.log("pushig id of message - ", i);
              ar.push(
                client.query(
                  'SELECT * FROM "messages" JOIN "users" ON messages."userId" = users.id AND messages.id=$1',
                  [i]
                )
              );

              i++;
            }
            
            //Промис ол! Вау!
            Promise.all(ar).then((result) => {

              //создаем массив в котором объекты из строк, возвращенных промисом
              const res1 = result.map((x) => {
                return x.rows[0];
              });

              //для каждого элемента массива создаем объект - приводим к сроке и отправляем юзеру
              res1.forEach((element) => {
                let hist = {};
                hist["username"] = element.username;
                hist["message"] = element.message;

                const text = JSON.stringify(hist);
                ws.send(text);
              });
            });

            //дату в нуль, чтобы не посылать остальным
            data = null;
          }

          //Логгирование сообщений, проверка существует ли подключение в списке авторизированных и
          //является ли сообщение служебным
          if (
            AUTHCLIENTS.includes(ws) &&
            data !== null &&
            USERS.includes(data.username)
          ) {
            
            const username = data.username;

            //поиск нужного юзера, который отправил сообщение
            const user = await client.query(
              'SELECT * FROM "users" WHERE username=$1',
              [username]
            );
            

            const userId = user.rows[0].id;
            const message = data.message;

            //добавил, потому что не отключил таймстомпы при создании модели
            const timestamp = new Date();

            //создание сообщения в БД
            const userMessage = await client.query(
              `INSERT INTO messages (message, "userId", "createdAt", "updatedAt") VALUES ($1, $2, $3, $3)`,
              [message, userId, timestamp]
            );

            
            //отправка этого сообщения всем активным пользователям
            wss.clients.forEach(function each(client) {
              if (client !== ws && client.readyState === WebSocket.OPEN) {
                data !== null && client.send(JSON.stringify(data));
              }
            });

            //Если пользователь отправил корректное сообщение, но не авторизировался
          } else if (data !== null) {
            ws.send(
              "Ваши сообщения не видны другим участникам чата, пожалуйста зарегестрируйтесь"
            );
          }

          //Скорее всего пользователь отправил некорректное сообщение, о чем ему и сообщим
        } catch (e) {
          console.log(e);
          ws.send(
            'please send something like that {"username": "hello", "password": "world"}, check this page https://github.com/Keyjey101/WS-Chat'
          );
        }
      });
    });

    server.listen(PORT, () => console.log(`Lisening on port :${PORT}`));
  } catch (e) {
    console.log(e);
  }
};
start();
