const Router = require('express')
const Controller = require('../controllers/Controller')
const router = new Router()

router.post('/reg', Controller.registration)
router.post('/login', Controller.login)


module.exports = router