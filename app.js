//constants
require("dotenv").config();
const express = require("express");
const app = express();
const server = require("http").createServer(app);
const WebSocket = require("ws");
const sequelize = require("./db");
const router = require("./router/Router");
const jwt = require("jsonwebtoken");
const { Message, User } = require("./models/models");

const PORT = process.env.PORT || 5000;

//middleware
app.use(express.json());
app.use(express.static("client"));

// api/reg POST       creating user and send back token in JSON
// api/login POST     checking password/user and send back token in JSON
app.use("/api", router);

const start = async () => {
  try {
    await sequelize.authenticate();
    await sequelize.sync();
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

          //проверка на запрос об истории сообщений и авторизованности пользователя
          if (
            data !== null &&
            data.message.split(" ")[0] === "history" &&
            AUTHCLIENTS.includes(ws)
          ) {
            //приводим к числу
            const count = Number.parseInt(data.message.split(" ")[1]);

            //смотрим сколько всего сообщений в БД
            const lenght = await Message.count(); //await же тоже промис (возвращенный) по сути

            //проверка не превышает ли запрашиваемое кол-во сообщений общее число сообщений в БД
            const countedMessages = count > lenght ? lenght : count;

            //Это дремучая часть, чтобы сделать promise.all, сперва думал просто через findAll
            // найти все сообщения с лимитом в count по дате создания

            //массив состоящий из единичных запросов к БД -поиск сообщений
            const ar = [];

            //пуш в массив
            for (let i = 0; i < countedMessages; i++) {
              ar.push(Message.findOne({ where: { id: lenght - i } }));
            }

            //Вау вот это владение промисами
            Promise.all(ar).then((result) => {

              //массив состоящий из текста сообщений
              const mes = result.map((element) => {
                return element.dataValues.message;
              });

              //массив состоящий из юзер-айдишников сообщений
              const ids = result.map((element) => {
                return element.dataValues.userId;
              });

              //массив состоящий из единичных запросов к БД -поиск юзеров
              const nam = [];

              //пуш в массив, использовал другую букву, чтобы просто читалось по другому, знаю про область видимости
              for (let j = 0; j < ids.length; j++) {
                nam.push(User.findOne({ where: { id: ids[j] } }));
              }

              //опять потрясающее владение промисами
              Promise.all(nam).then((result) => {
                const names = result.map((element) => {
                  return element.dataValues.username;
                });

                //отправка сообщений, объекты хранятся в obj
                for (let k = 0; k < ids.length; k++) {
                  const plainText =
                    '{"username":' +
                    ' "' +
                    names[k] +
                    '", "' +
                    'message": "' +
                    mes[k] +
                    '"}';
                  const obj = JSON.parse(plainText);

                  ws.send(plainText);
                }
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
            const user = await User.findOne({ where: { username } });
            const userId = user.id;
            const message = data.message;

            //создание сообщения в БД
            const userMessage = await Message.create({
              userId,
              message,
            });

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
          console.log(e)
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
