var express = require('express');
var orm = require('orm');
var bodyParser = require('body-parser');
var session = require('express-session');
const WebSocket = require('ws');
const cors = require('cors');


//Inicjalizacja aplikacji
var app = express();

//process.env.PORT - pobranie portu z danych środowiska np. jeżeli aplikacja zostanie uruchomiona na zewnętrznej platformie np. heroku
var PORT = process.env.PORT || 8080;

//uruchomienie serwera
var server = app.listen(PORT, () => console.log(`Listening on ${PORT}`));

// umożwliwienie pasrsowania danych przez biboltekę bodyparser w aplikacji
// support parsing of application/json type post data
app.use(bodyParser.json());

//support parsing of application/x-www-form-urlencoded post data
app.use(bodyParser.urlencoded({ extended: true }));

//dołączenie folderu public ze statycznymi plikami aplikacji klienckiej
app.use(express.static(__dirname + '/public/'));

// dołączenie obslugi sessji do aplikacji 
const sessionParser = session({
    saveUninitialized: false,
    secret: '$secret',
    resave: false
});

app.use(sessionParser);

app.use(cors());

//podłączenie orm'a tak aby działał w aplikacji
app.use(orm.express("mysql://root:root@localhost:3306/lab_pai", {
    define: function (db, models, next) {


        models.user = db.define("user", {
            user_id: { type: 'serial', key: true },
            user_name: String,
            user_password: String,
        }, {
            methods: {
                getPublicData: function () {
                    return {
                        user_id: this.user_id,
                        user_name: this.user_name
                    }
                }
            },
            validations: {
                user_name: orm.enforce.ranges.length(3, undefined, "user_name is too short"),
                user_password: orm.enforce.ranges.length(3, undefined, "user_password is too short"),
            }
        });


        models.message = db.define("message", {
            message_id: { type: 'serial', key: true },
            message_from_user_id: Number,
            message_to_user_id: Number,
            message_text: String,
            message_date: Date,
        }, {
            methods: {
                getPublicData: function () {
                    return {
                        message_id: this.message_id,
                        message_from_user_id: this.message_from_user_id,
                        message_to_user_id: this.message_to_user_id,
                        message_text: this.message_text,
                    }
                }
            },
            validations: {
                message_text: orm.enforce.ranges.length(1, undefined, "missing"),
            }
        });

        db.sync(function () { console.log("sync") })


        next();
    }
}));

function register(request, response) {
    var user_name = request.body.user_name;
    var user_password = request.body.user_password;

    if (user_name && user_password) {
        request.models.user.exists({ user_name: user_name }, function (err, exists) {

            if (!exists) {
                request.models.user.create({ user_name: user_name, user_password: user_password }, function (err) {

                    if (err) {
                        response.send({ register: false });
                    } else {
                        response.send({ register: true });
                    }
                })

            } else {
                response.send({ register: false });
            }
        });
    } else {
        response.send({ register: false });
    }
}

function login(request, response) {
    var user_name = request.body.user_name;
    var user_password = request.body.user_password;
    if (user_name && user_password) {
        request.models.user.find({ user_name: user_name, user_password: user_password }, function (err, users) {
            if (users.length > 0) {
                request.session.loggedin = true;
                request.session.user_id = users[0].user_id;
                response.send({ loggedin: true, user_name: users[0].user_name, user_id: users[0].user_id });

            } else {
                response.send({ loggedin: false });
            }
        });
    } else {
        response.send({ loggedin: false });
    }
}

function loginTest(request, response) {
    response.send({ loggedin: true });
}

function logout(request, response) {
    request.session.destroy();
    response.send({ loggedin: false });
}

function checkSessions(request, response, next) {

    if (request.session.loggedin) {
        next();
    } else {
        response.send({ loggedin: false });
    }
}

function getUsers(request, response) {
    request.models.user.all().only("user_id", "user_name").run(function (err, users) {
        for (user of users) {
            if (user.user_id in onlineUsers) {
                user.online = true;
            }
            else {
                user.online = false;
            }
        }
        response.send({ data: users });
    });
}

function getMessages(request, response) {
    var user_id = parseInt(request.params.id);
    request.models.message.all().where("message_from_user_id = ? AND message_to_user_id = ? OR message_from_user_id = ? AND message_to_user_id = ?",
        [request.session.user_id, user_id, user_id, request.session.user_id]).run(function (err, users) {

            response.send({ data: users });
        });
}

function sendMessages(request, response) {
    var message_text = request.body.message_text;
    var to = request.body.message_to_user_id;
    console.log(`Received message => ${message_text} from ${request.session.user_id} to ${to}`);

    request.models.user.get(to, function (err, user) {
        if (user) {
            var mes = {
                message_from_user_id: request.session.user_id,
                message_to_user_id: user.user_id,
                message_text: message_text,
                message_date: new Date()
            }
            request.models.message.create(mes, function (err) {

                if (err) {
                    response.send({ error: err });
                } else {
                    if (user.user_id in onlineUsers) {
                        onlineUsers[user.user_id].send(JSON.stringify({ status: 1, data: mes }));
                    }
                    if (mes.message_from_user_id !== mes.message_to_user_id) {
                        if (mes.message_from_user_id in onlineUsers) {
                            onlineUsers[mes.message_from_user_id].send(JSON.stringify({ status: 1, data: mes }));
                        }
                    }
                }
            })
        }
    });
}


function testGet(request, response) {
    response.send("testGet working");
}

app.post('/api/register/', [register]);

app.post('/api/login/', [login]);

app.get('/api/login-test/', [checkSessions, loginTest]);

app.get('/api/logout/', [checkSessions, logout]);

app.get('/api/users/', [checkSessions, getUsers]);

app.get('/api/messages/:id', [checkSessions, getMessages]);

app.post('/api/messages/', [checkSessions, sendMessages]);

app.get('/api/test-get', testGet);

const wss = new WebSocket.Server({
    noServer: true,
});



server.on('upgrade', function (request, socket, head) {
    // Sprawdzenie czy dla danego połączenia istnieje sesja
    sessionParser(request, {}, () => {
        if (!request.session.user_id) {
            socket.destroy();
            return;
        }

        wss.handleUpgrade(request, socket, head, function (ws) {
            wss.emit('connection', ws, request);
        });
    });
});

let onlineUsers = {};

wss.on('connection', function (ws, request) {

    wss.clients.forEach(function each(client) {
        if (client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify({ status: 2 }));
        }
    });
    onlineUsers[request.session.user_id] = ws;

    ws.on('message', function (message) {

        // parsowanie wiadomosci z JSONa na obiekt
        try {
            var data = JSON.parse(message);
        } catch (error) {
            return;
        }
    });

    ws.on('close', () => {
        delete onlineUsers[request.session.user_id];
    })

});


