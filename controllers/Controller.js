require('dotenv').config()
const bcrypt = require('bcrypt')
const jwt = require('jsonwebtoken')
const {User, Message} = require('../models/models')


//создаем токен на основе юзернэйма и строки
const jwtGenerate = (username) => {
    return jwt.sign({username}, process.env.JWT, {expiresIn: '1h'})
}

//Контроллер для генерации токена
class Controller {

    //метод регистрации
    async registration(req, res, next){
        
        try {

        const {username, password} = req.body
        
        const candidate = await User.findOne({where: {username}})

        if (candidate) {
            return next(ApiError.badRequest('User already exist'))
             }

//создаем хэшированный пароль и создаем юзера
const hashPassword = await bcrypt.hash(password, 12)
const user = await User.create({username, password: hashPassword})

const token = jwtGenerate(user.username)

return res.json({token})


        }
        catch(e){
console.log(e)
        }
    }
//----------------------------------------------LOGIN---------------------------------------//  
    async login(req, res, next){
        

        try {

        const {username, password} = req.body
        
        //проверки пароля

        const user = await User.findOne({where: {username}})

        if (!user) {
            return next(ApiError.internal('Wrong username and/or password'))
             }

        const isMatch = await bcrypt.compare(password, user.password)

        if (!isMatch) {
            return next(ApiError.internal('Wrong username and/or password'))
        }
             

//обновляем(создаем заново) токен

const token =  jwtGenerate(user.username)
return res.json({token})


        }
        catch(e){
console.log(e)
        }





    }

//----------------------------------------------AUTHENTICATION------------не используется----------------//  
    async auth(req, res, next){
        
const token = jwtGenerate(req.user.username)
return res.json({token})
}




}

module.exports = new Controller()
